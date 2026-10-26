#!/usr/bin/env python3
"""
esp32-dummy.py
Pura-pura jadi ESP32 — baca data/dummy.json, kirim ke backend Go via WebSocket.
Usage: python3 esp32-dummy.py [--host 10.x.x.x] [--loops 0=infinite]
"""

import json, time, math, random, argparse, sys
from pathlib import Path
import websocket  # pip install websocket-client

# ── Config ────────────────────────────────────────────────────────────────
DEVICE_ID  = "esp32-abr-001"
FS         = 860          # ADS1115 sample rate
STIM_INT   = 0.091        # detik (~11 klik/dtk)
MS_PER_SAMPLE = 1000 / FS # ~1.163 ms

def load_data():
    p = Path(__file__).parent / "data" / "dummy.json"
    if not p.exists():
        print(f"[ERR] {p} tidak ditemukan. Jalankan generator dulu.")
        sys.exit(1)
    with open(p) as f:
        return json.load(f)

def run(host, port, loops):
    data    = load_data()
    frames  = data["ws_frames"]          # list {"t","r","s"}
    n_frame = len(frames)

    url = f"ws://{host}:{port}/ws?id={DEVICE_ID}"
    print(f"[ESP32-DUMMY] Connecting → {url}")
    print(f"[ESP32-DUMMY] {n_frame} frames loaded, {sum(f['s'] for f in frames)} stimulus")

    ws = websocket.WebSocket()
    try:
        ws.connect(url)
    except Exception as e:
        print(f"[ERR] Gagal connect: {e}")
        sys.exit(1)

    print(f"[ESP32-DUMMY] Connected ✅")

    loop_count = 0
    sent = 0
    stim_sent = 0
    t_start = time.time()

    # offset timestamp supaya monoton
    ts_offset = round(time.time() * 1000)

    try:
        while True:
            loop_count += 1
            if loops > 0 and loop_count > loops:
                break

            print(f"\n[LOOP {loop_count}] Kirim {n_frame} frames...")

            for i, fr in enumerate(frames):
                t0 = time.perf_counter()

                # build JSON persis seperti firmware main.ino:479
                ts  = ts_offset + fr["t"] + (loop_count-1) * frames[-1]["t"]
                msg = json.dumps({"t": ts, "r": fr["r"], "s": fr["s"]},
                                 separators=(',', ':'))
                try:
                    ws.send(msg)
                except Exception as e:
                    print(f"[ERR] send failed: {e}")
                    return

                sent += 1
                if fr["s"]:
                    stim_sent += 1

                # log tiap 86 frame (~100ms)
                if sent % 86 == 0:
                    elapsed = time.time() - t_start
                    sps = sent / elapsed
                    print(f"  frame={sent:5d}  stim={stim_sent:3d}  "
                          f"r={fr['r']:+6d}  mv={fr['r']*0.125:+7.3f}mV  "
                          f"SPS={sps:.0f}")

                # rate control: tidur sisa waktu per sample
                dt = time.perf_counter() - t0
                sleep = max(0, MS_PER_SAMPLE/1000 - dt)
                if sleep > 0:
                    time.sleep(sleep)

    except KeyboardInterrupt:
        print(f"\n[ESP32-DUMMY] Dihentikan — total {sent} frame, {stim_sent} stim")
    finally:
        ws.close()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host",  default="localhost")
    ap.add_argument("--port",  default=8080, type=int)
    ap.add_argument("--loops", default=0, type=int,
                    help="0=infinite, N=berapa kali loop data")
    args = ap.parse_args()
    run(args.host, args.port, args.loops)
