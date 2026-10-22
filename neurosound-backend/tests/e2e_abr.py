#!/usr/bin/env python3
"""Test end-to-end backend Neurosound dengan data ABR sintetis (ground truth diketahui).

Berpura-pura jadi ESP32: kirim sinyal EEG + ABR palsu lewat WebSocket dengan format
firmware ads1115 (batch [{"t","r","s"}, ...]), lalu cek hasilnya lewat REST API:
  - semua stimulus terhitung (trial_count)
  - latensi gelombang I / III / V sesuai ground truth
  - throughput backend cukup untuk laju stimulus firmware (~11/detik)
  - status/verdict masuk akal, sesi bisa disimpan & dibaca lagi

Backend harus sudah jalan (go run .). Contoh:
  .venv/bin/python tests/e2e_abr.py                      # 100 stimulus, ada respons
  .venv/bin/python tests/e2e_abr.py --stims 600          # cukup untuk status "Konvergen"
  .venv/bin/python tests/e2e_abr.py --no-response        # tanpa ABR, harus "Refer"

Butuh: pip install numpy websocket-client
"""
import argparse
import json
import sys
import time
import urllib.request

import numpy as np
import websocket

FS = 16000                      # harus sama dengan processor.Fs di backend
ISI = int(0.091 * FS)           # 91 ms antar stimulus, sama dengan STIM_INTERVAL_MS firmware
LSB_UV = 9 / 2**24 / 24 * 1e6   # processor.RawADCToUV(1): ADS1299, Vref 4.5 V, gain 24
FIRMWARE_STIM_RATE = 1000 / 91

WAVES = {"I": (1.6, 0.30), "III": (3.7, 0.25), "V": (5.6, 0.50)}  # latensi ms, amplitudo µV
LAT_TOL_MS = 0.25


def abr_template(n):
    t = np.arange(n) / FS * 1000
    return sum(a * np.exp(-0.5 * ((t - lat) / 0.25) ** 2) for lat, a in WAVES.values())


class Checks:
    def __init__(self):
        self.failed = 0

    def __call__(self, ok, msg, detail=""):
        print(f"  [{'PASS' if ok else 'FAIL'}] {msg}" + (f"  ({detail})" if detail else ""))
        self.failed += not ok
        return ok


def http(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def stream(ws, args, rng):
    """Kirim sinyal sintetis; return waktu kirim (detik)."""
    resp = np.zeros(ISI) if args.no_response else abr_template(ISI)
    n = ISI * (args.stims + 1)   # +1 interval supaya epoch terakhir lengkap
    t = np.arange(n) / FS
    sig = args.noise_uv * rng.standard_normal(n) + args.mains_uv * np.sin(2 * np.pi * 50 * t)
    stim = np.zeros(n, dtype=int)
    stim[ISI // 2 + ISI * np.arange(args.stims)] = 1   # mulai setengah interval agar pre-stimulus terisi
    for s in np.flatnonzero(stim):
        sig[s:s + ISI] += resp[: n - s]
    raw = np.round(sig / LSB_UV).astype(int)

    t0 = time.time()
    for i in range(0, n, args.batch):
        frames = [{"t": int(j * 1e6 / FS), "r": int(raw[j]), "s": int(stim[j])}
                  for j in range(i, min(i + args.batch, n))]
        ws.send(json.dumps(frames, separators=(",", ":")))
        if args.realtime:
            lag = (i + args.batch) / FS - (time.time() - t0)
            if lag > 0:
                time.sleep(lag)
        if i % (ISI * 20) < args.batch:
            print(f"\r  kirim stimulus {i // ISI}/{args.stims}", end="", flush=True)
    print()
    zero_stims = int(np.sum((raw == 0) & (stim == 1)))
    return time.time() - t0, zero_stims


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--stims", type=int, default=100)
    ap.add_argument("--noise-uv", type=float, default=1.0, help="RMS noise EEG (µV)")
    ap.add_argument("--mains-uv", type=float, default=5.0, help="amplitudo 50 Hz (µV)")
    ap.add_argument("--no-response", action="store_true", help="tanpa ABR (simulasi tuli)")
    ap.add_argument("--batch", type=int, default=8, help="frame per pesan WS (firmware: 8)")
    ap.add_argument("--realtime", action="store_true", help="kirim secepat ESP32 asli (16 kHz)")
    ap.add_argument("--timeout", type=float, default=600, help="batas tunggu pemrosesan (detik)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    base = f"http://{args.host}:{args.port}"
    check = Checks()
    rng = np.random.default_rng(args.seed)

    print("== REST dasar")
    try:
        check(http(base, "GET", "/api/v1/health").get("status") == "ok", "GET /api/v1/health")
    except OSError as e:
        sys.exit(f"backend tidak bisa dihubungi di {base}: {e}")
    check(http(base, "POST", "/api/v1/reset").get("ok") is True, "POST /api/v1/reset")
    check(http(base, "GET", "/api/v1/abr")["trial_count"] == 0, "trial_count 0 setelah reset")

    print("== WebSocket")
    device = f"e2e-test-{int(time.time())}"
    ws = websocket.create_connection(f"ws://{args.host}:{args.port}/ws?id={device}", timeout=args.timeout)
    time.sleep(0.2)
    check(device in http(base, "GET", "/api/v1/devices")["devices"], "device terdaftar di /api/v1/devices")

    print(f"== Stream {args.stims} stimulus ({'tanpa' if args.no_response else 'dengan'} ABR, "
          f"noise {args.noise_uv} µV)")
    t0 = time.time()
    send_s, zero_stims = stream(ws, args, rng)

    last, stable_since = -1, time.time()
    while time.time() - t0 < args.timeout:
        abr = http(base, "GET", "/api/v1/abr")
        if abr["trial_count"] >= args.stims:
            break
        if abr["trial_count"] != last:
            last, stable_since = abr["trial_count"], time.time()
        elif time.time() - stable_since > 15:
            break  # tidak bertambah lagi
        print(f"\r  menunggu pemrosesan: {abr['trial_count']}/{args.stims} trial", end="", flush=True)
        time.sleep(1)
    print()
    total_s = time.time() - t0
    ws.close()

    print("== Hasil")
    n = abr["trial_count"]
    detail = f"{n}/{args.stims}"
    if zero_stims:
        detail += f"; {zero_stims} stimulus dikirim dengan r=0"
    check(n == args.stims, "semua stimulus terhitung", detail)
    rate = n / total_s if total_s else 0
    check(rate >= FIRMWARE_STIM_RATE, "throughput backend >= laju stimulus firmware",
          f"{rate:.2f} trial/s, firmware {FIRMWARE_STIM_RATE:.1f}/s; kirim {send_s:.1f} s, total {total_s:.1f} s")
    check(abr["sampling_rate"] == FS, "sampling_rate backend sama dengan tester", str(abr["sampling_rate"]))

    waves = {w["name"]: w for w in abr["analysis"]["waves"]}
    print(f"  SNR {abr['snr']} dB, pearson {abr['pearson_r']:.3f}, status {abr['status']}, "
          f"verdict {abr['analysis']['verdict']}")
    if args.no_response:
        check(abr["analysis"]["verdict"] == "Refer", "tanpa respons -> verdict Refer")
    else:
        for name, (lat, amp) in WAVES.items():
            w = waves.get(name)
            got = f"{w['latency_ms']:.3f} ms, {w['amplitude_uv']:+.3f} µV" if w else "tidak ada"
            ok = w is not None and abs(w["latency_ms"] - lat) <= LAT_TOL_MS and w["amplitude_uv"] > 0.5 * amp
            check(ok, f"gelombang {name} ≈ {lat} ms / {amp} µV", got)
        if n >= 500:
            check(abr["status"] == "Konvergen", "status Konvergen setelah >= 500 trial", abr["status"])
            check(abr["analysis"]["verdict"] == "Pass", "verdict Pass", abr["analysis"]["verdict"])

    print("== Sesi")
    saved = http(base, "POST", "/api/v1/abr/save")
    check(saved.get("ok") is True, "POST /api/v1/abr/save", saved.get("file", ""))
    sessions = http(base, "GET", "/api/v1/sessions")["sessions"]
    check(any(s["filename"] == saved.get("file") for s in sessions), "sesi muncul di /api/v1/sessions")
    doc = http(base, "GET", f"/api/v1/sessions/{saved.get('file')}")
    check(doc["trial_count"] == n, "detail sesi cocok", f"trial_count {doc['trial_count']}")

    print(f"\n{'SEMUA PASS' if not check.failed else f'{check.failed} cek GAGAL'}")
    sys.exit(1 if check.failed else 0)


if __name__ == "__main__":
    main()
