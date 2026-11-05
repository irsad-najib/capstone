"""
Rekam RAW CH1 alat NeuroSound (ESP32 + ADS1256 + AD620) dari backend ke CSV, tanpa filter.
Formatnya dibuat sejajar dengan tools/mindrove/record_raw.py supaya bisa dibandingkan.

Pakai:
    python3 record_raw_esp.py --duration 120 --out rec_esp_01

Output (folder ./recordings):
    <out>.csv       : idx, t_s, ch1_uV     (µV di elektroda, sudah dibagi gain AD620)
    <out>_stim.csv  : idx, t_s             (sampel yang ditandai stimulus oleh firmware)
    <out>_meta.json : waktu mulai/akhir (epoch jam laptop), jumlah sampel, fs efektif, celah

Catatan keaslian:
- /api/v1/raw/stream mengirim jendela 500 ms yang saling tumpang tindih dengan pergeseran
  yang berubah-ubah. Sampel baru dipisahkan dengan mencocokkan isi jendela; tiap sampel
  disimpan SATU kali. Kalau tidak ada tumpang tindih (pesan terlewat) dicatat sebagai celah
  dan t_s tidak diisi/ditambal.
- t_s = idx / fs_efektif, dengan fs_efektif = jumlah sampel / durasi dinding. Firmware kehilangan
  ±5-20% tepi DRDY (laju ±12-14 kSPS, bukan 15k), jadi sumbu waktu ini perkiraan, bukan jam
  sampel. Jam dinding laptop (epoch) hanya akurat ±200 ms.
- CH2 selalu nol (satu kanal per sesi) dan tidak disimpan.
"""
import argparse
import csv
import json
import os
import subprocess
import time

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="https://capstone.irsad.site/api/v1/raw/stream")
ap.add_argument("--duration", type=float, default=60, help="detik")
ap.add_argument("--out", default=f"esp_{int(time.time())}")
args = ap.parse_args()

os.makedirs("recordings", exist_ok=True)
base = os.path.join("recordings", args.out)

proc = subprocess.Popen(
    ["curl", "-sN", "-H", "User-Agent: curl/8.7.1", args.url],
    stdout=subprocess.PIPE, text=True)

x_all = []          # potongan sampel baru, berurutan
s_all = []
prev = None
gaps = 0
msgs = 0
t_start = time.time()
fs_nominal = 15000.0
KEY = 40

while time.time() - t_start < args.duration:
    line = proc.stdout.readline()
    if not line:
        break
    if not line.startswith("data:"):
        continue
    try:
        d = json.loads(line[5:])
    except Exception:
        continue
    y = np.asarray(d["samples"][0], dtype=float)
    st = np.asarray(d["stim"], dtype=bool)
    fs_nominal = float(d.get("sampling_rate", fs_nominal))
    msgs += 1
    if prev is None:
        x_all.append(y)
        s_all.append(st)
    else:
        px, ps = prev
        key = y[:KEY]
        lag = None
        # y mulai di posisi lag dalam jendela sebelumnya → sampel baru = y[len(px)-lag:]
        for i in range(0, len(px) - KEY + 1):
            if np.array_equal(px[i:i + KEY], key):
                lag = i
                break
        if lag is None:
            gaps += 1
            x_all.append(y)
            s_all.append(st)
        else:
            n_new = len(y) - (len(px) - lag)
            if n_new > 0:
                x_all.append(y[-n_new:])
                s_all.append(st[-n_new:])
    prev = (y, st)

t_end = time.time()
proc.terminate()

if not x_all:
    raise SystemExit("tidak ada data dari stream (ESP offline atau akuisisi berhenti?)")

x = np.concatenate(x_all)
s = np.concatenate(s_all)
wall = t_end - t_start
fs_eff = len(x) / wall
t = np.arange(len(x)) / fs_eff

with open(base + ".csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["idx", "t_s", "ch1_uV"])
    for i in range(len(x)):
        w.writerow([i, f"{t[i]:.6f}", f"{x[i]:.3f}"])
onsets = np.flatnonzero(np.diff(s.astype(int)) == 1) + 1
with open(base + "_stim.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["idx", "t_s"])
    for i in onsets:
        w.writerow([int(i), f"{t[i]:.6f}"])
with open(base + "_meta.json", "w") as f:
    json.dump({
        "device": "neurosound esp32+ads1256+ad620 (CH1)",
        "t_start_epoch": t_start, "t_end_epoch": t_end, "wall_s": wall,
        "samples": int(len(x)), "fs_nominal": fs_nominal, "fs_effective": fs_eff,
        "messages": msgs, "gaps_no_overlap": gaps, "stim_onsets": int(len(onsets)),
        "unit": "uV at electrode",
    }, f, indent=2)

print(f"{len(x)} sampel dalam {wall:.1f} s  fs efektif {fs_eff:.0f} Hz  "
      f"pesan {msgs}  celah {gaps}  onset stimulus {len(onsets)}")
print("file:", base + ".csv")
