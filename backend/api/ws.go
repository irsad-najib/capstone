package api

import (
	"capstone/internal/abr"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
)

// Hub mengelola semua koneksi ESP32.
type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]string
	proc    *abr.Processor
}

// streamStats mencetak log stream tiap 1 detik (throttled, tidak flood).
type streamStats struct {
	deviceID  string
	frames    int
	stims     int
	lastRaw   int16
	lastMv    float64
	startTime time.Time
	lastLog   time.Time
}

func newStreamStats(deviceID string) *streamStats {
	now := time.Now()
	return &streamStats{deviceID: deviceID, startTime: now, lastLog: now}
}

func (s *streamStats) record(raw int16, isStim bool) {
	s.frames++
	s.lastRaw = raw
	s.lastMv = float64(raw) * (4096.0 / 32768.0)
	if isStim {
		s.stims++
	}
	if time.Since(s.lastLog) >= time.Second {
		elapsed := time.Since(s.lastLog).Seconds()
		sps := float64(s.frames) / elapsed
		log.Printf("[RX][%s] SPS:%.0f  frames:%d  stims:%d  last: raw=%d  mV=%.3f",
			s.deviceID, sps, s.frames, s.stims, s.lastRaw, s.lastMv)
		s.frames = 0
		s.stims = 0
		s.lastLog = time.Now()
	}
}

func newHub(proc *abr.Processor) *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]string),
		proc:    proc,
	}
}

func (h *Hub) add(c *websocket.Conn, id string) {
	h.mu.Lock()
	h.clients[c] = id
	h.mu.Unlock()
}

func (h *Hub) remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

func (h *Hub) Broadcast(msg string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if err := c.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
			log.Printf("[WS] broadcast error: %v", err)
		}
	}
}

func (h *Hub) ConnectedDevices() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	ids := make([]string, 0, len(h.clients))
	for _, id := range h.clients {
		ids = append(ids, id)
	}
	return ids
}

// wsHandler menangani satu koneksi WebSocket dari ESP32.
func (h *Hub) wsHandler(c *websocket.Conn) {
	deviceID := c.Query("id", "unknown")
	h.add(c, deviceID)
	defer h.remove(c)
	defer c.Close()

	log.Printf("[WS] Device [%s] terhubung dari %s", deviceID, c.RemoteAddr())

	welcome := fmt.Sprintf(`{"type":"welcome","msg":"ESP32 connected!","device":%q}`, deviceID)
	c.WriteMessage(websocket.TextMessage, []byte(welcome))

	stats := newStreamStats(deviceID)

	for {
		mt, msg, err := c.ReadMessage()
		if err != nil {
			log.Printf("[WS] Device [%s] disconnect: %v", deviceID, err)
			break
		}
		if mt != websocket.TextMessage {
			continue
		}

		// Coba parse sebagai format kompak ADS1115 dulu: {"t":...,"r":...,"s":...}
		var compact struct {
			T int64 `json:"t"`
			R int16 `json:"r"`
			S int   `json:"s"`
		}
		if err := json.Unmarshal(msg, &compact); err == nil && (compact.T != 0 || compact.R != 0) {
			isStim := compact.S == 1
			h.proc.AddADS1115Frame(compact.R, isStim, time.Now())
			stats.record(compact.R, isStim)
			continue
		}

		// Fallback: parse tipe pesan untuk format lama (ADS1299 / misc)
		var envelope struct {
			Type string `json:"type"`
		}
		json.Unmarshal(msg, &envelope)

		switch envelope.Type {
		case "eeg":
			// Kirim ke ABR processor — tidak perlu ack untuk setiap frame
			if err := h.proc.AddFrameFromJSON(msg); err != nil {
				log.Printf("[WS] frame parse error: %v", err)
			}

		case "stim":
			// ESP32 memberitahu bahwa stimulus sudah diputar
			h.proc.LogStimulus(time.Now())
			c.WriteMessage(websocket.TextMessage,
				[]byte(`{"type":"stim_ack","ok":true}`))

		default:
			// Pesan lain (hello, sensor, dsb) → balas ack
			ack := fmt.Sprintf(
				`{"type":"ack","msg":"received","data":%s,"time":%q}`,
				msg, time.Now().Format(time.RFC3339),
			)
			c.WriteMessage(websocket.TextMessage, []byte(ack))
		}
	}
}
