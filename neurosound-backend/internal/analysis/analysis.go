package analysis

import (
	"fmt"
	"math"
)

type WaveInfo struct {
	Name    string  `json:"name" bson:"name"`
	Latency float64 `json:"latency_ms" bson:"latency_ms"`
	Amp     float64 `json:"amplitude_uv" bson:"amplitude_uv"`
}

type Detail struct {
	Waves     []WaveInfo         `json:"waves" bson:"waves"`
	Interpeak map[string]float64 `json:"interpeak_ms" bson:"interpeak_ms"`
	Verdict   string             `json:"verdict" bson:"verdict"`
	// Normal = Pass dan semua interpeak di dalam rentang normal dewasa (Norms).
	Normal  bool     `json:"normal" bson:"normal"`
	Reasons []string `json:"reasons" bson:"reasons"` // alasan kalau tidak normal
}

// Norm = rata-rata ± SD orang dewasa pendengaran normal, stimulus click 85 dB nHL
// (60 orang, scielo.br/j/pfono/a/zfBnyMZ57BVdcnXfn8zYK6k). Rentang normal = Mean ± 2 SD; batas atas I-V jadi
// 4.40 ms, sama dengan cutoff retrokoklear yang umum dipakai.
type Norm struct {
	Mean float64 `json:"mean_ms"`
	SD   float64 `json:"sd_ms"`
}

func (n Norm) Min() float64 { return round3(n.Mean - 2*n.SD) }
func (n Norm) Max() float64 { return round3(n.Mean + 2*n.SD) }

// Interpeak dipakai (bukan latensi absolut) karena hampir tidak berubah terhadap
// level stimulus, sedangkan latensi gelombang V bergeser ~0.4 ms per 10 dB.
var Norms = map[string]Norm{
	"I-III": {2.13, 0.14},
	"III-V": {1.85, 0.18},
	"I-V":   {3.98, 0.21},
}

var waveBands = map[string][2]float64{
	"I": {1.0, 2.5}, "III": {3.5, 4.5}, "V": {5.0, 7.5},
}

func Compute(avg []float64, fs int, snr float64, status string) Detail {
	waves := detectWaves(avg, fs)
	interpeak := map[string]float64{}
	lat := map[string]float64{}
	for _, w := range waves {
		lat[w.Name] = w.Latency
	}
	if lat["I"] > 0 && lat["III"] > 0 {
		interpeak["I-III"] = round3(lat["III"] - lat["I"])
	}
	if lat["III"] > 0 && lat["V"] > 0 {
		interpeak["III-V"] = round3(lat["V"] - lat["III"])
	}
	if lat["I"] > 0 && lat["V"] > 0 {
		interpeak["I-V"] = round3(lat["V"] - lat["I"])
	}

	verdict := "Refer"
	if status == "Konvergen" && snr >= 3 && len(waves) >= 3 {
		verdict = "Pass"
	}
	normal, reasons := classify(verdict, status, snr, waves, interpeak)
	return Detail{Waves: waves, Interpeak: interpeak, Verdict: verdict, Normal: normal, Reasons: reasons}
}

func classify(verdict, status string, snr float64, waves []WaveInfo, interpeak map[string]float64) (bool, []string) {
	reasons := []string{}
	if verdict != "Pass" {
		switch {
		case status != "Konvergen":
			reasons = append(reasons, "sinyal belum konvergen ("+status+")")
		case snr < 3:
			reasons = append(reasons, fmt.Sprintf("SNR %.1f dB < 3 dB", snr))
		default:
			reasons = append(reasons, fmt.Sprintf("hanya %d dari 3 gelombang (I/III/V) terdeteksi", len(waves)))
		}
		return false, reasons
	}
	for _, k := range []string{"I-III", "III-V", "I-V"} {
		v, n := interpeak[k], Norms[k]
		if v < n.Min() || v > n.Max() {
			reasons = append(reasons, fmt.Sprintf("interpeak %s %.2f ms di luar normal %.2f–%.2f ms", k, v, n.Min(), n.Max()))
		}
	}
	return len(reasons) == 0, reasons
}

func detectWaves(avg []float64, fs int) []WaveInfo {
	if len(avg) == 0 || fs <= 0 {
		return nil
	}
	out := make([]WaveInfo, 0, 3)
	for _, name := range []string{"I", "III", "V"} {
		band := waveBands[name]
		start := int(band[0] / 1000 * float64(fs))
		end := int(band[1] / 1000 * float64(fs))
		if start < 0 {
			start = 0
		}
		if end >= len(avg) {
			end = len(avg) - 1
		}
		if start >= end {
			continue
		}
		// Gelombang I/III/V adalah puncak positif (vertex-positif), jadi cari
		// nilai terbesar, bukan |nilai| terbesar yang bisa jatuh ke lembah.
		best := start
		for i := start + 1; i <= end; i++ {
			if avg[i] > avg[best] {
				best = i
			}
		}
		// Tidak ada puncak positif (average masih nol / hanya lembah): tidak dilaporkan.
		if avg[best] <= 0 {
			continue
		}
		out = append(out, WaveInfo{
			Name:    name,
			Latency: round3(float64(best) / float64(fs) * 1000),
			Amp:     avg[best],
		})
	}
	return out
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}
