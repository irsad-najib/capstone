from mindrove.board_shim import BoardShim, MindRoveInputParams, BoardIds
import pyqtgraph as pg
from pyqtgraph.Qt import QtWidgets, QtCore
import numpy as np
import sounddevice as sd
import threading
import time
import json
import sys
from scipy.signal import butter, filtfilt, iirnotch

# ================= CONFIG =================
IP_ADDRESS = "192.168.4.2"
IP_PORT = 6677
WINDOW_SIZE = 2        # detik untuk display EEG
ABR_EPOCH_MS = 50  # dari 10ms → 50ms (25 samples di fs=500Hz)
# ==========================================

# ================= PARAMETER STIMULUS =================
fs_audio = 25000
rate = 20
interval = 1 / rate
click_duration = 0.01
silence_duration = interval - click_duration
trials = 4000
# ======================================================

BoardShim.enable_dev_board_logger()

params = MindRoveInputParams()
params.ip_address = IP_ADDRESS
params.ip_port = IP_PORT

board_id = BoardIds.MINDROVE_WIFI_BOARD
board = BoardShim(board_id, params)

saved_data = []

# ===== FILTER =====
def bandpass(data, low, high, fs, order=4):
    nyq = 0.5 * fs
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, data)

def notch(data, freq, fs, Q=30):
    b, a = iirnotch(freq, Q, fs)
    return filtfilt(b, a, data)

def bandpass_abr(data, fs, low=100, high=3000, order=2):  # order 2, bukan 4
    nyq = 0.5 * fs
    high = min(high, nyq * 0.95)
    low  = max(low, 1.0)
    if low >= high:
        return data
    # Cek panjang minimum sebelum filter
    padlen = 3 * max(order * 2 + 1, 1)
    if len(data) <= padlen:
        return data  # skip filter, return raw
    b, a = butter(order, [low / nyq, high / nyq], btype='band')
    return filtfilt(b, a, data)

# ===== BUILD CLICK STIMULUS =====
click = np.zeros(int(fs_audio * click_duration))
click[0] = 1.0
click[1] = -0.5
click[2] = 0.25

silence = np.zeros(int(fs_audio * silence_duration))
one_trial = np.concatenate([click, silence])
signal_audio = np.tile(one_trial, trials)
signal_audio = signal_audio / np.max(np.abs(signal_audio)) * 0.8

# ===== SHARED STATE =====
stimulus_log = []
stimulus_lock = threading.Lock()
stimulus_started = False
stimulus_start_time = None
processed_stims = set()

epochs_per_channel = None
abr_average = None
trial_count = 0
abr_lock = threading.Lock()

# ===== STIMULUS THREAD =====
def play_stimulus():
    global stimulus_started, stimulus_start_time

    stimulus_start_time = time.time()
    stimulus_started = True

    for i in range(trials):
        t = stimulus_start_time + i * interval
        with stimulus_lock:
            stimulus_log.append(t)

    sd.play(signal_audio, fs_audio)
    sd.wait()
    print("[STIMULUS] Selesai semua trials.")

stimulus_thread = threading.Thread(target=play_stimulus, daemon=True)

# ===== QT APP =====
app = QtWidgets.QApplication(sys.argv)

win = pg.GraphicsLayoutWidget(title="Realtime EEG + ABR")
win.resize(1200, 700)
win.show()

plot_eeg = win.addPlot(title="EEG Realtime (1–40 Hz)")
plot_eeg.setYRange(-100, 100)
plot_eeg.setLabel('left', 'Amplitude (µV)')
plot_eeg.setLabel('bottom', 'Samples')

win.nextRow()

plot_abr = win.addPlot(title="ABR Average (100–3000 Hz)")
plot_abr.setLabel('left', 'Amplitude (µV)')
plot_abr.setLabel('bottom', 'Time (ms)')
plot_abr.addLegend()

curves_eeg = []
curves_abr = []

try:
    print("Preparing session...")
    board.prepare_session()
    board.start_stream()

    eeg_channels = BoardShim.get_eeg_channels(board_id)
    sampling_rate = BoardShim.get_sampling_rate(board_id)
    n_channels = len(eeg_channels)

    epoch_samples = int(sampling_rate * ABR_EPOCH_MS / 1000)
    epochs_per_channel = [[] for _ in range(n_channels)]
    abr_average = np.zeros((n_channels, epoch_samples))

    num_points = WINDOW_SIZE * sampling_rate
    abr_time_axis = np.linspace(0, ABR_EPOCH_MS, epoch_samples)

    print(f"Sampling rate: {sampling_rate} Hz | Channels: {n_channels} | Epoch: {epoch_samples} samples")

    # Init EEG curves
    for i in range(n_channels):
        curve = plot_eeg.plot(pen=pg.intColor(i), name=f"Ch{i+1}")
        curves_eeg.append(curve)

    # Init ABR curves
    for i in range(n_channels):
        curve = plot_abr.plot(
            pen=pg.mkPen(pg.intColor(i), width=2),
            name=f"Ch{i+1}"
        )
        curves_abr.append(curve)

    time.sleep(1)
    stimulus_thread.start()
    print("[INFO] Stimulus dimulai.")

    def update():
        global abr_average, trial_count

        if board.get_board_data_count() < num_points:
            return

        now = time.time()
        data = board.get_current_board_data(num_points)
        eeg_data = data[eeg_channels]

        saved_data.append(eeg_data.tolist())

        # ===== EEG PLOT =====
        for i, curve in enumerate(curves_eeg):
            sig = eeg_data[i].copy()
            sig = notch(sig, 50, sampling_rate)
            sig = bandpass(sig, 1, 40, sampling_rate)
            curve.setData(sig)

        # ===== EPOCH EXTRACTION =====
        if not stimulus_started:
            return

        with stimulus_lock:
            stim_times = list(stimulus_log)

        window_start_time = now - WINDOW_SIZE

        for idx, stim_t in enumerate(stim_times):
            if idx in processed_stims:
                continue

            if stim_t < window_start_time or stim_t > now:
                continue

            offset_sec = stim_t - window_start_time
            offset_sample = int(offset_sec * sampling_rate)
            end_sample = offset_sample + epoch_samples

            if end_sample > eeg_data.shape[1]:
                continue

            for ch in range(n_channels):
                epoch = eeg_data[ch, offset_sample:end_sample].copy()
                epoch = bandpass_abr(epoch, sampling_rate)
                baseline_end = max(1, int(sampling_rate * 0.001))
                epoch -= np.mean(epoch[:baseline_end])
                epochs_per_channel[ch].append(epoch)

            processed_stims.add(idx)

        with abr_lock:
            trial_count = len(epochs_per_channel[0]) if epochs_per_channel[0] else 0

        # ===== ABR PLOT =====
        with abr_lock:
            current_trials = trial_count

        if current_trials == 0:
            plot_abr.setTitle("ABR — Menunggu stimulus pertama...")
            return

        # Label kualitas
        if current_trials < 100:
            quality = "Noise"
        elif current_trials < 500:
            quality = "Mulai terbentuk"
        else:
            quality = "Konvergen"

        plot_abr.setTitle(f"ABR Average ({current_trials} trials) — {quality}")

        new_abr = np.zeros((n_channels, epoch_samples))
        for ch in range(n_channels):
            if epochs_per_channel[ch]:
                stack = np.array(epochs_per_channel[ch])
                new_abr[ch] = np.mean(stack, axis=0)

        with abr_lock:
            abr_average = new_abr

        for i, curve in enumerate(curves_abr):
            curve.setData(abr_time_axis, abr_average[i])

    timer = QtCore.QTimer()
    timer.timeout.connect(update)
    timer.start(50)

    app.exec()

except KeyboardInterrupt:
    print("Stopped")

finally:
    print("[INFO] Saving data...")
    filename = f"eeg_abr_{int(time.time())}.json"
    with open(filename, "w") as f:
        json.dump({
            "eeg": saved_data,
            "abr_average": abr_average.tolist() if abr_average is not None else [],
            "trial_count": trial_count
        }, f)
    print(f"[INFO] Saved to {filename}")

    board.stop_stream()
    board.release_session()