package abr

import (
	"capstone/internal/dsp"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sync"
	"time"
)

// Config parameter akuisisi ABR.
type Config struct {
	SamplingRate float64 // Hz dari ESP32
	EpochMs      float64 // panjang epoch (default 50ms)
	MaxTrials    int     // batas trials (default 4000)
	ADS1115Mode  bool    // kalau true, SamplingRate di-override ke 860 Hz
}

func DefaultConfig() Config {
	return Config{
		SamplingRate: 500,
		EpochMs:      50,
		MaxTrials:    4000,
		ADS1115Mode:  false,
	}
}

// Frame adalah satu frame EEG dari ESP32 (8 channel, raw int32).
type Frame struct {
	Channels  [8]int32
	Timestamp time.Time
}

// Snapshot adalah hasil averaging pada interval tertentu (tiap 100 trials).
type Snapshot struct {
	TrialCount int         `json:"trial_count"`
	ABRAverage [][]float64 `json:"abr_average"`
}

// Result adalah hasil ABR real-time yang di-expose via API.
type Result struct {
	TrialCount   int         `json:"trial_count"`
	ABRAverage   [][]float64 `json:"abr_average"`
	SamplingRate float64     `json:"sampling_rate"`
	EpochMs      float64     `json:"epoch_ms"`
	Quality      string      `json:"quality"`
	SNR          []float64   `json:"snr"`
}

const nChannels = 8

// Processor mengelola epoch extraction dan running ABR average.
type Processor struct {
	mu            sync.RWMutex
	cfg           Config
	buf           [][nChannels]float64
	bufTimes      []time.Time
	bufHead       int
	bufFull       bool
	stimLog       []time.Time
	processedStim map[int]bool
	epochs        [nChannels][][]float64
	abrAvg        [nChannels][]float64
	trialCount    int
	epochSamples  int
	snapshots     []Snapshot
	lastSnapshot  int
}

func NewProcessor(cfg Config) *Processor {
	if cfg.ADS1115Mode {
		cfg.SamplingRate = 860
	}
	epochSamp := int(cfg.SamplingRate * cfg.EpochMs / 1000)
	if epochSamp < 1 {
		epochSamp = 25
	}
	bufSize := int(cfg.SamplingRate * 3) // 3 detik ring buffer

	p := &Processor{
		cfg:           cfg,
		buf:           make([][nChannels]float64, bufSize),
		bufTimes:      make([]time.Time, bufSize),
		processedStim: make(map[int]bool),
		epochSamples:  epochSamp,
	}
	for ch := 0; ch < nChannels; ch++ {
		p.abrAvg[ch] = make([]float64, epochSamp)
	}
	return p
}

// AddFrame menambah satu frame EEG ke ring buffer.
// Konversi int32 raw ke µV: gain=24, Vref=4.5V, 24-bit ADC.
func (p *Processor) AddFrame(f Frame) {
	const lsbToUV = 4.5 / (8388608.0 * 24) * 1e6

	p.mu.Lock()
	defer p.mu.Unlock()

	var s [nChannels]float64
	for ch := 0; ch < nChannels; ch++ {
		s[ch] = float64(f.Channels[ch]) * lsbToUV
	}

	p.buf[p.bufHead] = s
	p.bufTimes[p.bufHead] = f.Timestamp
	p.bufHead = (p.bufHead + 1) % len(p.buf)
	if p.bufHead == 0 {
		p.bufFull = true
	}

	p.tryExtractEpochs(f.Timestamp)
}

// AddFrameFromJSON mem-parse JSON frame dari ESP32 WebSocket.
// Format: {"type":"eeg","device":"esp32-001","ch":[v1,v2,...,v8]}
func (p *Processor) AddFrameFromJSON(raw []byte) error {
	var msg struct {
		Type    string  `json:"type"`
		Device  string  `json:"device"`
		Ch      []int32 `json:"ch"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return err
	}
	if msg.Type != "eeg" || len(msg.Ch) < nChannels {
		return nil // bukan frame EEG, skip tanpa error
	}
	var f Frame
	for i := 0; i < nChannels; i++ {
		f.Channels[i] = msg.Ch[i]
	}
	f.Timestamp = time.Now()
	p.AddFrame(f)
	return nil
}

// AddADS1115Frame menambah satu sample dari ADS1115 single-channel ke processor.
// raw: raw int16 dari ADC; stimFlag: true kalau sample ini tepat setelah klik stimulus.
// Konversi: ADS1115 GAIN_ONE, LSB = 0.125 mV → µV = raw * (4096.0 / 32768.0)
func (p *Processor) AddADS1115Frame(raw int16, stimFlag bool, ts time.Time) {
	const lsbToUV = 4096.0 / 32768.0 // mV per LSB (GAIN_ONE: FSR ±4.096V, 16-bit signed)
	uv := float64(raw) * lsbToUV

	p.mu.Lock()
	defer p.mu.Unlock()

	// Catat stimulus sebelum frame masuk buffer (urutan penting untuk epoch extraction)
	if stimFlag {
		p.stimLog = append(p.stimLog, ts)
	}

	var s [nChannels]float64
	s[0] = uv
	// channels 1-7 tetap 0

	p.buf[p.bufHead] = s
	p.bufTimes[p.bufHead] = ts
	p.bufHead = (p.bufHead + 1) % len(p.buf)
	if p.bufHead == 0 {
		p.bufFull = true
	}

	p.tryExtractEpochs(ts)
}

// LogStimulus mencatat waktu click stimulus dikirim ke ESP32.
func (p *Processor) LogStimulus(t time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stimLog = append(p.stimLog, t)
}

// tryExtractEpochs harus dipanggil di dalam mu.Lock().
func (p *Processor) tryExtractEpochs(now time.Time) {
	epochDur := time.Duration(p.cfg.EpochMs * float64(time.Millisecond))
	windowStart := now.Add(-3 * time.Second)

	for idx, stimT := range p.stimLog {
		if p.processedStim[idx] {
			continue
		}
		if stimT.Before(windowStart) || stimT.Add(epochDur).After(now) {
			continue
		}
		stimEnd := stimT.Add(epochDur)

		// Kumpulkan samples dalam window [stimT, stimEnd]
		var raw [nChannels][]float64
		bufSize := len(p.buf)
		for i := 0; i < bufSize; i++ {
			t := p.bufTimes[i]
			if t.IsZero() || t.Before(stimT) || t.After(stimEnd) {
				continue
			}
			for ch := 0; ch < nChannels; ch++ {
				raw[ch] = append(raw[ch], p.buf[i][ch])
			}
		}
		if len(raw[0]) < p.epochSamples/2 {
			continue
		}

		// Resample → filter → baseline correction
		for ch := 0; ch < nChannels; ch++ {
			e := dsp.ResampleLinear(raw[ch], p.epochSamples)
			e = dsp.SafeBandpass(e, 100, capHz(3000, p.cfg.SamplingRate), p.cfg.SamplingRate)
			baseN := max1(int(p.cfg.SamplingRate * 0.001))
			var sum float64
			for i := 0; i < baseN && i < len(e); i++ {
				sum += e[i]
			}
			base := sum / float64(baseN)
			for i := range e {
				e[i] -= base
			}
			p.epochs[ch] = append(p.epochs[ch], e)
		}

		p.processedStim[idx] = true
		n := len(p.epochs[0])
		p.trialCount = n

		// Running average
		for ch := 0; ch < nChannels; ch++ {
			last := p.epochs[ch][n-1]
			for i := 0; i < p.epochSamples && i < len(last); i++ {
				p.abrAvg[ch][i] = (p.abrAvg[ch][i]*float64(n-1) + last[i]) / float64(n)
			}
		}

		// Snapshot tiap 100 trials
		if n%100 == 0 && n != p.lastSnapshot {
			snap := Snapshot{TrialCount: n, ABRAverage: p.copyAvg()}
			p.snapshots = append(p.snapshots, snap)
			p.lastSnapshot = n
		}
	}
}

// Result mengembalikan hasil ABR terkini (thread-safe).
func (p *Processor) Result() Result {
	p.mu.RLock()
	defer p.mu.RUnlock()

	snr := make([]float64, nChannels)
	for ch := 0; ch < nChannels; ch++ {
		db, _, _ := ComputeSNR(p.abrAvg[ch], p.cfg.EpochMs)
		snr[ch] = math.Round(db*10) / 10
	}

	qual := "Noise"
	switch {
	case p.trialCount >= 500:
		qual = "Konvergen"
	case p.trialCount >= 100:
		qual = "Mulai terbentuk"
	}

	return Result{
		TrialCount:   p.trialCount,
		ABRAverage:   p.copyAvg(),
		SamplingRate: p.cfg.SamplingRate,
		EpochMs:      p.cfg.EpochMs,
		Quality:      qual,
		SNR:          snr,
	}
}

// SaveJSON menyimpan hasil session ke file JSON.
func (p *Processor) SaveJSON(filename string) error {
	p.mu.RLock()
	defer p.mu.RUnlock()

	out := map[string]any{
		"sampling_rate": p.cfg.SamplingRate,
		"epoch_ms":      p.cfg.EpochMs,
		"trial_count":   p.trialCount,
		"abr_average":   p.copyAvg(),
		"abr_snapshots": p.snapshots,
	}
	f, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		return err
	}
	fmt.Printf("[ABR] Saved → %s (%d trials)\n", filename, p.trialCount)
	return nil
}

// RawResult adalah snapshot ring buffer terbaru untuk ditampilkan sebagai raw waveform.
type RawResult struct {
	Samples      [][]float64 `json:"samples"`       // [nChannels][nSamples]
	SamplingRate float64     `json:"sampling_rate"`
	WindowMs     float64     `json:"window_ms"`
}

// RecentSamples mengembalikan sampel mentah dari ring buffer dalam window terakhir (ms).
func (p *Processor) RecentSamples(windowMs float64) RawResult {
	p.mu.RLock()
	defer p.mu.RUnlock()

	cutoff := time.Now().Add(-time.Duration(windowMs * float64(time.Millisecond)))
	bufSize := len(p.buf)

	// Iterasi ring buffer secara urut waktu
	start := 0
	if p.bufFull {
		start = p.bufHead
	}

	out := make([][]float64, nChannels)
	for ch := range out {
		out[ch] = make([]float64, 0, 256)
	}

	for i := 0; i < bufSize; i++ {
		idx := (start + i) % bufSize
		if p.bufTimes[idx].IsZero() || p.bufTimes[idx].Before(cutoff) {
			continue
		}
		for ch := 0; ch < nChannels; ch++ {
			out[ch] = append(out[ch], p.buf[idx][ch])
		}
	}

	return RawResult{
		Samples:      out,
		SamplingRate: p.cfg.SamplingRate,
		WindowMs:     windowMs,
	}
}

// Reset menghapus semua data accumulated — trial, epoch, buffer, stimLog.
func (p *Processor) Reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := range p.buf {
		p.buf[i] = [nChannels]float64{}
		p.bufTimes[i] = time.Time{}
	}
	p.bufHead = 0
	p.bufFull = false
	p.stimLog = nil
	p.processedStim = make(map[int]bool)
	for ch := 0; ch < nChannels; ch++ {
		p.epochs[ch] = nil
		for i := range p.abrAvg[ch] {
			p.abrAvg[ch][i] = 0
		}
	}
	p.trialCount = 0
	p.snapshots = nil
	p.lastSnapshot = 0
}

func (p *Processor) Snapshots() []Snapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]Snapshot, len(p.snapshots))
	copy(out, p.snapshots)
	return out
}

func (p *Processor) copyAvg() [][]float64 {
	avg := make([][]float64, nChannels)
	for ch := 0; ch < nChannels; ch++ {
		avg[ch] = make([]float64, len(p.abrAvg[ch]))
		copy(avg[ch], p.abrAvg[ch])
	}
	return avg
}

func capHz(max, fs float64) float64 {
	if cap := fs * 0.475; cap < max {
		return cap
	}
	return max
}

func max1(n int) int {
	if n < 1 {
		return 1
	}
	return n
}
