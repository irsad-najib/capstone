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

const (
	Fs           = 16000
	EpochMs      = 60.0
	preSamples   = 160
	postSamples  = 800
	epochSamples = preSamples + postSamples
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
	Quality      string          `json:"quality"`
	Status       string          `json:"status"`
	SNR          []float64       `json:"snr"`
	PearsonR     float64         `json:"pearson_r"`
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
	snr          []float64
	pearson      float64
	status       string
	snapshots    []session.Snapshot
	lastRaw      RawResult
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
	}
}

func RawADCToUV(raw int32) float64 {
	return float64(raw) * (2 * 4.5) / math.Pow(2, 24) / 24 * 1e6
}

func (p *Processor) AddFrame(rawCh1, rawCh2 int32, ts int64, stim bool) (*Result, bool, error) {
	frame := p.ring.Push(buffer.Frame{
		Ch1:  RawADCToUV(rawCh1),
		Ch2:  RawADCToUV(rawCh2),
		Raw1: rawCh1,
		Raw2: rawCh2,
		TS:   ts,
		Stim: stim,
	})

	p.mu.Lock()
	if stim {
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
	if currentSeq-stimSeq < postSamples-1 {
		return nil, false, nil
	}
	p.pendingStims = p.pendingStims[1:]
	start := stimSeq - preSamples
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
	p.trials++
	p.avgCh1 = result.AvgCh1
	p.avgCh2 = result.AvgCh2
	p.snr = []float64{round1(result.SNRCh1), round1(result.SNRCh2)}
	p.pearson = result.PearsonR
	p.status = result.Status

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
	detail := analysis.Compute(p.avgCh1, p.cfg.Fs, p.snr[0], p.status)
	return Result{
		TrialCount:   p.trials,
		ABRAverage:   avg,
		SamplingRate: p.cfg.Fs,
		EpochMs:      EpochMs,
		Quality:      p.status,
		Status:       p.status,
		SNR:          append([]float64(nil), p.snr...),
		PearsonR:     p.pearson,
		Analysis:     detail,
	}
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
