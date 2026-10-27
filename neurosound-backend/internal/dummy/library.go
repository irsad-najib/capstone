package dummy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	Storage     string          `json:"storage"` // StorageMongo atau StorageDir
}

const (
	StorageMongo = "mongodb"
	StorageDir   = "dir"
)

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
// Sumber utama MongoDB (Store); folder Dir dipakai kalau Mongo kosong / tidak tersambung.
type Library struct {
	Dir, Python, Script string
	Store               *Mongo

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
	var mongoErr error
	if l.Store != nil {
		c, err := l.Store.catalog(ctx)
		if err == nil && len(c.Recordings) > 0 {
			l.catalog = c
			return c, nil
		}
		mongoErr = err
	}
	if l.Dir == "" {
		if mongoErr != nil {
			return nil, mongoErr
		}
		return &Catalog{Dir: "mongodb (gridfs: dummy)", Recordings: []Recording{}}, nil
	}
	out, err := exec.CommandContext(ctx, l.Python, l.Script, "--list", l.Dir).Output()
	if err != nil {
		return nil, fmt.Errorf("baca %s: %w%s", l.Dir, err, stderr(err))
	}
	var c Catalog
	if err := json.Unmarshal(out, &c); err != nil {
		return nil, fmt.Errorf("daftar rekaman bukan JSON: %w", err)
	}
	c.Dir = l.Dir
	for i := range c.Recordings {
		c.Recordings[i].Storage = StorageDir
	}
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
	var sig *Signal
	if rec.Storage == StorageMongo {
		var data []byte
		if data, err = l.Store.open(file); err == nil {
			sig, err = l.read("-", bytes.NewReader(data))
		}
	} else {
		sig, err = l.read(filepath.Join(l.Dir, filepath.Base(file)), nil)
	}
	if err != nil {
		return nil, nil, err
	}
	l.cached, l.signal = file, sig
	return sig, rec, nil
}

// read menjalankan dummy_npz.py untuk path; path "-" = isi .npz dari stdin.
func (l *Library) read(path string, stdin io.Reader) (*Signal, error) {
	cmd := exec.Command(l.Python, l.Script, path, "--fs", fmt.Sprint(processor.Fs))
	cmd.Stdin = stdin
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

var (
	ErrNoStore  = errors.New("upload butuh MongoDB (MONGO_URI)")
	ErrBadName  = errors.New("nama file harus <nama>.npz atau ground_truth.json (huruf, angka, . _ -)")
	validName   = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	MaxFileSize = int64(64 << 20)
)

// Upload menyimpan satu rekaman .npz (atau ground_truth.json) ke MongoDB.
// Rekaman dengan nama sama diganti. Mengembalikan info rekaman (nil untuk ground truth).
func (l *Library) Upload(ctx context.Context, name string, data []byte) (*Recording, error) {
	if l.Store == nil {
		return nil, ErrNoStore
	}
	if !validName.MatchString(name) || (name != groundTruthID+".json" && !strings.HasSuffix(name, ".npz")) {
		return nil, ErrBadName
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	if name == groundTruthID+".json" {
		out, err := l.python(ctx, data, "--gt", "-")
		if err != nil {
			return nil, err
		}
		if err := l.Store.putGroundTruth(ctx, out); err != nil {
			return nil, err
		}
		l.invalidate("")
		return nil, nil
	}

	out, err := l.python(ctx, data, "--info", "-")
	if err != nil {
		return nil, err
	}
	rec := Recording{File: name, Storage: StorageMongo}
	if err := json.Unmarshal(out, &rec); err != nil {
		return nil, fmt.Errorf("info rekaman: %w", err)
	}
	if err := l.Store.putRecording(ctx, rec, data); err != nil {
		return nil, err
	}
	l.invalidate(name)
	return &rec, nil
}

func (l *Library) python(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, l.Python, append([]string{l.Script}, args...)...)
	cmd.Stdin = bytes.NewReader(stdin)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("dummy_npz.py %s: %w%s", args[0], err, stderr(err))
	}
	return out, nil
}

// invalidate membuang cache daftar rekaman (dan sinyal file itu kalau sedang di-cache).
func (l *Library) invalidate(file string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.catalog = nil
	if file != "" && l.cached == file {
		l.cached, l.signal = "", nil
	}
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
