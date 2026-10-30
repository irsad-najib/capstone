package ws

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"neurosound-backend/internal/devlog"
	"neurosound-backend/internal/processor"
	"neurosound-backend/internal/sse"
)

const (
	pongWait     = 30 * time.Second
	pingInterval = 10 * time.Second
	writeWait    = 5 * time.Second
)

// client = satu koneksi WebSocket. gorilla/websocket tidak aman untuk concurrent
// write, jadi semua WriteMessage lewat wmu.
type client struct {
	id   string
	conn *websocket.Conn
	wmu  sync.Mutex
}

func (c *client) write(msg []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.conn.WriteMessage(websocket.TextMessage, msg)
}

// rawFrame = satu sampel dari ESP32, baik dari JSON maupun dari pesan biner.
type rawFrame struct {
	Ch1  int32 `json:"ch1"`
	Ch2  int32 `json:"ch2"`
	TS   int64 `json:"ts"`
	Stim bool  `json:"stim"`
	T    int64 `json:"t"`
	R    int32 `json:"r"`
	S    int   `json:"s"`
	// UV = µV per LSB dari header biner versi 2; 0 = pakai processor.RawADCToUV.
	UV float64 `json:"-"`
}

// Pesan biner dari firmware ESP32, little-endian:
//
//	0  u8  0xEE   1 u8 versi   2 u16 n sampel   4 u32 nomor urut sampel pertama
//	8  u64 waktu sampel pertama (µs sejak boot)
//
// Versi 1 (esp/, ADS1299, 16 kHz): header 16 byte, langsung diikuti sampel.
// Versi 2 (esp-ads1256/): header 24 byte,
//
//	16 u16 laju sampel   18 u8 kanal aktif (1 Cz-A1, 2 Cz-A2, 0 input pendek)   19 u8 PGA
//	20 f32 µV per LSB di elektroda
//
// lalu n × { u8 flag (bit0 = onset stimulus), i24 CH1 big-endian, i24 CH2 big-endian }.
// Laju sampel harus sama dengan processor.Fs, kalau tidak epoch dan latensi salah.
const (
	binMagic      = 0xEE
	binHeaderV1   = 16
	binHeaderV2   = 24
	binSampleSize = 7
	binFsV1       = 16000
)

func be24(b []byte) int32 {
	v := int32(b[0])<<16 | int32(b[1])<<8 | int32(b[2])
	return v << 8 >> 8
}

func parseBinary(raw []byte) ([]rawFrame, error) {
	if len(raw) < binHeaderV1 || raw[0] != binMagic {
		return nil, errors.New("header biner tidak dikenal")
	}
	hdr, fs, uv := binHeaderV1, binFsV1, 0.0
	switch raw[1] {
	case 1:
	case 2:
		if len(raw) < binHeaderV2 {
			return nil, errors.New("header biner v2 terpotong")
		}
		hdr = binHeaderV2
		fs = int(binary.LittleEndian.Uint16(raw[16:18]))
		uv = float64(math.Float32frombits(binary.LittleEndian.Uint32(raw[20:24])))
		if uv <= 0 || math.IsNaN(uv) || math.IsInf(uv, 0) {
			return nil, fmt.Errorf("µV per LSB tidak valid (%g)", uv)
		}
	default:
		return nil, fmt.Errorf("versi biner %d tidak didukung", raw[1])
	}
	if fs != processor.Fs {
		return nil, fmt.Errorf("laju sampel device %d Hz, backend butuh %d Hz (firmware dan backend tidak cocok)", fs, processor.Fs)
	}
	n := int(binary.LittleEndian.Uint16(raw[2:4]))
	if len(raw) != hdr+n*binSampleSize {
		return nil, errors.New("panjang pesan biner tidak cocok")
	}
	t0 := int64(binary.LittleEndian.Uint64(raw[8:16]))
	frames := make([]rawFrame, n)
	for i := range frames {
		p := raw[hdr+i*binSampleSize:]
		frames[i] = rawFrame{
			Ch1:  be24(p[1:4]),
			Ch2:  be24(p[4:7]),
			TS:   t0 + int64(i)*1_000_000/int64(fs),
			Stim: p[0]&1 != 0,
			UV:   uv,
		}
	}
	return frames, nil
}

// DeviceStatus = status terakhir yang diketahui per device id.
type DeviceStatus struct {
	ID          string          `json:"id"`
	Connected   bool            `json:"connected"`
	Connections int             `json:"connections"`
	LastSeen    string          `json:"last_seen,omitempty"`
	AudioTest   json.RawMessage `json:"audio_test,omitempty"`
	AudioTestAt string          `json:"audio_test_at,omitempty"`
	Frames      uint64          `json:"frames"`
	LastFrameAt string          `json:"last_frame_at,omitempty"`
}

type deviceState struct {
	lastSeen  time.Time
	audio     json.RawMessage
	audioSeen time.Time
	frames    uint64
	lastFrame time.Time
}

type Hub struct {
	mu       sync.RWMutex
	clients  map[*client]struct{}
	state    map[string]*deviceState
	proc     *processor.Processor
	abrSSE   *sse.Broadcaster
	rawSSE   *sse.Broadcaster
	upgrader websocket.Upgrader
	Logs     *devlog.Store
	// Mute != nil dan true → frame EEG dari device dihitung tapi tidak masuk processor
	// (dipakai saat dummy jalan supaya data ESP tidak tercampur).
	Mute func() bool
}

func NewHub(proc *processor.Processor, abrSSE, rawSSE *sse.Broadcaster) *Hub {
	return &Hub{
		clients: make(map[*client]struct{}),
		state:   make(map[string]*deviceState),
		proc:    proc,
		abrSSE:  abrSSE,
		rawSSE:  rawSSE,
		Logs:    devlog.New(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Devices mengembalikan id device yang sedang terhubung (unik, terurut).
func (h *Hub) Devices() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := make(map[string]bool)
	out := make([]string, 0, len(h.clients))
	for c := range h.clients {
		if !seen[c.id] {
			seen[c.id] = true
			out = append(out, c.id)
		}
	}
	sort.Strings(out)
	return out
}

// Detail mengembalikan status semua device yang pernah terlihat.
func (h *Hub) Detail() []DeviceStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conns := make(map[string]int)
	for c := range h.clients {
		conns[c.id]++
	}
	out := make([]DeviceStatus, 0, len(h.state))
	for id, st := range h.state {
		d := DeviceStatus{ID: id, Connected: conns[id] > 0, Connections: conns[id], AudioTest: st.audio, Frames: st.frames}
		if !st.lastFrame.IsZero() {
			d.LastFrameAt = st.lastFrame.Format(devlog.TimeLayout)
		}
		if !st.lastSeen.IsZero() {
			d.LastSeen = st.lastSeen.Format(devlog.TimeLayout)
		}
		if !st.audioSeen.IsZero() {
			d.AudioTestAt = st.audioSeen.Format(devlog.TimeLayout)
		}
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// SendTo mengirim pesan ke device dengan id tertentu (kosong = semua device).
// Mengembalikan jumlah koneksi yang menerima.
func (h *Hub) SendTo(device string, msg []byte) int {
	h.mu.RLock()
	targets := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		if device == "" || c.id == device {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	sent := 0
	for _, c := range targets {
		if c.write(msg) == nil {
			sent++
		}
	}
	return sent
}

// Send mengirim pesan ke semua device.
func (h *Hub) Send(msg []byte) int { return h.SendTo("", msg) }

func (h *Hub) touch(id string, now time.Time) *deviceState {
	st := h.state[id]
	if st == nil {
		st = &deviceState{}
		h.state[id] = st
	}
	st.lastSeen = now
	return st
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
	c := &client{id: deviceID, conn: conn}

	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.touch(deviceID, time.Now())
	h.mu.Unlock()
	h.Logs.Add(deviceID, "[server] connected from "+r.RemoteAddr)

	done := make(chan struct{})
	defer func() {
		close(done)
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		_ = conn.Close()
	}()

	// Koneksi mati (ESP reset / WiFi putus) dibuang setelah pongWait tanpa pesan/pong.
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	go func() {
		t := time.NewTicker(pingInterval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				// WriteControl aman dipanggil bersamaan dengan WriteMessage.
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
					return
				}
			}
		}
	}()

	log.Printf("[ws] device connected: %s", deviceID)
	var frameCount uint64
	var lastLog, lastBad time.Time
	for {
		mt, raw, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[ws] device disconnected: %s: %v", deviceID, err)
			h.Logs.Add(deviceID, "[server] disconnected: "+err.Error())
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		h.mu.Lock()
		h.touch(deviceID, time.Now())
		h.mu.Unlock()

		var frames []rawFrame
		if mt == websocket.BinaryMessage {
			frames, err = parseBinary(raw)
			if err != nil {
				// ~100 pesan/detik: catat paling sering tiap 10 detik, juga ke log device.
				if now := time.Now(); now.Sub(lastBad) >= 10*time.Second {
					log.Printf("[ws] bad binary from %s: %v (%d byte)", deviceID, err, len(raw))
					h.Logs.Add(deviceID, "[server] pesan biner ditolak: "+err.Error())
					lastBad = now
				}
				continue
			}
		}

		// Pesan bertipe ({"type":"log"}, {"type":"audio_test"}, ...) bukan data EEG.
		if frames == nil && len(raw) > 0 && raw[0] == '{' {
			var head struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(raw, &head) == nil && head.Type != "" {
				h.handleTyped(deviceID, head.Type, raw)
				continue
			}
		}

		// Support both single frame {...} and batch [{ ... }, ...]
		if frames != nil {
			// sudah dari pesan biner
		} else if len(raw) > 0 && raw[0] == '[' {
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
		h.mu.Lock()
		st := h.touch(deviceID, time.Now())
		st.frames += uint64(len(frames))
		st.lastFrame = st.lastSeen
		h.mu.Unlock()
		if now := time.Now(); now.Sub(lastLog) >= time.Second {
			if mt == websocket.BinaryMessage {
				log.Printf("[ws] %s | frame #%d (+%d/msg, biner)", deviceID, frameCount, len(frames))
			} else {
				log.Printf("[ws] %s | frame #%d (+%d/msg) | last: %s", deviceID, frameCount, len(frames), raw)
			}
			lastLog = now
		}
		if h.Mute != nil && h.Mute() {
			continue
		}

		for _, frame := range frames {
			if frame.TS == 0 {
				frame.TS = frame.T
			}
			if frame.TS == 0 {
				frame.TS = time.Now().UnixMicro()
			}
			if frame.Ch1 == 0 && (frame.R != 0 || frame.S != 0) {
				frame.Ch1 = frame.R
				frame.Stim = frame.S == 1
			}

			uv := frame.UV
			if uv == 0 {
				uv = processor.RawADCToUV(1)
			}
			result, changed, err := h.proc.AddFrameScaled(frame.Ch1, frame.Ch2, uv, frame.TS, frame.Stim)
			if err != nil {
				msg, _ := json.Marshal(map[string]string{"type": "dsp_error", "error": err.Error()})
				_ = c.write(msg)
				log.Printf("[dsp] %v", err)
				continue
			}
			if changed && result.TrialCount%100 == 0 {
				h.abrSSE.Broadcast(result)
			}
		}
	}
}

func (h *Hub) handleTyped(deviceID, typ string, raw []byte) {
	switch typ {
	case "log":
		var m struct {
			Lines []string `json:"lines"`
		}
		if err := json.Unmarshal(raw, &m); err != nil {
			log.Printf("[ws] bad log from %s: %v", deviceID, err)
			return
		}
		for _, line := range m.Lines {
			h.Logs.Add(deviceID, line)
		}
	case "audio_test":
		now := time.Now()
		h.mu.Lock()
		st := h.touch(deviceID, now)
		st.audio = append(json.RawMessage(nil), raw...)
		st.audioSeen = now
		h.mu.Unlock()
	case "hello":
		h.Logs.Add(deviceID, "[server] hello")
	default:
		log.Printf("[ws] %s: pesan type=%q diabaikan", deviceID, typ)
	}
}
