// Package dummy membangkitkan sinyal ABR di server dan memasukkannya ke
// processor lewat jalur yang sama dengan frame ESP32 (AddFrame). Dipakai
// dari halaman admin untuk demo / uji dashboard tanpa hardware.
//
// Dua sumber: "synthetic" (dibangkitkan di Go) dan rekaman .npz di DUMMY_DIR
// (hasil abr/abr_dummy.py, ground truth diketahui) yang di-replay real-time.
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
	// Setelah stimulus terakhir, kirim sampel secukupnya supaya epoch-nya lengkap.
	tailSamples = processor.Fs * 60 / 1000

	SourceSynthetic = "synthetic"
)

// Options bisa dikirim sebagai body JSON ke /api/v1/dummy/start.
type Options struct {
	Source     string  `json:"source"`      // "synthetic" (default) atau nama file .npz dari /api/v1/dummy/sources
	Stims      int     `json:"stims"`       // 0 = terus sampai di-stop (rekaman diputar berulang)
	NoiseUV    float64 `json:"noise_uv"`    // RMS noise EEG (synthetic saja)
	MainsUV    float64 `json:"mains_uv"`    // amplitudo 50 Hz (synthetic saja)
	NoResponse bool    `json:"no_response"` // tanpa ABR, simulasi tuli → Refer (synthetic saja)
	Reset      bool    `json:"reset"`       // reset rata-rata sebelum mulai
}

type Status struct {
	Running   bool    `json:"running"`
	Options   Options `json:"options"`
	StartedAt string  `json:"started_at,omitempty"`
	Frames    int64   `json:"frames"`
	Stims     int     `json:"stims"`
	LastError string  `json:"last_error,omitempty"`
	// Diisi kalau sumbernya rekaman.
	Recording *Recording `json:"recording,omitempty"`
}

type Generator struct {
	proc *processor.Processor
	data *Library

	mu     sync.Mutex
	status Status
	stop   chan struct{}
	done   chan struct{}
}

func New(proc *processor.Processor) *Generator {
	return &Generator{proc: proc}
}

// WithLibrary mengaktifkan replay rekaman dari lib.
func (g *Generator) WithLibrary(lib *Library) *Generator {
	g.data = lib
	return g
}

// Library mengembalikan sumber rekaman (nil kalau tidak dikonfigurasi).
func (g *Generator) Library() *Library { return g.data }

func (g *Generator) Status() Status {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.status
}

var (
	ErrRunning     = errors.New("dummy sudah berjalan")
	ErrNoLibrary   = errors.New("replay rekaman tidak aktif (DUMMY_DIR kosong)")
	ErrUnknownFile = errors.New("rekaman tidak ditemukan, lihat /api/v1/dummy/sources")
)

func (g *Generator) Start(opt Options) error {
	if opt.Source == "" {
		opt.Source = SourceSynthetic
	}
	if opt.NoiseUV <= 0 {
		opt.NoiseUV = 4
	}
	if opt.MainsUV < 0 {
		opt.MainsUV = 0
	}
	if g.Status().Running {
		return ErrRunning
	}

	var src source
	var rec *Recording
	if opt.Source == SourceSynthetic {
		src = newSynthetic(opt)
	} else {
		if g.data == nil {
			return ErrNoLibrary
		}
		// Load di luar lock: butuh ~1 detik (Python + resample).
		sig, r, err := g.data.Load(opt.Source)
		if err != nil {
			return err
		}
		src, rec = &replay{sig: sig}, r
	}

	g.mu.Lock()
	if g.status.Running {
		g.mu.Unlock()
		return ErrRunning
	}
	if opt.Reset {
		g.proc.Reset()
	}
	g.status = Status{Running: true, Options: opt, StartedAt: time.Now().Format(time.RFC3339), Recording: rec}
	g.stop = make(chan struct{})
	g.done = make(chan struct{})
	stop, done := g.stop, g.done
	g.mu.Unlock()

	go g.run(opt, src, stop, done)
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

// source menghasilkan satu sampel (µV per channel) per panggilan, pada processor.Fs.
type source interface {
	next() (ch1, ch2 float64, stim bool)
}

type synthetic struct {
	opt                 Options
	fs                  float64
	isi                 int64
	n, nextStim, lastSt int64
	rng                 *rand.Rand
}

func newSynthetic(opt Options) *synthetic {
	fs := float64(processor.Fs)
	isi := int64(isiMs / 1000 * fs)
	// Mulai setengah ISI supaya epoch pertama punya data pre-stimulus.
	return &synthetic{opt: opt, fs: fs, isi: isi, nextStim: isi / 2, lastSt: -1,
		rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

func (s *synthetic) next() (float64, float64, bool) {
	stim := s.n == s.nextStim
	if stim {
		s.lastSt = s.n
		s.nextStim += s.isi
	}
	mains := s.opt.MainsUV * math.Sin(2*math.Pi*50*float64(s.n)/s.fs)
	uv := s.opt.NoiseUV*s.rng.NormFloat64() + mains
	uv2 := s.opt.NoiseUV*s.rng.NormFloat64() + mains
	if s.lastSt >= 0 && !s.opt.NoResponse {
		age := float64(s.n-s.lastSt) / s.fs * 1000
		if age < 50 {
			for _, w := range waves {
				r := w[1] * math.Exp(-0.5*math.Pow((age-w[0])/0.25, 2))
				uv += r
				uv2 += 0.4 * r
			}
		}
	}
	s.n++
	return uv, uv2, stim
}

// replay memutar rekaman berulang-ulang. Rekaman single-channel, jadi ch2 = 0.
type replay struct {
	sig  *Signal
	i, k int // indeks sampel dan indeks stimulus berikutnya
}

func (r *replay) next() (float64, float64, bool) {
	if r.i >= len(r.sig.UV) {
		r.i, r.k = 0, 0
	}
	stim := r.k < len(r.sig.Trig) && r.i == r.sig.Trig[r.k]
	if stim {
		r.k++
	}
	uv := float64(r.sig.UV[r.i])
	r.i++
	return uv, 0, stim
}

func (g *Generator) run(opt Options, src source, stop, done chan struct{}) {
	defer close(done)
	defer func() {
		g.mu.Lock()
		g.status.Running = false
		g.mu.Unlock()
	}()

	fs := float64(processor.Fs)
	lsb := processor.RawADCToUV(1)
	var n int64
	stims, tail := 0, -1 // tail >= 0: hitung mundur sampel setelah stimulus terakhir

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
			uv, uv2, stim := src.next()
			if stim && tail >= 0 {
				stim = false // batas stimulus tercapai, sisa sampel hanya penutup epoch
			}
			if stim {
				stims++
				if opt.Stims > 0 && stims >= opt.Stims {
					tail = tailSamples
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
			if tail >= 0 {
				if tail == 0 {
					return
				}
				tail--
			}
		}
	}
}
