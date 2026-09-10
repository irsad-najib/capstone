package sse

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

type Broadcaster struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

func New() *Broadcaster {
	return &Broadcaster{clients: make(map[chan []byte]struct{})}
}

func (b *Broadcaster) Broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.clients {
		select {
		case ch <- data:
		default:
		}
	}
}

func (b *Broadcaster) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch := make(chan []byte, 8)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.clients, ch)
		b.mu.Unlock()
		close(ch)
	}()

	for {
		select {
		case <-r.Context().Done():
			return
		case data := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
