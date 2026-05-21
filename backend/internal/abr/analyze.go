package abr

import (
	"capstone/internal/dsp"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
)

var waveBands = map[string][2]float64{
	"I": {1.0, 2.5}, "II": {2.5, 3.5}, "III": {3.5, 4.5},
	"IV": {4.5, 5.5}, "V": {5.0, 7.5},
}
var waveOrder = []string{"I", "II", "III", "IV", "V"}
var ipiNorms = map[string][2]float64{
	"I-III": {1.8, 2.5}, "III-V": {1.8, 2.5}, "I-V": {3.8, 5.0},
}

// WaveInfo hasil deteksi gelombang ABR.
type WaveInfo struct {
	Name    string
	Latency float64 // ms
	Amp     float64 // µV
}

// ComputeSNR menghitung SNR dalam dB untuk satu channel.
func ComputeSNR(sig []float64, epochMs float64) (snrDB, rmsNoise, rmsSignal float64) {
	t := dsp.Linspace(0, epochMs, len(sig))
	var sumN, sumS float64
	var nN, nS int
	for i, ti := range t {
		v := sig[i] * sig[i]
		if ti < 2 {
			sumN += v
			nN++
		} else {
			sumS += v
			nS++
		}
	}
	if nN > 0 {
		rmsNoise = math.Sqrt(sumN / float64(nN))
	} else {
		rmsNoise = 1e-9
	}
	if nS > 0 {
		rmsSignal = math.Sqrt(sumS / float64(nS))
	}
	snrDB = 20 * math.Log10((rmsSignal+1e-9)/(rmsNoise+1e-9))
	return
}

// DetectWaves mendeteksi puncak gelombang ABR I–V.
func DetectWaves(sig []float64, timeAxis []float64) []WaveInfo {
	var waves []WaveInfo
	tMax := timeAxis[len(timeAxis)-1]
	for _, name := range waveOrder {
		band := waveBands[name]
		tLo, tHi := band[0], math.Min(band[1], tMax)
		if tLo >= tHi {
			continue
		}
		bestIdx, bestAbs := -1, -1.0
		for i, ti := range timeAxis {
			if ti >= tLo && ti <= tHi {
				if a := math.Abs(sig[i]); a > bestAbs {
					bestAbs = a
					bestIdx = i
				}
			}
		}
		if bestIdx >= 0 {
			waves = append(waves, WaveInfo{name, timeAxis[bestIdx], sig[bestIdx]})
		}
	}
	return waves
}

// InterpeakIntervals menghitung interval I–III, III–V, I–V.
func InterpeakIntervals(waves []WaveInfo) map[string]float64 {
	wm := map[string]float64{}
	for _, w := range waves {
		wm[w.Name] = w.Latency
	}
	ipi := map[string]float64{}
	for _, pair := range [][2]string{{"I", "III"}, {"III", "V"}, {"I", "V"}} {
		a, b := pair[0], pair[1]
		if la, ok := wm[a]; ok {
			if lb, ok2 := wm[b]; ok2 {
				ipi[a+"-"+b] = math.Round((lb-la)*1000) / 1000
			}
		}
	}
	return ipi
}

// fileData adalah struktur JSON rekaman ABR.
type fileData struct {
	SamplingRate float64       `json:"sampling_rate"`
	EpochMs      float64       `json:"epoch_ms"`
	TrialCount   int           `json:"trial_count"`
	ABRAverage   []interface{} `json:"abr_average"`
	ABRSnapshots []struct {
		TrialCount int           `json:"trial_count"`
		ABRAverage []interface{} `json:"abr_average"`
	} `json:"abr_snapshots"`
}

// Analyze memuat file JSON dan mencetak laporan ABR ke stdout.
func Analyze(filepath string) error {
	f, err := os.Open(filepath)
	if err != nil {
		return err
	}
	defer f.Close()

	var raw fileData
	if err := json.NewDecoder(f).Decode(&raw); err != nil {
		return fmt.Errorf("JSON error: %w", err)
	}
	if raw.SamplingRate == 0 {
		raw.SamplingRate = 500
	}
	if raw.EpochMs == 0 {
		raw.EpochMs = 50
	}

	abr := parseMatrix(raw.ABRAverage)
	if len(abr) == 0 {
		return fmt.Errorf("abr_average kosong")
	}
	nCh := len(abr)
	nSamp := len(abr[0])
	timeAxis := dsp.Linspace(0, raw.EpochMs, nSamp)

	fmt.Printf("[INFO] File          : %s\n", filepath)
	fmt.Printf("[INFO] Channels      : %d\n", nCh)
	fmt.Printf("[INFO] Sampling rate : %.0f Hz\n", raw.SamplingRate)
	fmt.Printf("[INFO] Epoch         : %.0f ms (%d samples)\n", raw.EpochMs, nSamp)
	fmt.Printf("[INFO] Total trials  : %d\n", raw.TrialCount)

	filtered := make([][]float64, nCh)
	for ch := range abr {
		filtered[ch] = dsp.SafeBandpass(abr[ch], 100, 3000, raw.SamplingRate)
	}

	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("  ABR ANALYSIS REPORT")
	fmt.Println(strings.Repeat("=", 60))

	for ch := 0; ch < nCh; ch++ {
		sig := filtered[ch]
		snrDB, rmsNoise, rmsSignal := ComputeSNR(sig, raw.EpochMs)
		waves := DetectWaves(sig, timeAxis)
		ipi := InterpeakIntervals(waves)

		qual := map[bool]string{true: "Baik", false: ""}[snrDB > 10]
		if qual == "" {
			qual = map[bool]string{true: "Cukup", false: "Buruk"}[snrDB > 5]
		}

		fmt.Printf("\n--- Channel %d ---\n", ch+1)
		fmt.Printf("  SNR      : %.2f dB  (noise=%.4f µV, signal=%.4f µV)\n", snrDB, rmsNoise, rmsSignal)
		fmt.Printf("  Kualitas : %s\n", qual)
		for _, w := range waves {
			fmt.Printf("  Wave %s  : %.2f ms  %.4f µV\n", w.Name, w.Latency, w.Amp)
		}
		for _, pair := range []string{"I-III", "III-V", "I-V"} {
			v, ok := ipi[pair]
			if !ok {
				continue
			}
			norm := ipiNorms[pair]
			status := "perlu dicek"
			if v >= norm[0] && v <= norm[1] {
				status = "normal"
			}
			fmt.Printf("  IPI %s  : %.3f ms [%s]\n", pair, v, status)
		}
		printASCII(sig, timeAxis, 64, 8)
	}

	// Konvergensi
	if len(raw.ABRSnapshots) >= 2 {
		fmt.Println("\n--- Konvergensi (Pearson r antar snapshot, ch1) ---")
		snaps := raw.ABRSnapshots
		for i := 1; i < len(snaps); i++ {
			prev := parseMatrix(snaps[i-1].ABRAverage)
			curr := parseMatrix(snaps[i].ABRAverage)
			if len(prev) > 0 && len(curr) > 0 && len(prev[0]) == len(curr[0]) {
				r := dsp.PearsonR(prev[0], curr[0])
				flag := ""
				if r >= 0.9 {
					flag = " [KONVERGEN]"
				}
				fmt.Printf("  trials=%-5d r=%.3f%s\n", snaps[i].TrialCount, r, flag)
			}
		}
	}

	fmt.Println("\n" + strings.Repeat("=", 60))
	return nil
}

func parseMatrix(raw []interface{}) [][]float64 {
	if len(raw) == 0 {
		return nil
	}
	switch raw[0].(type) {
	case []interface{}:
		mat := make([][]float64, len(raw))
		for i, row := range raw {
			r := row.([]interface{})
			mat[i] = make([]float64, len(r))
			for j, v := range r {
				mat[i][j] = toF64(v)
			}
		}
		return mat
	default:
		row := make([]float64, len(raw))
		for i, v := range raw {
			row[i] = toF64(v)
		}
		return [][]float64{row}
	}
}

func toF64(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	}
	return 0
}

func printASCII(sig []float64, timeAxis []float64, width, height int) {
	if len(sig) == 0 {
		return
	}
	minV, maxV := sig[0], sig[0]
	for _, v := range sig {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	if maxV == minV {
		maxV = minV + 1
	}
	cols := make([]float64, width)
	for i := range cols {
		cols[i] = sig[i*len(sig)/width]
	}
	grid := make([][]byte, height)
	for i := range grid {
		grid[i] = []byte(strings.Repeat(" ", width))
	}
	for col, v := range cols {
		row := int((maxV - v) / (maxV - minV) * float64(height-1))
		if row < 0 {
			row = 0
		} else if row >= height {
			row = height - 1
		}
		grid[row][col] = '*'
	}
	fmt.Printf("\n  Waveform: max=%.4f µV  min=%.4f µV\n", maxV, minV)
	for _, row := range grid {
		fmt.Printf("  |%s\n", string(row))
	}
	fmt.Printf("  0ms%s%.0fms\n\n", strings.Repeat("-", width-5), timeAxis[len(timeAxis)-1])
}
