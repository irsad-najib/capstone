package processor

import (
	"fmt"
	"math"
	"sync"
	"time"

	"neurosound-backend/internal/analysis"
	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
	"neurosound-backend/internal/session"
)

// Fs = laju sampel firmware esp-ads1256/ (ADS1256 DRATE 15 kSPS, satu kanal per sesi).
// Pesan biner membawa laju sampelnya sendiri; yang tidak sama dengan Fs ditolak di ws.
const (
	Fs           = 15000
	EpochMs      = 60.0
	PreStimMs    = 10.0
	preSamples   = int(PreStimMs * Fs / 1000)
	postSamples  = int((EpochMs - PreStimMs) * Fs / 1000)
	epochSamples = preSamples + postSamples

	// Jendela respons untuk r split-half dan SNR: 1-10 ms setelah onset (gelombang I-V).
	respFromMs = 1.0
	respToMs   = 10.0

	// Status: Noise < MinTrials; Konvergen ≥ ConvergeTrials dan r split-half ≥ ConvergeR.
	// Dua rata-rata berisi noise saja: r di 1-10 ms bersimpangan ±0.19 (~27 derajat bebas
	// pada pita 100-3000 Hz), jadi r ≥ 0.4 ≈ 2 % positif palsu.
	MinTrials      = 100
	ConvergeTrials = 500
	ConvergeR      = 0.4
)

// Rantai analog default: AD620 (gain AmpGain) → ADS1256 (VREF 2.5 V, PGA 1).
// Skala penuh ADS1256 = ±2·VREF/PGA untuk kode ±2^23. Dipakai untuk frame JSON dan
// generator dummy; pesan biner versi 2 membawa µV per LSB dari firmware.
const (
	ADCVref = 2.5
	ADCPGA  = 1
	AmpGain = 20.0
)

type Config struct {
	Fs            int
	PythonPath    string
	DSPWorkerPath string
	SnapshotEvery int
}

type Result struct {
	TrialCount   int             `json:"trial_count"`
	ABRAverage   [][]float64     `json:"abr_average"`
	SamplingRate int             `json:"sampling_rate"`
	EpochMs      float64         `json:"epoch_ms"`
	PreStimMs    float64         `json:"pre_stim_ms"`
	StimCount    int             `json:"stim_count"`
	FrameCount   int64           `json:"frame_count"`
	Quality      string          `json:"quality"`
	Status       string          `json:"status"`
	SNR          []float64       `json:"snr"`       // ± average: (A+B)/2 vs (A−B)/2 di 1-10 ms
	PearsonR     float64         `json:"pearson_r"` // korelasi sub-rata-rata ganjil vs genap di 1-10 ms
	Rejected     int             `json:"rejected"`  // epoch dibuang (artefak)
	Analysis     analysis.Detail `json:"analysis"`
}

type RawResult struct {
	Samples      [][]float64 `json:"samples"`
	Stim         []bool      `json:"stim"`
	SamplingRate int         `json:"sampling_rate"`
	WindowMs     float64     `json:"window_ms"`
}

type Processor struct {
	mu           sync.RWMutex
	cfg          Config
	ring         *buffer.RingBuffer
	dsp          *dsp.Runner
	pendingStims []int64
	avgCh1       []float64
	avgCh2       []float64
	trials       int
	rejected     int
	stims        int
	// Jumlah epoch terfilter ganjil (A) dan genap (B) untuk r split-half dan SNR ± average.
	sumA, sumB []float64
	nA, nB     int
	frames     int64
	snr        []float64
	pearson    float64
	status     string
	snapshots  []session.Snapshot
	lastRaw    RawResult
}

func New(cfg Config, ring *buffer.RingBuffer, runner *dsp.Runner) *Processor {
	if cfg.Fs == 0 {
		cfg.Fs = Fs
	}
	if cfg.SnapshotEvery == 0 {
		cfg.SnapshotEvery = 100
	}
	return &Processor{
		cfg:    cfg,
		ring:   ring,
		dsp:    runner,
		avgCh1: make([]float64, epochSamples),
		avgCh2: make([]float64, epochSamples),
		snr:    []float64{0, 0},
		status: "Noise",
		sumA:   make([]float64, epochSamples),
		sumB:   make([]float64, epochSamples),
	}
}

// RawADCToUV mengubah kode ADC ke µV di elektroda dengan rantai analog default.
func RawADCToUV(raw int32) float64 {
	return float64(raw) * (2 * ADCVref / ADCPGA) / math.Pow(2, 23) / AmpGain * 1e6
}

func (p *Processor) AddFrame(rawCh1, rawCh2 int32, ts int64, stim bool) (*Result, bool, error) {
	return p.AddFrameScaled(rawCh1, rawCh2, RawADCToUV(1), ts, stim)
}

// AddFrameScaled sama dengan AddFrame, dengan µV per LSB dari firmware (PGA bisa diganti di ESP32).
func (p *Processor) AddFrameScaled(rawCh1, rawCh2 int32, uvPerLSB float64, ts int64, stim bool) (*Result, bool, error) {
	frame := p.ring.Push(buffer.Frame{
		Ch1:  float64(rawCh1) * uvPerLSB,
		Ch2:  float64(rawCh2) * uvPerLSB,
		Raw1: rawCh1,
		Raw2: rawCh2,
		TS:   ts,
		Stim: stim,
	})

	p.mu.Lock()
	p.frames++
	if stim {
		p.stims++
		p.pendingStims = append(p.pendingStims, frame.Seq)
	}
	p.lastRaw = p.rawResultLocked(200)
	p.mu.Unlock()

	return p.processReady(frame.Seq)
}

func (p *Processor) processReady(currentSeq int64) (*Result, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.pendingStims) == 0 {
		return nil, false, nil
	}
	stimSeq := p.pendingStims[0]
	if currentSeq-stimSeq < int64(postSamples-1) {
		return nil, false, nil
	}
	p.pendingStims = p.pendingStims[1:]
	start := stimSeq - int64(preSamples)
	if start < 0 {
		return nil, false, nil
	}
	frames, ok := p.ring.GetRange(start, epochSamples)
	if !ok {
		return nil, false, nil
	}
	epochCh1 := make([]float64, epochSamples)
	epochCh2 := make([]float64, epochSamples)
	for i, f := range frames {
		epochCh1[i] = f.Ch1
		epochCh2[i] = f.Ch2
	}

	input := dsp.EpochInput{
		EpochCh1: epochCh1, EpochCh2: epochCh2,
		RunningAvgCh1: p.avgCh1, RunningAvgCh2: p.avgCh2,
		NTrials: p.trials, Fs: p.cfg.Fs,
	}
	result, err := p.dsp.RunDSP(input)
	if err != nil {
		return nil, false, err
	}
	if result.Rejected {
		p.rejected++
		out := p.resultLocked()
		return &out, true, nil
	}
	p.trials++
	p.avgCh1 = result.AvgCh1
	p.avgCh2 = result.AvgCh2
	p.addSplitLocked(result.FilteredCh1)
	p.pearson, p.snr[0] = p.splitStatsLocked()
	p.snr[1] = round1(result.SNRCh2)
	p.status = statusFor(p.trials, p.pearson)

	if p.trials%p.cfg.SnapshotEvery == 0 {
		p.snapshots = append(p.snapshots, session.Snapshot{
			TrialCount: p.trials,
			ABRAverage: p.copyAvgLocked(),
			PearsonR:   result.PearsonR,
		})
	}

	out := p.resultLocked()
	return &out, true, nil
}

func (p *Processor) Result() Result {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.resultLocked()
}

func (p *Processor) Raw(windowMs float64) RawResult {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.rawResultLocked(windowMs)
}

func (p *Processor) Reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ring.Clear()
	p.pendingStims = nil
	p.avgCh1 = make([]float64, epochSamples)
	p.avgCh2 = make([]float64, epochSamples)
	p.trials = 0
	p.rejected = 0
	p.sumA = make([]float64, epochSamples)
	p.sumB = make([]float64, epochSamples)
	p.nA, p.nB = 0, 0
	p.stims = 0
	p.frames = 0
	p.snr = []float64{0, 0}
	p.pearson = 0
	p.status = "Noise"
	p.snapshots = nil
	p.lastRaw = RawResult{}
}

func (p *Processor) SessionDocument(filename string) session.Document {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := p.resultLocked()
	return session.Document{
		Filename:     filename,
		SavedAt:      time.Now(),
		TrialCount:   result.TrialCount,
		SamplingRate: result.SamplingRate,
		EpochMs:      result.EpochMs,
		PreStimMs:    result.PreStimMs,
		ABRAverage:   result.ABRAverage,
		ABRSnapshots: append([]session.Snapshot(nil), p.snapshots...),
		SNR:          result.SNR,
		PearsonR:     result.PearsonR,
		Quality:      result.Quality,
		Status:       result.Status,
		Analysis:     result.Analysis,
	}
}

func (p *Processor) resultLocked() Result {
	avg := p.copyAvgLocked()
	// Epoch dimulai PreStimMs sebelum stimulus; latensi gelombang dihitung dari onset.
	detail := analysis.Compute(p.avgCh1[preSamples:], p.cfg.Fs, p.snr[0], p.status)
	return Result{
		TrialCount:   p.trials,
		ABRAverage:   avg,
		SamplingRate: p.cfg.Fs,
		EpochMs:      EpochMs,
		PreStimMs:    PreStimMs,
		StimCount:    p.stims,
		FrameCount:   p.frames,
		Quality:      p.status,
		Status:       p.status,
		SNR:          append([]float64(nil), p.snr...),
		PearsonR:     p.pearson,
		Rejected:     p.rejected,
		Analysis:     detail,
	}
}

func (p *Processor) addSplitLocked(filtered []float64) {
	if len(filtered) != epochSamples {
		return
	}
	sum := p.sumA
	if p.trials%2 == 0 {
		sum = p.sumB
		p.nB++
	} else {
		p.nA++
	}
	for i, v := range filtered {
		sum[i] += v
	}
}

// splitStatsLocked: r = korelasi sub-rata-rata A dan B; SNR = daya (A+B)/2 dikurangi daya
// noise (A−B)/2, dibagi daya noise (dB). Keduanya di jendela respons 1-10 ms.
func (p *Processor) splitStatsLocked() (r, snr float64) {
	if p.nA == 0 || p.nB == 0 {
		return 0, 0
	}
	from := preSamples + int(respFromMs*float64(p.cfg.Fs)/1000)
	to := preSamples + int(respToMs*float64(p.cfg.Fs)/1000)
	a := make([]float64, to-from)
	b := make([]float64, to-from)
	var ps, pn float64
	for i := range a {
		a[i] = p.sumA[from+i] / float64(p.nA)
		b[i] = p.sumB[from+i] / float64(p.nB)
		s, n := (a[i]+b[i])/2, (a[i]-b[i])/2
		ps += s * s
		pn += n * n
	}
	r = math.Round(pearson(a, b)*1000) / 1000
	if pn == 0 {
		if ps > 0 {
			return r, 60 // tanpa noise (data sintetis): batas atas
		}
		return r, 0
	}
	ratio := (ps - pn) / pn
	if ratio < 0.01 {
		ratio = 0.01 // −20 dB: tidak ada sinyal di atas noise
	}
	return r, round1(10 * math.Log10(ratio))
}

func statusFor(trials int, r float64) string {
	switch {
	case trials < MinTrials:
		return "Noise"
	case trials >= ConvergeTrials && r >= ConvergeR:
		return "Konvergen"
	default:
		return "Terbentuk"
	}
}

func pearson(a, b []float64) float64 {
	n := float64(len(a))
	if n < 2 {
		return 0
	}
	var ma, mb float64
	for i := range a {
		ma += a[i]
		mb += b[i]
	}
	ma, mb = ma/n, mb/n
	var sab, saa, sbb float64
	for i := range a {
		da, db := a[i]-ma, b[i]-mb
		sab += da * db
		saa += da * da
		sbb += db * db
	}
	if saa == 0 || sbb == 0 {
		return 0
	}
	return sab / math.Sqrt(saa*sbb)
}

func (p *Processor) rawResultLocked(windowMs float64) RawResult {
	n := int(float64(p.cfg.Fs) * windowMs / 1000)
	frames := p.ring.GetLast(n)
	ch1 := make([]float64, len(frames))
	ch2 := make([]float64, len(frames))
	stim := make([]bool, len(frames))
	for i, f := range frames {
		ch1[i] = f.Ch1
		ch2[i] = f.Ch2
		stim[i] = f.Stim
	}
	return RawResult{Samples: [][]float64{ch1, ch2}, Stim: stim, SamplingRate: p.cfg.Fs, WindowMs: windowMs}
}

func (p *Processor) copyAvgLocked() [][]float64 {
	ch1 := append([]float64(nil), p.avgCh1...)
	ch2 := append([]float64(nil), p.avgCh2...)
	return [][]float64{ch1, ch2}
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func FilenameNow() string {
	return fmt.Sprintf("eeg_abr_%d.json", time.Now().Unix())
}
