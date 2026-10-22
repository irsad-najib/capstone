package dummy

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"neurosound-backend/internal/processor"
)

// Recording = satu rekaman .npz beserta ground truth-nya (dari ground_truth.json).
type Recording struct {
	File        string          `json:"file"`
	LevelDB     *int            `json:"level_db"`
	Fs          float64         `json:"fs"`
	Sweeps      int             `json:"sweeps"`
	DurationS   float64         `json:"duration_s"`
	GroundTruth json.RawMessage `json:"ground_truth,omitempty"`
}

type Catalog struct {
	Dir         string      `json:"dir"`
	ThresholdDB *int        `json:"threshold_db"`
	Recordings  []Recording `json:"recordings"`
}

// Signal = rekaman yang sudah di-resample ke processor.Fs.
type Signal struct {
	UV   []float32
	Trig []int // indeks sampel stimulus, urut naik
}

// Library membaca rekaman lewat dsp/dummy_npz.py (numpy/scipy sudah ada untuk DSP worker).
type Library struct {
	Dir, Python, Script string

	mu      sync.Mutex
	catalog *Catalog
	cached  string
	signal  *Signal
}

func NewLibrary(dir, python, script string) *Library {
	return &Library{Dir: dir, Python: python, Script: script}
}

// Catalog mengembalikan daftar rekaman (di-cache setelah dibaca pertama kali).
func (l *Library) Catalog(ctx context.Context) (*Catalog, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.catalog != nil {
		return l.catalog, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, l.Python, l.Script, "--list", l.Dir).Output()
	if err != nil {
		return nil, fmt.Errorf("baca %s: %w%s", l.Dir, err, stderr(err))
	}
	var c Catalog
	if err := json.Unmarshal(out, &c); err != nil {
		return nil, fmt.Errorf("daftar rekaman bukan JSON: %w", err)
	}
	c.Dir = l.Dir
	l.catalog = &c
	return &c, nil
}

// Load membaca satu rekaman (yang terakhir dipakai disimpan di memori).
func (l *Library) Load(file string) (*Signal, *Recording, error) {
	c, err := l.Catalog(context.Background())
	if err != nil {
		return nil, nil, err
	}
	var rec *Recording
	for i := range c.Recordings {
		if c.Recordings[i].File == file {
			rec = &c.Recordings[i]
		}
	}
	if rec == nil {
		return nil, nil, ErrUnknownFile
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cached == file {
		return l.signal, rec, nil
	}
	sig, err := l.read(filepath.Join(l.Dir, filepath.Base(file)))
	if err != nil {
		return nil, nil, err
	}
	l.cached, l.signal = file, sig
	return sig, rec, nil
}

func (l *Library) read(path string) (*Signal, error) {
	cmd := exec.Command(l.Python, l.Script, path, "--fs", fmt.Sprint(processor.Fs))
	cmd.Stderr = os.Stderr
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	sig, perr := parseSignal(bufio.NewReaderSize(pipe, 1<<20))
	if werr := cmd.Wait(); perr == nil && werr != nil {
		perr = fmt.Errorf("dummy_npz.py: %w", werr)
	}
	if perr != nil {
		return nil, perr
	}
	return sig, nil
}

// parseSignal membaca 1 baris header JSON lalu n float32 little-endian.
func parseSignal(r *bufio.Reader) (*Signal, error) {
	line, err := r.ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("header rekaman: %w", err)
	}
	var h struct {
		Fs   int   `json:"fs"`
		N    int   `json:"n"`
		Trig []int `json:"trig"`
	}
	if err := json.Unmarshal(line, &h); err != nil {
		return nil, fmt.Errorf("header rekaman: %w", err)
	}
	if h.Fs != processor.Fs {
		return nil, fmt.Errorf("fs rekaman %d, backend butuh %d", h.Fs, processor.Fs)
	}
	buf := make([]byte, 4*h.N)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, fmt.Errorf("data rekaman: %w", err)
	}
	uv := make([]float32, h.N)
	for i := range uv {
		uv[i] = math.Float32frombits(binary.LittleEndian.Uint32(buf[4*i:]))
	}
	return &Signal{UV: uv, Trig: h.Trig}, nil
}

func stderr(err error) string {
	if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
		s := strings.TrimSpace(string(ee.Stderr))
		if i := strings.LastIndex(s, "\n"); i >= 0 {
			s = s[i+1:]
		}
		return ": " + s
	}
	return ""
}
