// Package devlog menyimpan baris log ESP32 di memori (ring buffer per device)
// dan menyiarkannya live lewat SSE.
package devlog

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
)

const (
	Capacity     = 1000
	TimeLayout   = "2006-01-02T15:04:05.000Z07:00"
	pingInterval = 15 * time.Second
)

type Entry struct {
	Time   time.Time `json:"-"`
	T      string    `json:"t"`
	Device string    `json:"device"`
	Line   string    `json:"line"`
}

type ring struct {
	buf  [Capacity]Entry
	next int
	full bool
}

func (r *ring) push(e Entry) {
	r.buf[r.next] = e
	r.next = (r.next + 1) % Capacity
	if r.next == 0 {
		r.full = true
	}
}

// entries mengembalikan isi ring urut dari yang paling lama.
func (r *ring) entries() []Entry {
	if !r.full {
		return append([]Entry(nil), r.buf[:r.next]...)
	}
	out := make([]Entry, 0, Capacity)
	out = append(out, r.buf[r.next:]...)
	return append(out, r.buf[:r.next]...)
}

type subscriber struct {
	device string // kosong = semua device
	ch     chan Entry
}

type Store struct {
	mu   sync.RWMutex
	logs map[string]*ring
	subs map[*subscriber]struct{}
	now  func() time.Time
}

func New() *Store {
	return &Store{
		logs: make(map[string]*ring),
		subs: make(map[*subscriber]struct{}),
		now:  time.Now,
	}
}

// Add mencatat satu baris log dari device dan meneruskannya ke subscriber SSE.
func (s *Store) Add(device, line string) Entry {
	t := s.now()
	e := Entry{Time: t, T: t.Format(TimeLayout), Device: device, Line: line}

	s.mu.Lock()
	r := s.logs[device]
	if r == nil {
		r = &ring{}
		s.logs[device] = r
	}
	r.push(e)
	for sub := range s.subs {
		if sub.device != "" && sub.device != device {
			continue
		}
		select {
		case sub.ch <- e:
		default: // klien lambat: buang, jangan blok ESP
		}
	}
	s.mu.Unlock()
	return e
}

// Get mengembalikan limit baris terakhir. device kosong = semua device digabung urut waktu.
func (s *Store) Get(device string, limit int) []Entry {
	s.mu.RLock()
	var out []Entry
	if device != "" {
		if r := s.logs[device]; r != nil {
			out = r.entries()
		}
	} else {
		for _, r := range s.logs {
			out = append(out, r.entries()...)
		}
	}
	s.mu.RUnlock()

	if device == "" {
		sort.SliceStable(out, func(i, j int) bool { return out[i].Time.Before(out[j].Time) })
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	if out == nil {
		out = []Entry{}
	}
	return out
}

// ServeStream melayani SSE live per baris untuk ?device= (kosong = semua).
func (s *Store) ServeStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	sub := &subscriber{device: r.URL.Query().Get("device"), ch: make(chan Entry, 256)}
	s.mu.Lock()
	s.subs[sub] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs, sub)
		s.mu.Unlock()
	}()

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case e := <-sub.ch:
			data, _ := json.Marshal(e)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
