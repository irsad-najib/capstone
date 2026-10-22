// Package dummy membangkitkan sinyal ABR sintetis di server dan memasukkannya
// ke processor lewat jalur yang sama dengan frame ESP32 (AddFrame). Dipakai
// dari halaman admin untuk demo / uji dashboard tanpa hardware.
package dummy

import (
	"errors"
	"math"
	"math/rand"
	"sync"
	"time"

	"neurosound-backend/internal/processor"
)

// Gelombang sintetis: latensi (ms setelah stimulus) dan amplitudo (µV),
// sama dengan tests/e2e_abr.py.
var waves = [][2]float64{{1.6, 0.30}, {3.7, 0.25}, {5.6, 0.50}}

const (
	isiMs   = 91.0 // jarak antar stimulus, sama dengan STIM_INTERVAL_MS firmware
	chunkMs = 10   // frame dibangkitkan per 10 ms
)

// Options bisa dikirim sebagai body JSON ke /api/v1/dummy/start.
type Options struct {
	Stims      int     `json:"stims"`       // 0 = terus sampai di-stop
	NoiseUV    float64 `json:"noise_uv"`    // RMS noise EEG
	MainsUV    float64 `json:"mains_uv"`    // amplitudo 50 Hz
	NoResponse bool    `json:"no_response"` // tanpa ABR (simulasi tuli → Refer)
	Reset      bool    `json:"reset"`       // reset rata-rata sebelum mulai
}

type Status struct {
	Running   bool    `json:"running"`
	Options   Options `json:"options"`
	StartedAt string  `json:"started_at,omitempty"`
	Frames    int64   `json:"frames"`
	Stims     int     `json:"stims"`
	LastError string  `json:"last_error,omitempty"`
}

type Generator struct {
	proc *processor.Processor

	mu     sync.Mutex
	status Status
	stop   chan struct{}
	done   chan struct{}
}

func New(proc *processor.Processor) *Generator {
	return &Generator{proc: proc}
}

func (g *Generator) Status() Status {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.status
}

var ErrRunning = errors.New("dummy sudah berjalan")

func (g *Generator) Start(opt Options) error {
	if opt.NoiseUV <= 0 {
		opt.NoiseUV = 4
	}
	if opt.MainsUV < 0 {
		opt.MainsUV = 0
	}
	g.mu.Lock()
	if g.status.Running {
		g.mu.Unlock()
		return ErrRunning
	}
	if opt.Reset {
		g.proc.Reset()
	}
	g.status = Status{Running: true, Options: opt, StartedAt: time.Now().Format(time.RFC3339)}
	g.stop = make(chan struct{})
	g.done = make(chan struct{})
	stop, done := g.stop, g.done
	g.mu.Unlock()

	go g.run(opt, stop, done)
	return nil
}

// Stop menghentikan generator dan menunggu goroutine selesai.
func (g *Generator) Stop() {
	g.mu.Lock()
	stop, done := g.stop, g.done
	g.stop = nil
	g.mu.Unlock()
	if stop == nil {
		return
	}
	close(stop)
	<-done
}

func (g *Generator) run(opt Options, stop, done chan struct{}) {
	defer close(done)
	defer func() {
		g.mu.Lock()
		g.status.Running = false
		g.mu.Unlock()
	}()

	fs := float64(processor.Fs)
	isi := int64(isiMs / 1000 * fs)
	lsb := processor.RawADCToUV(1)
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	// Mulai setengah ISI supaya epoch pertama punya data pre-stimulus.
	var n, nextStim, lastStim int64 = 0, isi / 2, -1
	stims := 0

	// Jalan real-time (16 kHz). DSP backend bisa lebih lambat dari ini; kalau
	// begitu AddFrame memblok dan generator otomatis ikut melambat.
	ticker := time.NewTicker(chunkMs * time.Millisecond)
	defer ticker.Stop()
	perChunk := int64(fs * chunkMs / 1000)
	ts := time.Now().UnixMicro()

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
		for k := int64(0); k < perChunk; k++ {
			stim := n == nextStim
			if stim {
				if opt.Stims > 0 && stims >= opt.Stims {
					stim = false
					nextStim = -1
				} else {
					lastStim = n
					nextStim += isi
					stims++
				}
			}
			uv := opt.NoiseUV*rng.NormFloat64() + opt.MainsUV*math.Sin(2*math.Pi*50*float64(n)/fs)
			uv2 := opt.NoiseUV*rng.NormFloat64() + opt.MainsUV*math.Sin(2*math.Pi*50*float64(n)/fs)
			if lastStim >= 0 && !opt.NoResponse {
				age := float64(n-lastStim) / fs * 1000
				if age < 50 {
					for _, w := range waves {
						r := w[1] * math.Exp(-0.5*math.Pow((age-w[0])/0.25, 2))
						uv += r
						uv2 += 0.4 * r
					}
				}
			}
			ts += int64(1e6 / fs)
			_, _, err := g.proc.AddFrame(int32(math.Round(uv/lsb)), int32(math.Round(uv2/lsb)), ts, stim)
			n++
			g.mu.Lock()
			g.status.Frames = n
			g.status.Stims = stims
			if err != nil {
				g.status.LastError = err.Error()
			}
			g.mu.Unlock()
		}
		// Semua stimulus terkirim dan epoch terakhir sudah lengkap (50 ms + jeda)
		if opt.Stims > 0 && stims >= opt.Stims && n-lastStim > isi {
			return
		}
	}
}
