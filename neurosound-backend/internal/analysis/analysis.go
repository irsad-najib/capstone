package analysis

import "math"

type WaveInfo struct {
	Name    string  `json:"name" bson:"name"`
	Latency float64 `json:"latency_ms" bson:"latency_ms"`
	Amp     float64 `json:"amplitude_uv" bson:"amplitude_uv"`
}

type Detail struct {
	Waves     []WaveInfo         `json:"waves" bson:"waves"`
	Interpeak map[string]float64 `json:"interpeak_ms" bson:"interpeak_ms"`
	Verdict   string             `json:"verdict" bson:"verdict"`
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
	return Detail{Waves: waves, Interpeak: interpeak, Verdict: verdict}
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
		best := start
		bestAbs := math.Abs(avg[start])
		for i := start + 1; i <= end; i++ {
			if v := math.Abs(avg[i]); v > bestAbs {
				best = i
				bestAbs = v
			}
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
