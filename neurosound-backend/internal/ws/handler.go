package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"neurosound-backend/internal/processor"
	"neurosound-backend/internal/sse"
)

type Hub struct {
	mu       sync.RWMutex
	clients  map[*websocket.Conn]string
	proc     *processor.Processor
	abrSSE   *sse.Broadcaster
	rawSSE   *sse.Broadcaster
	upgrader websocket.Upgrader
}

func NewHub(proc *processor.Processor, abrSSE, rawSSE *sse.Broadcaster) *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]string),
		proc:    proc,
		abrSSE:  abrSSE,
		rawSSE:  rawSSE,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (h *Hub) Devices() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]string, 0, len(h.clients))
	for _, id := range h.clients {
		out = append(out, id)
	}
	return out
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade: %v", err)
		return
	}
	deviceID := r.URL.Query().Get("id")
	if deviceID == "" {
		deviceID = "esp32-abr"
	}

	h.mu.Lock()
	h.clients[conn] = deviceID
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		_ = conn.Close()
	}()

	type rawFrame struct {
		Ch1  int32 `json:"ch1"`
		Ch2  int32 `json:"ch2"`
		TS   int64 `json:"ts"`
		Stim bool  `json:"stim"`
		T    int64 `json:"t"`
		R    int32 `json:"r"`
		S    int   `json:"s"`
	}

	log.Printf("[ws] device connected: %s", deviceID)
	var frameCount uint64
	var lastLog time.Time
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[ws] device disconnected: %s: %v", deviceID, err)
			return
		}

		// Support both single frame {...} and batch [{ ... }, ...]
		var frames []rawFrame
		if len(raw) > 0 && raw[0] == '[' {
			if err := json.Unmarshal(raw, &frames); err != nil {
				log.Printf("[ws] bad batch from %s: %v | raw: %s", deviceID, err, raw)
				continue
			}
		} else {
			var f rawFrame
			if err := json.Unmarshal(raw, &f); err != nil {
				log.Printf("[ws] bad frame from %s: %v | raw: %s", deviceID, err, raw)
				continue
			}
			frames = append(frames, f)
		}

		frameCount += uint64(len(frames))
		if now := time.Now(); now.Sub(lastLog) >= time.Second {
			log.Printf("[ws] %s | frame #%d (+%d/msg) | last: %s", deviceID, frameCount, len(frames), raw)
			lastLog = now
		}

		for _, frame := range frames {
			if frame.TS == 0 {
				frame.TS = frame.T
			}
			if frame.TS == 0 {
				frame.TS = time.Now().UnixMicro()
			}
			if frame.Ch1 == 0 && frame.R != 0 {
				frame.Ch1 = frame.R
				frame.Stim = frame.S == 1
			}

			result, changed, err := h.proc.AddFrame(frame.Ch1, frame.Ch2, frame.TS, frame.Stim)
			if err != nil {
				msg, _ := json.Marshal(map[string]string{"type": "dsp_error", "error": err.Error()})
				_ = conn.WriteMessage(websocket.TextMessage, msg)
				log.Printf("[dsp] %v", err)
				continue
			}
			if changed && result.TrialCount%100 == 0 {
				h.abrSSE.Broadcast(result)
			}
		}
	}
}
