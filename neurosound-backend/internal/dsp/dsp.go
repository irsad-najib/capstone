package dsp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os/exec"
	"path/filepath"
	"sync"
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
	Error       string    `json:"error,omitempty"` // hanya dari mode --serve
}

type Runner struct {
	PythonPath string
	ScriptPath string
	Timeout    time.Duration

	// Worker persisten (dsp_worker.py --serve): numpy/scipy di-import sekali, bukan
	// per trial. Kalau gagal, RunDSP kembali ke satu proses per trial.
	mu  sync.Mutex
	cmd *exec.Cmd
	in  io.WriteCloser
	out *bufio.Reader
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

// RunDSP memproses satu epoch lewat worker persisten, atau satu proses
// dsp_worker.py kalau worker tidak bisa dipakai.
func (r *Runner) RunDSP(input EpochInput) (*DSPResult, error) {
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	res, err := r.runServe(inputJSON)
	if err == nil {
		return res, nil
	}
	var de dspError
	if errors.As(err, &de) {
		return nil, err // worker hidup, input-nya yang ditolak
	}
	log.Printf("[dsp] worker persisten: %v, pakai proses per trial", err)
	return r.runOnce(inputJSON)
}

type dspError string

func (e dspError) Error() string { return "dsp error: " + string(e) }

func (r *Runner) runServe(inputJSON []byte) (*DSPResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cmd == nil {
		if err := r.startLocked(); err != nil {
			return nil, err
		}
	}
	type reply struct {
		line []byte
		err  error
	}
	ch := make(chan reply, 1)
	go func() {
		if _, err := r.in.Write(append(inputJSON, '\n')); err != nil {
			ch <- reply{err: err}
			return
		}
		line, err := r.out.ReadBytes('\n')
		ch <- reply{line, err}
	}()
	var rep reply
	select {
	case rep = <-ch:
	case <-time.After(r.Timeout):
		rep.err = fmt.Errorf("dsp timeout after %s", r.Timeout)
	}
	if rep.err != nil {
		r.stopLocked()
		return nil, rep.err
	}
	var result DSPResult
	if err := json.Unmarshal(rep.line, &result); err != nil {
		r.stopLocked()
		return nil, fmt.Errorf("decode dsp output: %w", err)
	}
	if result.Error != "" {
		return nil, dspError(result.Error)
	}
	return &result, nil
}

func (r *Runner) startLocked() error {
	cmd := exec.Command(r.PythonPath, r.ScriptPath, "--serve")
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	r.cmd, r.in, r.out = cmd, in, bufio.NewReaderSize(out, 1<<20)
	return nil
}

func (r *Runner) stopLocked() {
	if r.cmd == nil {
		return
	}
	_ = r.in.Close()
	_ = r.cmd.Process.Kill()
	_ = r.cmd.Wait()
	r.cmd = nil
}

// Close menghentikan worker persisten (kalau ada).
func (r *Runner) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked()
}

func (r *Runner) runOnce(inputJSON []byte) (*DSPResult, error) {
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
