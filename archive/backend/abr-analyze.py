"""
ABR Offline Analyzer
====================
Load file JSON hasil rekaman dari abr_stream.py,
lalu analisis: plot per channel, deteksi wave I-V, SNR & statistik.

Usage:
    python abr_analyze.py eeg_abr_1234567890.json
"""

import json
import sys
import numpy as np
import matplotlib
matplotlib.use("QtAgg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from scipy.signal import butter, filtfilt
from scipy.stats import pearsonr

# ===========================
# LOAD DATA
# ===========================
if len(sys.argv) < 2:
    print("Usage: python abr_analyze.py <file.json>")
    sys.exit(1)

filepath = sys.argv[1]
print(f"[INFO] Loading: {filepath}")

with open(filepath, "r") as f:
    data = json.load(f)

sampling_rate = float(data.get("sampling_rate", 500))
epoch_ms      = float(data.get("epoch_ms", 50))
trial_count   = int(data.get("trial_count", 0))
abr_average = np.array(data["abr_average"])
n_channels  = abr_average.shape[0] 
abr_snapshots = data.get("abr_snapshots", [])

# Handle shape
if abr_average.ndim == 1:
    abr_average = abr_average.reshape(1, -1)

epoch_samples = abr_average.shape[1]
time_axis     = np.linspace(0, epoch_ms, epoch_samples)

print(f"[INFO] Channels      : {n_channels}")
print(f"[INFO] Sampling rate : {sampling_rate} Hz")
print(f"[INFO] Epoch         : {epoch_ms} ms ({epoch_samples} samples)")
print(f"[INFO] Total trials  : {trial_count}")

# ===========================
# SAFE FILTER
# ===========================
def safe_bandpass(data, low, high, fs, order=2):
    nyq  = 0.5 * fs
    high = min(high, nyq * 0.95)
    low  = max(low, 0.5)
    if low >= high:
        return data
    padlen = 3 * (order * 2 + 1)
    if len(data) <= padlen:
        return data
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, data)

# Re-filter ABR (opsional, sudah difilter waktu rekaman)
abr_filtered = np.zeros_like(abr_average)
for ch in range(n_channels):
    abr_filtered[ch] = safe_bandpass(abr_average[ch], 100, 3000, sampling_rate)

# ===========================
# SNR
# ===========================
def compute_snr(signal, epoch_ms, noise_ms=(0, 2), signal_ms=(2, epoch_ms)):
    t = np.linspace(0, epoch_ms, len(signal))
    noise_mask  = (t >= noise_ms[0])  & (t < noise_ms[1])
    signal_mask = (t >= signal_ms[0]) & (t < signal_ms[1])
    rms_noise  = np.sqrt(np.mean(signal[noise_mask] ** 2))  if noise_mask.any()  else 1e-9
    rms_signal = np.sqrt(np.mean(signal[signal_mask] ** 2)) if signal_mask.any() else 0.0
    snr_db = 20 * np.log10((rms_signal + 1e-9) / (rms_noise + 1e-9))
    return snr_db, rms_noise, rms_signal

# ===========================
# WAVE I-V DETECTION
# (disesuaikan ke epoch 50ms, latency normal utk click 70dBnHL)
# ===========================
WAVE_LATENCY_REF = {
    "I"  : (1.0, 2.5),
    "II" : (2.5, 3.5),
    "III": (3.5, 4.5),
    "IV" : (4.5, 5.5),
    "V"  : (5.0, 7.5),
}
WAVE_COLORS = {
    "I"  : "#FF6B6B",
    "II" : "#FFD93D",
    "III": "#6BCB77",
    "IV" : "#4D96FF",
    "V"  : "#C77DFF",
}

def detect_waves(signal, time_axis):
    detected = {}
    for wave, (t_lo, t_hi) in WAVE_LATENCY_REF.items():
        # Clamp ke panjang epoch
        t_hi = min(t_hi, time_axis[-1])
        if t_lo >= t_hi:
            continue
        mask = (time_axis >= t_lo) & (time_axis <= t_hi)
        if not mask.any():
            continue
        seg     = signal[mask]
        seg_t   = time_axis[mask]
        peak_i  = np.argmax(np.abs(seg))
        detected[wave] = (float(seg_t[peak_i]), float(seg[peak_i]))
    return detected

def interpeak_intervals(waves):
    intervals = {}
    for a, b in [("I", "III"), ("III", "V"), ("I", "V")]:
        if a in waves and b in waves:
            intervals[f"{a}-{b}"] = round(waves[b][0] - waves[a][0], 3)
    return intervals

def convergence_check(snapshots, ch=0):
    if len(snapshots) < 2:
        return [], []
    trials_list, corr_list = [], []
    for i in range(1, len(snapshots)):
        prev = np.array(snapshots[i-1]["abr_average"])
        curr = np.array(snapshots[i]["abr_average"])
        if prev.ndim == 1: prev = prev.reshape(1, -1)
        if curr.ndim == 1: curr = curr.reshape(1, -1)
        if prev.shape == curr.shape and ch < prev.shape[0]:
            r, _ = pearsonr(prev[ch], curr[ch])
            corr_list.append(r)
            trials_list.append(snapshots[i]["trial_count"])
    return trials_list, corr_list

# ===========================
# REPORT
# ===========================
print("\n" + "="*60)
print("  ABR ANALYSIS REPORT")
print("="*60)

all_waves  = []
all_snr    = []
all_interp = []

for ch in range(n_channels):
    sig   = abr_filtered[ch]
    snr_db, rms_noise, rms_signal = compute_snr(sig, epoch_ms)
    waves = detect_waves(sig, time_axis)
    ipi   = interpeak_intervals(waves)
    all_waves.append(waves)
    all_snr.append(snr_db)
    all_interp.append(ipi)

    print(f"\n--- Channel {ch+1} ---")
    print(f"  SNR      : {snr_db:.2f} dB  (noise={rms_noise:.4f}, signal={rms_signal:.4f})")
    qual = "✅ Baik" if snr_db > 10 else "🔶 Cukup" if snr_db > 5 else "❌ Buruk"
    print(f"  Kualitas : {qual}")
    for wname, (lat, amp) in waves.items():
        print(f"  Wave {wname}: {lat:.2f} ms, {amp:.4f} µV")
    for k, v in ipi.items():
        norm_ranges = {"I-III": (1.8, 2.5), "III-V": (1.8, 2.5), "I-V": (3.8, 5.0)}
        lo, hi = norm_ranges.get(k, (0, 999))
        status = "normal" if lo <= v <= hi else "perlu dicek"
        print(f"  IPI {k}: {v} ms [{status}]")

print("\n" + "="*60)

# ===========================
# PLOTTING
# ===========================
n_cols    = min(n_channels, 3)
n_rows    = (n_channels + n_cols - 1) // n_cols
has_snp   = len(abr_snapshots) >= 2

# Clamp figsize
fig_w = max(6, min(6 * n_cols, 22))
fig_h = max(5, min(5 * n_rows + (3 if has_snp else 0), 28))

fig = plt.figure(figsize=(fig_w, fig_h))
fig.patch.set_facecolor("#0F1117")
plt.rcParams.update({
    "text.color"     : "white",
    "axes.labelcolor": "white",
    "xtick.color"    : "white",
    "ytick.color"    : "white",
    "axes.edgecolor" : "#444",
    "axes.facecolor" : "#1A1D27",
    "grid.color"     : "#2A2D37",
})

gs_rows = n_rows + (1 if has_snp else 0)
gs = gridspec.GridSpec(gs_rows, n_cols, figure=fig, hspace=0.55, wspace=0.35)

for ch in range(n_channels):
    row = ch // n_cols
    col = ch % n_cols
    ax  = fig.add_subplot(gs[row, col])

    sig   = abr_filtered[ch]
    waves = all_waves[ch]
    snr   = all_snr[ch]

    ax.plot(time_axis, sig, color="#4FC3F7", linewidth=1.5)
    ax.axhline(0, color="#555", linewidth=0.8, linestyle="--")
    ax.fill_between(time_axis, sig, alpha=0.12, color="#4FC3F7")

    for wname, (lat, amp) in waves.items():
        color = WAVE_COLORS.get(wname, "white")
        ax.axvline(lat, color=color, linewidth=1, linestyle=":", alpha=0.8)
        ax.scatter([lat], [amp], color=color, zorder=5, s=50)
        ax.annotate(
            f"W{wname}\n{lat:.1f}ms",
            xy=(lat, amp),
            xytext=(lat + 0.3, amp * 1.1 if amp != 0 else 0.001),
            fontsize=7, color=color,
            arrowprops=dict(arrowstyle="->", color=color, lw=0.7)
        )

    snr_color = "#6BCB77" if snr > 10 else "#FFD93D" if snr > 5 else "#FF6B6B"
    ax.set_title(f"Ch{ch+1}  |  {trial_count} trials  |  SNR: {snr:.1f} dB",
                 fontsize=9, color="white", pad=6)
    ax.set_xlabel("Time (ms)", fontsize=8)
    ax.set_ylabel("Amplitude (µV)", fontsize=8)
    ax.grid(True, alpha=0.25)
    ax.text(0.98, 0.95, f"SNR {snr:.1f} dB",
            transform=ax.transAxes, ha="right", va="top",
            fontsize=8, color=snr_color,
            bbox=dict(facecolor="#1A1D27", edgecolor=snr_color, boxstyle="round,pad=0.3"))

    ipi_text = "  ".join([f"{k}:{v}ms" for k, v in all_interp[ch].items()])
    if ipi_text:
        ax.text(0.02, 0.04, ipi_text, transform=ax.transAxes,
                ha="left", va="bottom", fontsize=7, color="#AAAAAA")

# Convergence plot
if has_snp:
    ax_conv = fig.add_subplot(gs[n_rows, :])
    ax_conv.set_facecolor("#1A1D27")
    for ch in range(n_channels):
        tl, cl = convergence_check(abr_snapshots, ch=ch)
        if tl:
            ax_conv.plot(tl, cl, marker="o", markersize=4,
                         label=f"Ch{ch+1}",
                         color=plt.cm.tab10(ch / max(n_channels, 1)))
    ax_conv.axhline(0.9, color="#6BCB77", linewidth=1,
                    linestyle="--", label="r=0.9 (konvergen)")
    ax_conv.set_title("Konvergensi ABR — Korelasi antar snapshot tiap 100 trials",
                      fontsize=10, color="white")
    ax_conv.set_xlabel("Trial count")
    ax_conv.set_ylabel("Pearson r")
    ax_conv.set_ylim(-0.2, 1.1)
    ax_conv.grid(True, alpha=0.3)
    ax_conv.legend(fontsize=8, facecolor="#1A1D27", labelcolor="white")

plt.suptitle(
    f"ABR Analysis  |  {trial_count} trials  |  fs={sampling_rate:.0f} Hz  |  epoch={epoch_ms:.0f} ms",
    fontsize=12, color="white", y=0.995
)

out_img = filepath.replace(".json", "_analysis.png")
try:
    plt.savefig(out_img, dpi=120, bbox_inches="tight", facecolor="#0F1117")
except Exception as e:
    print(f"[WARN] savefig bbox gagal ({e}), fallback.")
    plt.savefig(out_img, dpi=100, facecolor="#0F1117")

print(f"[INFO] Plot disimpan → {out_img}")
plt.show()