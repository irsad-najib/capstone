"""
Rekam RAW MindRove (WiFi board) ke CSV, tanpa GUI, tanpa filter.

Pakai:
    pip install mindrove numpy sounddevice
    python record_raw.py --duration 120 --out rec_mindrove_01
    python record_raw.py --duration 120 --out rec_mindrove_01 --click   # + stimulus klik 20 Hz

Output (di folder ./recordings):
    <out>.csv        : t_board_s, ch1..ch8   (nilai mentah dari SDK, tanpa filter/notch)
    <out>_stim.csv   : waktu tiap klik (epoch detik, jam laptop) -- hanya bila --click
    <out>_meta.json  : fs, jumlah kanal, durasi, dll.

Beda dengan eeg.py lama: data diambil dengan get_board_data() (buffer dikuras,
tiap sampel tersimpan SATU kali), bukan get_current_board_data() yang membuat
jendela 2 s menumpuk tiap 50 ms (duplikat ~40x) dan timestamp tidak tersimpan.
"""
import argparse
import csv
import json
import os
import threading
import time

import numpy as np
from mindrove.board_shim import BoardShim, MindRoveInputParams, BoardIds

ap = argparse.ArgumentParser()
ap.add_argument("--ip", default="192.168.4.2")
ap.add_argument("--port", type=int, default=6677)
ap.add_argument("--duration", type=float, default=60, help="detik")
ap.add_argument("--out", default=f"mindrove_{int(time.time())}")
ap.add_argument("--click", action="store_true", help="putar klik 20 Hz + catat waktunya")
ap.add_argument("--rate", type=float, default=20.0, help="klik per detik")
ap.add_argument("--fs-audio", type=int, default=25000)
args = ap.parse_args()

os.makedirs("recordings", exist_ok=True)
base = os.path.join("recordings", args.out)

params = MindRoveInputParams()
params.ip_address = args.ip
params.ip_port = args.port
board_id = BoardIds.MINDROVE_WIFI_BOARD
board = BoardShim(board_id, params)

eeg_ch = BoardShim.get_eeg_channels(board_id)
ts_ch = BoardShim.get_timestamp_channel(board_id)
fs = BoardShim.get_sampling_rate(board_id)


def play_clicks(duration, log):
    import sounddevice as sd

    fsa = args.fs_audio
    interval = 1.0 / args.rate
    n_trials = int(duration * args.rate)
    one = np.zeros(int(fsa * interval))
    one[0], one[1], one[2] = 1.0, -0.5, 0.25  # sama dengan eeg.py
    sig = np.tile(one, n_trials) * 0.8
    t0 = time.time() + 0.2
    log.extend(t0 + i * interval for i in range(n_trials))  # waktu NOMINAL klik
    time.sleep(0.2)
    sd.play(sig, fsa)
    sd.wait()


stim_times = []
rows = 0
try:
    board.prepare_session()
    board.start_stream()
    print(f"fs={fs} Hz, kanal EEG={len(eeg_ch)}, rekam {args.duration}s -> {base}.csv")
    time.sleep(1)
    board.get_board_data()  # buang buffer awal
    t_start = time.time()

    if args.click:
        threading.Thread(target=play_clicks, args=(args.duration, stim_times), daemon=True).start()

    with open(base + ".csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["t_board_s"] + [f"ch{i+1}" for i in range(len(eeg_ch))])
        while time.time() - t_start < args.duration:
            time.sleep(0.2)
            d = board.get_board_data()  # kuras buffer -> tanpa duplikat
            if d.shape[1] == 0:
                continue
            block = np.column_stack([d[ts_ch], d[eeg_ch].T])
            w.writerows(block.tolist())
            rows += block.shape[0]
        d = board.get_board_data()
        if d.shape[1]:
            w.writerows(np.column_stack([d[ts_ch], d[eeg_ch].T]).tolist())
            rows += d.shape[1]
except KeyboardInterrupt:
    print("dihentikan")
finally:
    try:
        board.stop_stream()
        board.release_session()
    except Exception:
        pass

if stim_times:
    with open(base + "_stim.csv", "w") as f:
        f.write("t_epoch_s\n")
        f.writelines(f"{t:.6f}\n" for t in stim_times)

with open(base + "_meta.json", "w") as f:
    json.dump(
        {
            "device": "MindRove WiFi",
            "fs_hz": fs,
            "n_channels": len(eeg_ch),
            "rows": rows,
            "duration_s": args.duration,
            "click": args.click,
            "click_rate_hz": args.rate if args.click else None,
            "unit_note": "nilai mentah dari SDK; cek apakah sudah uV",
        },
        f,
        indent=2,
    )
print(f"selesai: {rows} baris ({rows / fs:.1f} s)")
