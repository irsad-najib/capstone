"""
Putar ulang rekaman RAW (CSV dari tools/esp/record_raw_esp.py) ke backend lokal sebagai paket v3,
lalu cetak hasil ABR/verdict. Tidak menyentuh ESP maupun server produksi.

Pakai (dari akar repo):
    (cd neurosound-backend && go build -o /tmp/nsb_replay .)
    python3 tools/analysis/replay.py recordings/abr_80nom_L_01 click
  argumen 1 = awalan file (tanpa .csv; ada <awalan>.csv dan <awalan>_stim.csv), argumen 2 = click|burst.
  Env: NSB_BIN (default /tmp/nsb_replay). Butuh numpy dan python dengan scipy untuk dsp_worker.
Catatan: skala 0.0298 uV/LSB (AD620 x20, ADS1256 2.5 V, PGA 1) dipakai untuk mengubah uV kembali ke LSB.
"""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
S = os.environ.get("REPLAY_TMP", "/tmp")
REC = sys.argv[1]; KIND = sys.argv[2] if len(sys.argv) > 2 else "click"
BE = os.path.join(ROOT, "neurosound-backend")
NSB = os.environ.get("NSB_BIN", "/tmp/nsb_replay")
env = dict(os.environ, PORT="18081", SESSION_DIR=os.path.join(S, "replay_sessions"))
env.pop("MONGO_URI", None); env.pop("LOG_TOKEN", None)
srv = subprocess.Popen([NSB], cwd=BE, env=env, stdout=open(os.path.join(S, "replay_srv.log"), "w"), stderr=subprocess.STDOUT)
time.sleep(2)
try:
    x = np.loadtxt(REC + ".csv", delimiter=",", skiprows=1, usecols=2)
    ons = np.loadtxt(REC + "_stim.csv", delimiter=",", skiprows=1, usecols=0, dtype=int)
    print("sampel", len(x), "onset", len(ons), flush=True)
    UV = 0.0298
    raw = np.round(x / UV).astype(np.int64)
    s = socket.create_connection(("localhost", 18081), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET /ws?id=esp32-audio-001 HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % key).encode())
    r = b""
    while b"\r\n\r\n" not in r: r += s.recv(4096)
    s.settimeout(None)
    def send(op, payload):
        m = os.urandom(4); n = len(payload)
        hdr = bytes([0x80 | op, 0x80 | n]) if n < 126 else bytes([0x80 | op, 0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | op, 0x80 | 127]) + struct.pack(">Q", n)
        s.sendall(hdr + m + bytes(b ^ m[i % 4] for i, b in enumerate(payload)))
    def v3(smp, onl, seq):
        m = bytearray(24); m[0], m[1] = 0xEE, 3
        struct.pack_into("<H", m, 2, len(smp)); struct.pack_into("<I", m, 4, seq); struct.pack_into("<Q", m, 8, int(time.time() * 1e6))
        struct.pack_into("<H", m, 16, 15000); m[18], m[19] = 1, 1; struct.pack_into("<f", m, 20, UV)
        for v in smp:
            v = int(v) & 0xFFFFFF; m += bytes([(v >> 16) & 255, (v >> 8) & 255, v & 255])
        m.append(len(onl))
        for o in onl: m += struct.pack("<H", o)
        return bytes(m)
    send(1, json.dumps({"type": "audio_test", "device": "esp32-audio-001", "seq": 1, "uptime_ms": 1, "on": True, "freq": 1000.0, "level_dbfs": -20.0, "ch": "L", "mode": "abr", "stim": KIND, "rate": 11.1, "onsets": 0, "ads": True, "acq": True, "eeg_ch": 1, "debug": False, "bat_mv": 4000, "bat_pct": 80, "bat_critical": False}).encode())
    onset_set = set(int(i) for i in ons)
    P = 1500
    for seq, a in enumerate(range(0, len(raw) - P + 1, P)):
        ol = [i - a for i in range(a, a + P) if i in onset_set]
        send(2, v3(raw[a:a + P], ol, a))
        time.sleep(0.012)
    time.sleep(8)
    j = json.load(urllib.request.urlopen("http://localhost:18081/api/v1/abr", timeout=10))
    an = j["analysis"]
    print(json.dumps({k: j.get(k) for k in ("trial_count", "rejected", "stim_count", "status", "snr", "pearson_r")}))
    print("verdict", an["verdict"], "normal", an["normal"], "waves", [(w["name"], w["latency_ms"]) for w in an["waves"]])
    print("reasons", an["reasons"])
finally:
    srv.terminate()
