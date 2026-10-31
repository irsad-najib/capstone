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

// Gelombang V dicari di jendela lebar (latensinya bergeser ~0.4 ms per 10 dB, 5.5 ms di
// 80 dB sampai ~8 ms dekat ambang). III dan I dicari relatif terhadap V memakai interpeak
// (hampir tidak berubah terhadap level): rentang normal Norms diperlebar ±0.3 ms.
var (
	bandV      = [2]float64{4.5, 9.5}
	bandIIIToV = [2]float64{1.2, 2.6} // V − III
	bandIToV   = [2]float64{3.2, 4.8} // V − I
	minLatI    = 0.8                  // sebelum ini: artefak stimulus
)

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

	// Skrining: respons berulang (status Konvergen = r split-half cukup tinggi) dan gelombang V
	// terlihat. I/III boleh tidak ada: dekat ambang hanya V yang muncul. SNR ± average setara
	// dengan r (SNR = r/(1−r)), jadi hanya dilaporkan.
	verdict := "Refer"
	if status == "Konvergen" && lat["V"] > 0 {
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
			reasons = append(reasons, fmt.Sprintf("respons belum berulang/konvergen (%s, SNR %.1f dB)", status, snr))
		default:
			reasons = append(reasons, "gelombang V tidak terdeteksi")
		}
		return false, reasons
	}
	if len(waves) < 3 {
		// Pass tapi I/III tidak terlihat (level rendah): normalitas interpeak tidak bisa dinilai.
		return false, []string{fmt.Sprintf("hanya %d dari 3 gelombang (I/III/V) terdeteksi, interpeak tidak dinilai", len(waves))}
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
	v, ok := peakIn(avg, fs, bandV[0], bandV[1])
	if !ok {
		return nil
	}
	vMs := float64(v) / float64(fs) * 1000
	out := make([]WaveInfo, 0, 3)
	if i, ok := peakIn(avg, fs, math.Max(minLatI, vMs-bandIToV[1]), vMs-bandIToV[0]); ok {
		out = append(out, wave("I", i, avg, fs))
	}
	if i, ok := peakIn(avg, fs, vMs-bandIIIToV[1], vMs-bandIIIToV[0]); ok {
		out = append(out, wave("III", i, avg, fs))
	}
	return append(out, wave("V", v, avg, fs))
}

// peakIn mencari puncak positif tertinggi di [fromMs, toMs]. Gelombang I/III/V adalah puncak
// positif (vertex-positif), jadi |nilai| terbesar yang bisa jatuh ke lembah tidak dipakai.
// false kalau tidak ada nilai > 0 (average masih nol / hanya lembah).
func peakIn(avg []float64, fs int, fromMs, toMs float64) (int, bool) {
	start := int(fromMs / 1000 * float64(fs))
	end := int(toMs / 1000 * float64(fs))
	if start < 0 {
		start = 0
	}
	if end >= len(avg) {
		end = len(avg) - 1
	}
	if start >= end {
		return 0, false
	}
	best := start
	for i := start + 1; i <= end; i++ {
		if avg[i] > avg[best] {
			best = i
		}
	}
	return best, avg[best] > 0
}

func wave(name string, i int, avg []float64, fs int) WaveInfo {
	return WaveInfo{Name: name, Latency: round3(float64(i) / float64(fs) * 1000), Amp: avg[i]}
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}
