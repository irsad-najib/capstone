package buffer

import "sync"

type Frame struct {
	Seq  int64   `json:"seq"`
	Ch1  float64 `json:"ch1"`
	Ch2  float64 `json:"ch2"`
	Raw1 int32   `json:"raw_ch1"`
	Raw2 int32   `json:"raw_ch2"`
	TS   int64   `json:"ts"`
	Stim bool    `json:"stim"`
}

// RingBuffer untuk menyimpan frame EEG in-memory.
type RingBuffer struct {
	mu   sync.RWMutex
	buf  []Frame
	head int
	full bool
	next int64
}

func New(size int) *RingBuffer {
	if size < 1 {
		size = 32000
	}
	return &RingBuffer{buf: make([]Frame, size)}
}

func (r *RingBuffer) Push(frame Frame) Frame {
	r.mu.Lock()
	defer r.mu.Unlock()
	frame.Seq = r.next
	r.next++
	r.buf[r.head] = frame
	r.head = (r.head + 1) % len(r.buf)
	if r.head == 0 {
		r.full = true
	}
	return frame
}

func (r *RingBuffer) GetLast(n int) []Frame {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if n <= 0 {
		return nil
	}
	size := r.sizeLocked()
	if n > size {
		n = size
	}
	out := make([]Frame, n)
	start := (r.head - n + len(r.buf)) % len(r.buf)
	for i := 0; i < n; i++ {
		out[i] = r.buf[(start+i)%len(r.buf)]
	}
	return out
}

func (r *RingBuffer) GetRange(startSeq int64, n int) ([]Frame, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if n <= 0 {
		return nil, false
	}
	size := r.sizeLocked()
	if size < n {
		return nil, false
	}
	out := make([]Frame, 0, n)
	start := 0
	if r.full {
		start = r.head
	}
	for i := 0; i < size; i++ {
		f := r.buf[(start+i)%len(r.buf)]
		if f.Seq >= startSeq && f.Seq < startSeq+int64(n) {
			out = append(out, f)
		}
	}
	if len(out) != n {
		return nil, false
	}
	return out, true
}

func (r *RingBuffer) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.head = 0
	r.full = false
	r.next = 0
	for i := range r.buf {
		r.buf[i] = Frame{}
	}
}

func (r *RingBuffer) sizeLocked() int {
	if r.full {
		return len(r.buf)
	}
	return r.head
}
