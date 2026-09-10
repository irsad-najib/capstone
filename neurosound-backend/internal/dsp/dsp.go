package dsp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"time"
)

type EpochInput struct {
	EpochCh1      []float64 `json:"epoch_ch1"`
	EpochCh2      []float64 `json:"epoch_ch2"`
	RunningAvgCh1 []float64 `json:"running_avg_ch1"`
	RunningAvgCh2 []float64 `json:"running_avg_ch2"`
	NTrials       int       `json:"n_trials"`
	Fs            int       `json:"fs"`
}

type DSPResult struct {
	FilteredCh1 []float64 `json:"filtered_ch1"`
	FilteredCh2 []float64 `json:"filtered_ch2"`
	AvgCh1      []float64 `json:"avg_ch1"`
	AvgCh2      []float64 `json:"avg_ch2"`
	SNRCh1      float64   `json:"snr_db_ch1"`
	SNRCh2      float64   `json:"snr_db_ch2"`
	PearsonR    float64   `json:"pearson_r"`
	Status      string    `json:"status"`
}

type Runner struct {
	PythonPath string
	ScriptPath string
	Timeout    time.Duration
}

func NewRunner(pythonPath, scriptPath string) *Runner {
	if pythonPath == "" {
		pythonPath = "python3"
	}
	if scriptPath == "" {
		scriptPath = filepath.Join("dsp", "dsp_worker.py")
	}
	return &Runner{
		PythonPath: pythonPath,
		ScriptPath: scriptPath,
		Timeout:    5 * time.Second,
	}
}

// RunDSP memanggil dsp_worker.py, return DSPResult.
func (r *Runner) RunDSP(input EpochInput) (*DSPResult, error) {
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), r.Timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, r.PythonPath, r.ScriptPath)
	cmd.Stdin = bytes.NewReader(inputJSON)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	out, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("dsp timeout after %s", r.Timeout)
	}
	if err != nil {
		return nil, fmt.Errorf("dsp error: %w: %s", err, stderr.String())
	}

	var result DSPResult
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, fmt.Errorf("decode dsp output: %w", err)
	}
	return &result, nil
}
