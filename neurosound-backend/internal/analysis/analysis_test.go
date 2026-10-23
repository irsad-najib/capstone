package analysis

import (
	"math"
	"testing"
)

const fs = 16000

// synth membuat waveform dengan puncak Gaussian di latensi tertentu (ms, dihitung dari index 0).
func synth(n int, peaks map[float64]float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		tms := float64(i) / fs * 1000
		for lat, amp := range peaks {
			out[i] += amp * math.Exp(-0.5*math.Pow((tms-lat)/0.25, 2))
		}
	}
	return out
}

func TestDetectWavesFindsKnownLatencies(t *testing.T) {
	want := map[string]float64{"I": 1.6, "III": 3.7, "V": 5.6}
	avg := synth(800, map[float64]float64{1.6: 0.3, 3.7: 0.25, 5.6: 0.5})

	d := Compute(avg, fs, 10, "Konvergen")
	if len(d.Waves) != 3 {
		t.Fatalf("waves = %+v", d.Waves)
	}
	for _, w := range d.Waves {
		if math.Abs(w.Latency-want[w.Name]) > 1000.0/fs {
			t.Errorf("wave %s latency = %.3f ms, want %.3f", w.Name, w.Latency, want[w.Name])
		}
	}
	if got := d.Interpeak["I-V"]; math.Abs(got-4.0) > 0.13 {
		t.Errorf("I-V interpeak = %.3f, want ~4.0", got)
	}
}

func TestVerdict(t *testing.T) {
	avg := synth(800, map[float64]float64{1.6: 0.3, 3.7: 0.25, 5.6: 0.5})
	cases := []struct {
		status string
		snr    float64
		want   string
	}{
		{"Konvergen", 6, "Pass"},
		{"Konvergen", 1, "Refer"},
		{"Terbentuk", 6, "Refer"},
		{"Noise", 6, "Refer"},
	}
	for _, c := range cases {
		if got := Compute(avg, fs, c.snr, c.status).Verdict; got != c.want {
			t.Errorf("status=%s snr=%.0f: verdict %s, want %s", c.status, c.snr, got, c.want)
		}
	}
}

func TestComputeEmptyInput(t *testing.T) {
	d := Compute(nil, fs, 0, "Noise")
	if len(d.Waves) != 0 || d.Verdict != "Refer" {
		t.Fatalf("empty input: %+v", d)
	}
}

func TestComputeZeroAverageHasNoWaves(t *testing.T) {
	d := Compute(make([]float64, 800), fs, 0, "Noise")
	if len(d.Waves) != 0 || len(d.Interpeak) != 0 {
		t.Fatalf("average nol tidak boleh menghasilkan gelombang: %+v", d)
	}
}

// Lembah negatif yang lebih dalam dari puncak tidak boleh terpilih sebagai gelombang.
func TestDetectWavesIgnoresDeeperTrough(t *testing.T) {
	avg := synth(800, map[float64]float64{1.6: 0.3, 3.7: 0.25, 5.6: 0.5, 7.0: -0.9})
	for _, w := range Compute(avg, fs, 10, "Konvergen").Waves {
		if w.Name == "V" && (math.Abs(w.Latency-5.6) > 1000.0/fs || w.Amp <= 0) {
			t.Fatalf("wave V = %+v, want puncak positif di 5.6 ms", w)
		}
	}
}

func TestClassifyNormal(t *testing.T) {
	cases := []struct {
		name   string
		peaks  map[float64]float64
		status string
		snr    float64
		want   bool
	}{
		{"normal", map[float64]float64{1.6: 0.3, 3.7: 0.25, 5.6: 0.5}, "Konvergen", 6, true},
		// I-V 5.0 ms (III-V 2.3 ms) → konduksi batang otak melambat.
		{"I-V memanjang", map[float64]float64{1.6: 0.3, 4.3: 0.25, 6.6: 0.5}, "Konvergen", 6, false},
		{"belum konvergen", map[float64]float64{1.6: 0.3, 3.7: 0.25, 5.6: 0.5}, "Terbentuk", 6, false},
		{"tanpa respons", nil, "Konvergen", 0.5, false},
	}
	for _, c := range cases {
		d := Compute(synth(800, c.peaks), fs, c.snr, c.status)
		if d.Normal != c.want {
			t.Errorf("%s: normal = %v, want %v (reasons %v, interpeak %v)", c.name, d.Normal, c.want, d.Reasons, d.Interpeak)
		}
		if !d.Normal && len(d.Reasons) == 0 {
			t.Errorf("%s: tidak normal tapi tanpa alasan", c.name)
		}
	}
}
