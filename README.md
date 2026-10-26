# Neurosound — Wearable EEG untuk Skrining Gangguan Pendengaran Berbasis ABR

Capstone Project C-251 · DTETI, Fakultas Teknik UGM

Sistem skrining pendengaran non-invasif yang merekam **Auditory Brainstem Response (ABR)**:
ESP32 membangkitkan stimulus *tone burst* lewat DAC, merekam respons EEG dari elektroda kepala,
lalu men-stream sinyalnya ke backend Go untuk difilter, di-*epoch*, dan dirata-ratakan sampai
gelombang **Wave V** muncul dan bisa dibaca di dashboard web.

```
        ┌─────────────────────────────────────────────┐
        │                  ESP32                      │
 EEG ──▶│  ADS1299/ADS1115 (SPI/I2C) ── akuisisi      │
        │  PCM5102A (I2S) ────────────── tone burst   │──┐
        └─────────────────────────────────────────────┘  │ WebSocket (JSON)
                                                         ▼
        ┌─────────────────────────────────────────────────────────┐
        │  Backend Go  (:8080)                                    │
        │  ring buffer → Butterworth BPF → epoching → averaging   │
        │  → deteksi Wave V (latency + amplitude)                 │
        │  ── worker Python untuk DSP berat, MongoDB untuk sesi   │
        └─────────────────────────────────────────────────────────┘
                                    │ REST + SSE
                                    ▼
        ┌─────────────────────────────────────────────────────────┐
        │  Frontend Next.js — live waveform, riwayat scan, hasil  │
        └─────────────────────────────────────────────────────────┘
```

---

## Struktur Repo

| Folder | Isi | Status |
| --- | --- | --- |
| `neurosound-backend/` | **Backend utama.** Go + worker Python DSP, MongoDB opsional, REST + SSE + WebSocket | aktif |
| `frontend/` | **Dashboard utama.** Next.js 16 + React 19 + Tailwind 4 | aktif |
| `esp/` | **Firmware aktif.** ESP-IDF: ADS1299 16 kSPS (CH1 Cz-A1, CH2 Cz-A2) + stimulus ABR tersinkron, mode tes audio, baterai, WiFi AP + captive portal, WSS ke backend | aktif |
| `archive/` | Kode lama yang sudah tidak dipakai, disimpan sebagai riwayat (lihat bawah) | arsip |
| `schematic-fix/` | **Skematik final** Board 1 (analog, ADS1299) dan Board 2 (digital, ESP32 + PCM5102A) | aktif |
| `3d-new/` | Model 3D enclosure terbaru (Blender + Bambu) | aktif |
| `Dokumen/` | Laporan LaTeX terbaru (tidak di-push) | aktif |
| `archive/ads1115/` | Firmware ABR ESP32 + ADS1115, akuisisi + stimulus + streaming WS | arsip |
| `archive/backend/` | Backend generasi pertama (Go). Referensi pipeline ABR awal | arsip |
| `archive/Capstone/` | Firmware awal — WiFi provisioning, captive portal, I2S audio | arsip |
| `archive/ads-only/` | Eksperimen ESP-IDF: driver ADS1299 murni (C), tanpa Arduino | arsip |
| `archive/ads1299/` | Iterasi ADS1299 di PlatformIO/Arduino + datasheet & catatan wiring | arsip |
| `archive/esp32-dummy.py` | Simulator ESP32 — kirim frame WS palsu tanpa hardware | arsip |
| `archive/html/` | `index.html`, `sim-*.html`, `ws-frame-simulation.html`: simulasi interaktif (Butterworth, tone burst, epoching, SNR/Pearson, evolusi ABR) | arsip |
| `archive/capstone-3d/` | Model enclosure headphone lama (Blender) + script generator | arsip |
| `archive/schematic/` | Rebuild KiCad ESP-EEG v1 (Cerelog), bukan desain board yang dipakai | arsip |
| `archive/c251/` | Versi lama laporan LaTeX (10 Agustus); versi terbaru di `Dokumen/` | arsip |
| `archive/data/` | Rekaman sesi lama | arsip |
| `PROMPT_BAB*.md` | Draft/outline bab laporan | — |

> Beberapa folder sengaja **tidak** ikut ke repo ini — lihat [Yang tidak di-push](#yang-tidak-di-push).

---

## Quick Start

Butuh: **Go 1.22+**, **Node 20+**, **Python 3.10+**, dan **PlatformIO** (untuk firmware).

### 1. Backend

```bash
cd neurosound-backend
./scripts/setup.sh          # bikin .venv + install dependensi Python
go mod tidy
cp .env.example .env        # sesuaikan PORT / MONGO_URI kalau perlu
go run .                    # listen di :8080
```

MongoDB opsional (kalau mau simpan riwayat sesi):

```bash
docker compose up -d mongo
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

Default backend URL sudah `http://localhost:8080`, jadi tidak perlu env tambahan.

### 3. Tanpa hardware? Pakai simulator

```bash
python archive/esp32-dummy.py       # nyambung ke ws://localhost:8080/ws sebagai device palsu
```

### 4. Firmware ESP32

```bash
cd esp
pio run -e esp32dev                        # build
pio run -e esp32dev -t upload              # flash
pio device monitor -b 115200               # serial monitor (ketik ? untuk daftar perintah)
```

Konfigurasi ada di `src/net.h` (`NET_DEVICE_ID`, `NET_WS_URI`). WiFi diisi lewat captive portal:
tanpa kredensial tersimpan, device membuka AP `ESP32-Setup` / `12345678`, portal di `http://4.3.2.1/`.

**Reset kredensial WiFi:** tahan tombol BOOT (GPIO 0) saat device menyala, atau ketik `wifi reset`.

Saat boot firmware masuk mode **abr** kalau ADS1299 (Board 1) terdeteksi, selain itu mode **tone**
(tes audio). Perintah serial utama: `abr`, `tone`, `on`/`off`, `db <dB>`, `st click|burst`, `rate`,
`pol`, `ads` (status akuisisi), `ads test on` (sinyal uji internal), `?` (semua perintah).
Sampel EEG dikirim sebagai pesan WebSocket biner (format di `esp/src/ads1299.h`).

Pengukuran output audio pakai osiloskop: `esp/docs/ukur-osiloskop.md`.
Firmware ABR lama (ADS1115) ada di `archive/ads1115/`.

---

## Kontrak Data

**ESP32 → backend** (`ws://<host>:8080/ws?id=<device_id>`):

```json
{ "ch1": 12345, "ch2": -4321, "ts": 1234567890, "stim": true }
```

`ch1`/`ch2` = nilai ADC mentah, `ts` = timestamp mikrodetik, `stim` = penanda onset tone burst
(dipakai backend sebagai trigger *epoching*).

**Endpoint backend utama:**

| Method | Path | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/health` | health check |
| `GET` | `/api/v1/devices` | daftar device yang tersambung |
| `GET` | `/api/v1/abr` | hasil averaging ABR terkini |
| `GET` | `/api/v1/raw/stream` | SSE stream waveform mentah |
| `POST` | `/api/v1/stim` | mulai/stop stimulus |
| `POST` | `/api/v1/stim/set` | set level stimulus, body `{"db": 80}` |
| `POST` | `/api/v1/abr/save` | simpan sesi |
| `GET` | `/api/v1/sessions` | riwayat sesi |
| `POST` | `/api/v1/reset` | reset buffer averaging |

---

## Pin Hardware (firmware `esp/`, skematik Board 2)

| Sinyal | GPIO |
| --- | --- |
| I2S BCK (PCM5102A) | 32 |
| I2S LRCK | 33 |
| I2S DIN | 14 |
| Sensor baterai (R8 220k / R9 100k) | 35 |
| ADS1299 MOSI / MISO / SCLK (lewat 33 Ω) | 23 / 19 / 18 |
| ADS1299 CS_N / DRDY | 21 / 34 |
| ADS1299 START / RESET_N / PWDN_N | 25 / 26 / 27 |
| Tombol reset WiFi | 0 (BOOT) |

Wiring ADC firmware lama ada di `archive/ads1115/WIRING.md` dan `archive/ads1299/Capstone/docs/`.

---

## Catatan Teknis

- **Radio WiFi mengganggu timing I2S.** Jangan pernah panggil `setupI2S()` dari dalam
  `onWiFiEvent()` — pakai flag `pendingI2SReinit` dan lakukan reinit di main loop.
- **Tidak ada `delay()` di main loop.** Gunakan perbandingan `millis()`.
- **Tidak ada alokasi dinamis di loop cepat.** Pakai buffer statis.
- **Pembagian core:** audio + WiFi di Core 0, akuisisi EEG di Core 1 dengan prioritas
  FreeRTOS tertinggi.

---

## Yang tidak di-push

Sengaja di-`.gitignore` — kalau baru clone, jangan kaget kalau tidak ada:

| Item | Alasan |
| --- | --- |
| `archive/capstone-3d/*.blend` | ±190 MB per file, di atas hard limit GitHub 100 MB. Yang di-track: `build_headphone_v2.py` + render `docs/*.png`. Sumbernya disimpan terpisah. |
| `Dokumen/`, `archive/c251/` | Dokumen laporan LaTeX — berisi tanda tangan, laporan Turnitin, dan berkas administratif yang tidak layak publik. |
| `node_modules/`, `.next/`, `.venv/` | Dependensi & cache build, regenerate dengan `npm install` / `setup.sh`. |
| `.pio/`, `*.elf`, `*.map`, `*.bin` | Artefak build PlatformIO. |
| `archive/backend/server`, `tmp/` | Binary hasil `go build` dan folder live-reload `air`. |
| `data/`, `*.csv`, `eeg_abr_*.json` | Data rekaman sesi. Bisa besar dan bukan source. |
| `.env`, `*.pem`, `*.key` | Kredensial. `.env.example` tetap di-track sebagai template. |
| `*.zip` | Arsip/backup, sudah ada versi ter-ekstraknya. |

---

## Tim

| Nama | NIM | Prodi |
| --- | --- | --- |
| Irsad Najib Eka Putra | 23/518119/TK/57005 | Teknologi Informasi |
| Nafil Nissano Yogma Pratama | 23/521136/TK/57475 | Teknik Biomedis |
| Azizah Az Zahra | 23/519983/TK/57292 | Teknik Biomedis |
| Isna Rahmanadia | 23/520928/TK/57450 | Teknik Biomedis |

Dosen pembimbing: Ahmad Ataka Awwalur Rizqi, S.T., Ph.D.
