package processor

import (
	"math"
	"os"
	"path/filepath"
	"testing"

	"neurosound-backend/internal/buffer"
	"neurosound-backend/internal/dsp"
)

// Latensi puncak ABR sintetis (ms setelah onset stimulus).
var truthLatency = map[string]float64{"I": 1.6, "III": 3.7, "V": 5.6}

const isiSamples = 91 * Fs / 1000 // 91 ms antar stimulus, sama seperti firmware

// newTestProcessor memakai dsp_worker.py asli; test di-skip kalau venv belum dibuat (scripts/setup.sh).
func newTestProcessor(t *testing.T) *Processor {
	t.Helper()
	root, _ := filepath.Abs("../..")
	py := filepath.Join(root, ".venv", "bin", "python")
	if _, err := os.Stat(py); err != nil {
		t.Skip("python venv belum ada, jalankan scripts/setup.sh")
	}
	runner := dsp.NewRunner(py, filepath.Join(root, "dsp", "dsp_worker.py"))
	return New(Config{Fs: Fs}, buffer.New(32000), runner)
}

func abrUV(tms float64) float64 {
	amp := map[string]float64{"I": 0.3, "III": 0.25, "V": 0.5}
	v := 0.0
	for name, lat := range truthLatency {
		v += amp[name] * math.Exp(-0.5*math.Pow((tms-lat)/0.25, 2))
	}
	return v
}

func uvToRaw(uv float64) int32 {
	return int32(math.Round(uv / RawADCToUV(1)))
}

// feedTrials mengirim n stimulus berisi ABR tanpa noise, lalu frame ekor supaya epoch terakhir lengkap.
func feedTrials(t *testing.T, p *Processor, n int) {
	t.Helper()
	ts := int64(0)
	send := func(uv float64, stim bool) {
		ts += 1_000_000 / Fs
		if _, _, err := p.AddFrame(uvToRaw(uv), 0, ts, stim); err != nil {
			t.Fatalf("AddFrame: %v", err)
		}
	}
	for i := 0; i < preSamples+10; i++ {
		send(0, false)
	}
	for k := 0; k < n; k++ {
		for i := 0; i < isiSamples; i++ {
			send(abrUV(float64(i)/Fs*1000), i == 0)
		}
	}
	for i := 0; i < postSamples; i++ {
		send(0, false)
	}
}

func TestProcessorCountsEveryStimulus(t *testing.T) {
	p := newTestProcessor(t)
	feedTrials(t, p, 5)
	if got := p.Result().TrialCount; got != 5 {
		t.Fatalf("trial_count = %d, want 5", got)
	}
}

// Average harus berisi ABR di posisi preSamples + latensi (epoch dimulai 10 ms sebelum stimulus).
func TestAverageContainsABRAtStimulusOffset(t *testing.T) {
	p := newTestProcessor(t)
	feedTrials(t, p, 5)
	avg := p.Result().ABRAverage[0]
	peak := 0
	for i := preSamples; i < preSamples+int(8.0*Fs/1000); i++ {
		if avg[i] > avg[peak] {
			peak = i
		}
	}
	gotMs := float64(peak-preSamples) / Fs * 1000
	if math.Abs(gotMs-truthLatency["V"]) > 0.1 {
		t.Fatalf("puncak average di %.3f ms setelah stimulus, want %.1f", gotMs, truthLatency["V"])
	}
}

// Latensi yang dilaporkan analysis harus relatif terhadap onset stimulus, bukan awal epoch.
func TestAnalysisLatencyRelativeToStimulus(t *testing.T) {
	p := newTestProcessor(t)
	feedTrials(t, p, 5)
	waves := p.Result().Analysis.Waves
	if len(waves) == 0 {
		t.Fatal("tidak ada gelombang terdeteksi")
	}
	for _, w := range waves {
		want := truthLatency[w.Name]
		if math.Abs(w.Latency-want) > 0.25 || w.Amp < 0.5*abrUV(want) {
			t.Errorf("gelombang %s: %.3f ms / %.3f µV, want %.1f ms / ~%.2f µV",
				w.Name, w.Latency, w.Amp, want, abrUV(want))
		}
	}
}

func TestResetClearsState(t *testing.T) {
	p := newTestProcessor(t)
	feedTrials(t, p, 2)
	p.Reset()
	r := p.Result()
	if r.TrialCount != 0 || r.Status != "Noise" {
		t.Fatalf("after reset: trials=%d status=%s", r.TrialCount, r.Status)
	}
	for _, v := range r.ABRAverage[0] {
		if v != 0 {
			t.Fatal("average tidak kosong setelah reset")
		}
	}
}

func TestRawADCToUV(t *testing.T) {
	// ADS1256: Vref 2.5 V, PGA 1 (±5 V), AD620 ×20 -> 1 LSB = 5 V / 2^23 / 20 ≈ 0.0298 µV
	if got := RawADCToUV(1); math.Abs(got-0.029802) > 1e-5 {
		t.Fatalf("RawADCToUV(1) = %f", got)
	}
}

// Epoch berisi lonjakan salah-baca (skala penuh) dibuang, tidak ikut dirata-rata.
func TestArtifactEpochRejected(t *testing.T) {
	p := newTestProcessor(t)
	ts := int64(0)
	send := func(uv float64, stim bool) {
		ts += 1_000_000 / Fs
		if _, _, err := p.AddFrame(uvToRaw(uv), 0, ts, stim); err != nil {
			t.Fatalf("AddFrame: %v", err)
		}
	}
	for i := 0; i < preSamples+10; i++ {
		send(0, false)
	}
	for k := 0; k < 4; k++ {
		for i := 0; i < isiSamples; i++ {
			uv := abrUV(float64(i) / Fs * 1000)
			if k == 2 && i == 300 {
				uv = 250000 // 0x7FFFFF di 20 ms setelah onset ketiga
			}
			send(uv, i == 0)
		}
	}
	for i := 0; i < postSamples; i++ {
		send(0, false)
	}
	r := p.Result()
	if r.TrialCount != 3 || r.Rejected != 1 {
		t.Fatalf("trial %d rejected %d, want 3 dan 1", r.TrialCount, r.Rejected)
	}
	for _, v := range r.ABRAverage[0] {
		if math.Abs(v) > 5 {
			t.Fatalf("lonjakan ikut ke rata-rata: %.1f µV", v)
		}
	}
}

// r split-half: ABR yang sama di setiap epoch → sub-rata-rata ganjil dan genap identik.
func TestSplitHalfCorrelation(t *testing.T) {
	p := newTestProcessor(t)
	feedTrials(t, p, 6)
	if r := p.Result(); r.PearsonR < 0.99 || r.SNR[0] < 10 {
		t.Fatalf("r %.3f snr %.1f, want r ≈ 1 dan SNR tinggi untuk ABR tanpa noise", r.PearsonR, r.SNR[0])
	}
}
