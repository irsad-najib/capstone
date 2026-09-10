#!/usr/bin/env python3
import json
import sys

import numpy as np
from scipy.signal import butter, sosfiltfilt


def init_sos(fs=16000, low=100, high=3000, order=2):
    """Buat SOS coefficients Butterworth bandpass."""
    return butter(order, [low, high], btype="bandpass", fs=fs, output="sos")


def baseline_correct(epoch: np.ndarray, fs: int) -> np.ndarray:
    """Kurangi mean 1ms pre-stimulus (16 sampel pertama)."""
    baseline_n = max(1, int(fs * 0.001))
    return epoch - np.mean(epoch[:baseline_n])


def apply_bpf(sos, epoch: np.ndarray) -> np.ndarray:
    """Apply sosfiltfilt — zero-phase, tidak distorsi latensi."""
    if epoch.size < 16:
        return epoch.copy()
    return sosfiltfilt(sos, epoch)


def update_running_avg(avg: np.ndarray, epoch: np.ndarray, n: int) -> np.ndarray:
    """Running update: avg_new = ((N-1)*avg + epoch) / N"""
    if avg is None or avg.size == 0 or n <= 1:
        return epoch.copy()
    return ((n - 1) * avg + epoch) / n


def compute_snr(avg: np.ndarray, fs: int) -> float:
    """SNR dB = 20*log10(RMS_post / RMS_pre). Pre: t<0, Post: t>=0."""
    pre_n = max(1, int(fs * 0.010))
    pre = avg[:pre_n]
    post = avg[pre_n:]
    rms_pre = np.sqrt(np.mean(np.square(pre))) if pre.size else 1e-9
    rms_post = np.sqrt(np.mean(np.square(post))) if post.size else 0.0
    return float(20 * np.log10((rms_post + 1e-9) / (rms_pre + 1e-9)))


def compute_pearson(avg_prev: np.ndarray, avg_curr: np.ndarray) -> float:
    """Pearson r antara dua snapshot. Return 0.0 jika avg_prev None."""
    if avg_prev is None or avg_curr is None:
        return 0.0
    if avg_prev.size != avg_curr.size or avg_prev.size < 2:
        return 0.0
    if np.std(avg_prev) == 0 or np.std(avg_curr) == 0:
        return 0.0
    return float(np.corrcoef(avg_prev, avg_curr)[0, 1])


def get_status(n_trials: int, pearson_r: float) -> str:
    """Noise(<100), Terbentuk(100-499 atau r<0.9), Konvergen(>=500 dan r>=0.9)."""
    if n_trials < 100:
        return "Noise"
    if n_trials >= 500 and pearson_r >= 0.9:
        return "Konvergen"
    return "Terbentuk"


def _arr(value):
    if value is None:
        return None
    return np.asarray(value, dtype=np.float64)


def main():
    """Baca JSON dari stdin, proses DSP, print JSON ke stdout."""
    try:
        payload = json.load(sys.stdin)
        fs = int(payload.get("fs", 16000))
        n_trials = int(payload.get("n_trials", 0)) + 1

        epoch_ch1 = _arr(payload["epoch_ch1"])
        epoch_ch2 = _arr(payload["epoch_ch2"])
        avg_prev_ch1 = _arr(payload.get("running_avg_ch1"))
        avg_prev_ch2 = _arr(payload.get("running_avg_ch2"))

        sos = init_sos(fs=fs)
        corrected_ch1 = baseline_correct(epoch_ch1, fs)
        corrected_ch2 = baseline_correct(epoch_ch2, fs)
        filtered_ch1 = apply_bpf(sos, corrected_ch1)
        filtered_ch2 = apply_bpf(sos, corrected_ch2)

        avg_ch1 = update_running_avg(avg_prev_ch1, filtered_ch1, n_trials)
        avg_ch2 = update_running_avg(avg_prev_ch2, filtered_ch2, n_trials)
        pearson = compute_pearson(avg_prev_ch1, avg_ch1)

        result = {
            "filtered_ch1": filtered_ch1.tolist(),
            "filtered_ch2": filtered_ch2.tolist(),
            "avg_ch1": avg_ch1.tolist(),
            "avg_ch2": avg_ch2.tolist(),
            "snr_db_ch1": compute_snr(avg_ch1, fs),
            "snr_db_ch2": compute_snr(avg_ch2, fs),
            "pearson_r": pearson,
            "status": get_status(n_trials, pearson),
        }
        print(json.dumps(result, separators=(",", ":")))
    except Exception as exc:
        print(f"dsp_worker error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
