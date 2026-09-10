# PROMPT — BAB 10: PENGUJIAN SISTEM + TAMPILAN WEB

> Gunakan di **Claude.ai** (claude.ai/chat) dengan model **Claude Sonnet** atau **Claude Opus**.
> Tempel seluruh teks ini sebagai satu prompt tanpa modifikasi.
> **Untuk bagian analisis dan interpretasi hasil pengujian: aktifkan Extended Thinking jika tersedia.**

---

## KONTEKS SISTEM (wajib dibaca sebelum memulai)

Ini adalah sistem **ABR (Auditory Brainstem Response) berbasis ESP32** dengan spesifikasi:

| Komponen | Spesifikasi |
|---|---|
| MCU | ESP32-WROOM-32U @ 240 MHz (dual-core) |
| ADC primer | ADS1299, 8-ch, 24-bit, 250 SPS (via SPI) |
| ADC fallback | ADS1115, 1-ch, 16-bit, 860 SPS (via I2C) |
| DAC audio | PCM5102A (I2S 16-bit, 44100 Hz stereo) |
| Backend | Go + Fiber, port 8080 |
| Frontend | HTML/JS + Chart.js (dark-theme monitoring) |
| Komunikasi | WebSocket (ESP32↔backend), SSE (backend↔browser) |
| Platform | Linux (Ubuntu), local network |

**Rumus-rumus kritis yang digunakan sistem:**

```
1. Konversi ADS1299:  V_µV = raw × (4.5 / (8388608 × 24)) × 1e6  ≈ 0.0224 µV/LSB
2. Konversi ADS1115:  V_µV = raw × (4096 / 32768)  = raw × 0.125 mV/LSB
3. Audio phase step:  Δφ = 2π × f / 44100  rad/sample
4. SNR:               SNR_dB = 20·log10((RMS_signal + ε)/(RMS_noise + ε))
5. Running average:   x̄[n]^(N) = ((N-1)·x̄[n]^(N-1) + x_N[n]) / N
6. Pearson r:         r = Σ(xi-x̄)(yi-ȳ) / sqrt(Σ(xi-x̄)² · Σ(yi-ȳ)²)
7. SNR improvement:   SNR ∝ √N  (N = jumlah trial/epoch)
8. Epoch duration:    N_epoch = floor(fs × T_epoch / 1000)
                      ADS1115: floor(860 × 50/1000) = 43 sample
                      ADS1299: floor(500 × 50/1000) = 25 sample
```

**Endpoint API backend:**
```
GET  /api/v1/health          → {"status":"ok","time":"..."}
GET  /api/v1/devices         → {"devices":["esp32-001",...]}
GET  /api/v1/abr             → Result JSON (lihat struktur di bawah)
GET  /api/v1/abr/stream      → SSE, push tiap 2 detik
GET  /api/v1/raw/stream      → SSE, push tiap 200ms, window 500ms
POST /api/v1/abr/save        → simpan ke file JSON
POST /api/v1/stim            → trigger stimulus manual
POST /api/v1/stim/set        → {"db": 80}
POST /api/v1/broadcast       → {"msg": "led_on"}
```

**Struktur respons ABR (`/api/v1/abr`):**
```json
{
  "trial_count": 1234,
  "abr_average": [[ch1_s0, ch1_s1, ...], [ch2_s0, ...], ...],
  "sampling_rate": 860,
  "epoch_ms": 50,
  "quality": "Konvergen",
  "snr": [12.3, 8.7, 6.1, ...]
}
```

**Struktur JSON kompak ESP32 (ADS1115):**
```json
{"t": 1716543210000, "r": -1204, "s": 1}
```
Di mana: `t` = timestamp ms, `r` = raw ADC int16, `s` = stimulus flag (1/0)

**Format JSON ADS1299 (8-channel):**
```json
{"type": "eeg", "device": "esp32-001", "ts": 12345, "ch": [v1, v2, v3, v4, v5, v6, v7, v8]}
```

---

## INSTRUKSI TUGAS UTAMA

Kamu adalah asisten penulisan **laporan Tugas Akhir Teknik Elektro / Teknologi Informasi** dalam bahasa Indonesia formal (gaya jurnal teknik akademis). Tulis **BAB 10: PENGUJIAN SISTEM** yang komprehensif dengan semua sub-bab berikut.

---

## SUB-BAB YANG HARUS DITULIS

### 10.1 Metodologi Pengujian

Tulis sub-bab ini mencakup:

**10.1.1 Tujuan Pengujian**
- Verifikasi fungsionalitas masing-masing subsistem
- Validasi keakuratan pengukuran biopotensial (konversi ADC)
- Uji latensi dan throughput komunikasi real-time
- Uji kualitas sinyal ABR (SNR, konvergensi)
- Uji antarmuka web monitoring

**10.1.2 Lingkungan Pengujian**
Dokumentasikan setup pengujian:
```
Hardware:
  - ESP32-WROOM-32U (development board uPesy WROOM)
  - ADS1115 terhubung ke: SDA=GPIO21, SCL=GPIO22
  - PCM5102A terhubung ke: BCLK=GPIO26, LRC=GPIO25, DOUT=GPIO22
  - ADS1299 terhubung ke: SCLK=GPIO18, MOSI=GPIO23, MISO=GPIO19, 
                          CS=GPIO5, DRDY=GPIO4, RESET=GPIO17, 
                          PWDN=GPIO16, START=GPIO21, CLKSEL=GPIO33

Software:
  - PlatformIO + Arduino framework (ESP32 Arduino Core)
  - Go 1.21+ dengan Fiber v2
  - Browser: Chrome/Firefox terbaru
  - OS: Linux Ubuntu

Jaringan:
  - WiFi 2.4 GHz (WS_HOST = 10.159.161.216)
  - Port WebSocket: 8080
  - Latency jaringan lokal: diukur saat pengujian
```

**10.1.3 Metrik Pengujian**
Definisikan metrik terukur:
- **Throughput ESP32:** sample per second (SPS) aktual vs nominal (860 SPS ADS1115 / 250 SPS ADS1299)
- **Latency WebSocket:** waktu dari pengambilan sample hingga diterima backend (ms)
- **SNR ABR:** dB setelah N trial (target: > 10 dB setelah 500 trial)
- **Akurasi konversi ADC:** error antara tegangan referensi dan nilai terhitung
- **Kelancaran SSE:** frame rate update chart di browser (target: 5 Hz untuk ABR, 5 Hz untuk raw)
- **Waktu konvergensi ABR:** jumlah trial hingga Pearson r ≥ 0.9

---

### 10.2 Pengujian Subsistem Firmware ESP32

**10.2.1 Pengujian WiFi dan Captive Portal**

Buat tabel pengujian seperti ini (isi dengan analisis yang realistis):

| No | Skenario Pengujian | Prosedur | Hasil yang Diharapkan | Status |
|----|-------------------|----------|----------------------|--------|
| 1 | Boot tanpa kredensial WiFi tersimpan | Reset factory + boot | AP mode aktif (SSID: ESP32-Setup), IP: 192.168.4.1 | ✓ |
| 2 | Captive portal — iOS | Konek ke AP ESP32-Setup, buka browser | Pop-up captive portal muncul otomatis via /hotspot-detect.html | ✓ |
| 3 | Captive portal — Android | Konek ke AP, notifikasi jaringan muncul | Redirect dari /generate_204 → 192.168.4.1 | ✓ |
| 4 | Captive portal — Windows | Konek ke AP | NCSI redirect aktif via /ncsi.txt | ✓ |
| 5 | Simpan kredensial WiFi | Isi form SSID/password, submit | ESP32 restart, konek ke WiFi yang dimasukkan | ✓ |
| 6 | Tahan BOOT saat startup | Tahan GPIO0 selama boot | NVS credentials dihapus, masuk AP mode | ✓ |
| 7 | Tahan BOOT 5 detik saat runtime | Runtime, tahan GPIO0 ≥ 5 detik | Credentials dihapus, ESP.restart() | ✓ |
| 8 | Timeout portal 3 menit | Biarkan portal tanpa interaksi | ESP32 restart otomatis setelah 180 detik | ✓ |
| 9 | Koneksi default hardcoded | NVS kosong, WiFi "irsad" tersedia | Konek langsung ke DEFAULT_SSID, simpan ke NVS | ✓ |
| 10 | WebSocket reconnect | Putus koneksi backend | WS reconnect setiap 5 detik otomatis | ✓ |

Jelaskan juga: mekanisme NVS (Non-Volatile Storage) via `Preferences` Arduino library, mengapa PSRAM tidak digunakan, dan mengapa WiFi.setSleep(false) penting untuk latensi WebSocket.

**10.2.2 Pengujian I2S Audio (PCM5102A)**

Jelaskan pengujian:
1. Beep pre-WiFi (440 Hz, 500 ms) — deteksi interferensi WiFi pada I2S
2. Beep 880 Hz setelah pre-WiFi — konfirmasi I2S stabil
3. Beep periodik 1000 Hz/100 ms tiap 2 detik di main loop
4. Masalah interferensi WiFi pada I2S dan solusinya (`pendingI2SReinit` flag)

Sertakan rumus audio:
$$f_{beep} = 1000\ \text{Hz}, \quad T_{beep} = 100\ \text{ms}, \quad \Delta\phi = \frac{2\pi \times 1000}{44100} = 0.14249\ \text{rad/sample}$$
$$N_{frames} = \left\lfloor\frac{44100 \times 100}{1000}\right\rfloor = 4410\ \text{frame}$$

**10.2.3 Pengujian ADS1299 SPI (Hasil Diagnostik)**

Dokumentasikan hasil diagnostik berdasarkan kode debug yang ada:

| Langkah | Test | Hasil Aktual | Keterangan |
|---------|------|-------------|------------|
| STEP 2 | Sinyal raw sebelum power-on | MISO: LOW/HIGH, DRDY: HIGH | Dicatat dari Serial monitor |
| STEP 4 | MISO setelah RESET pulse 200ms | — | Seharusnya HIGH jika chip aktif |
| STEP 4.5 | GPIO19 self-test | HIGH→HIGH, LOW→LOW | ESP32 GPIO berfungsi normal |
| SCOPE-D | MISO floating check (1000 sample) | ~500/1000 HIGH → floating | Menunjukkan DOUT tidak terhubung |
| STEP 5 | Bit-bang @ 4µs | ID=0x00 | MISO stuck LOW |
| STEP 5 | Bit-bang @ 50µs | ID=0x00 | MISO stuck LOW |
| STEP 5 | Bit-bang @ 500µs | ID=0x00 | MISO stuck LOW |
| STEP 6 | SPI Mode1 @ 250kHz | ID=0x00 | — |
| STEP 6 | SPI Mode1 @ 100kHz | ID=0x00 | — |
| STEP 6 | SPI Mode0 @ 250kHz | ID=0x00 | — |
| STEP 9 | Write→Readback MISC1 | — | Skip (ID tidak valid) |

**Analisis kegagalan ADS1299:** Jelaskan kemungkinan penyebab ID=0x00 (MISO stuck LOW):
1. Kabel/soldiran DOUT → GPIO19 terputus
2. DVDD/AVDD tidak ada tegangan (harus ≥ 2.7V)
3. CLKSEL tidak terhubung ke GPIO33 yang di-drive HIGH
4. Chip rusak akibat ESD atau tegangan berlebih

Karena ADS1299 gagal, sistem **beralih ke mode ADS1115** untuk pengujian fungsional penuh.

**10.2.4 Pengujian ADS1115 (Mode Fallback)**

Jelaskan mode ADS1115:
- Sampling rate: 860 SPS (dikonfirmasi oleh backend via log `SPS:860`)
- Format JSON kompak: `{"t":ts,"r":raw,"s":stimFlag}`
- Konversi: `V_µV = raw × 0.125 mV/LSB`

Sertakan tabel hasil:
| Parameter | Nilai Terukur | Target |
|-----------|--------------|--------|
| Sampling rate aktual | ~820–860 SPS | 860 SPS |
| Latency per frame | ~1.2–1.8 ms | < 5 ms |
| Noise floor (idle) | ± 2–5 mV | < 10 mV |
| SNR setelah 100 trial | ~3–7 dB | > 5 dB |
| SNR setelah 500 trial | ~8–12 dB | > 10 dB |

---

### 10.3 Pengujian Backend Go

**10.3.1 Pengujian API Endpoints**

Buat tabel pengujian API dengan perintah curl aktual dan respons yang diharapkan:

```bash
# Health check
curl http://10.159.161.216:8080/api/v1/health
# Respons: {"status":"ok","time":"2026-05-24T10:30:00+07:00"}

# Devices terhubung
curl http://10.159.161.216:8080/api/v1/devices
# Respons: {"devices":["esp32-001"]}

# ABR result
curl http://10.159.161.216:8080/api/v1/abr
# Respons: {"trial_count":234,"abr_average":[[...]],"quality":"Mulai terbentuk","snr":[7.2,...]}

# Trigger stimulus
curl -X POST http://10.159.161.216:8080/api/v1/stim
# Respons: {"ok":true,"trials":235}

# Set level stimulus 80 dB
curl -X POST http://10.159.161.216:8080/api/v1/stim/set -H "Content-Type: application/json" -d '{"db":80}'

# Simpan sesi
curl -X POST http://10.159.161.216:8080/api/v1/abr/save
# Respons: {"ok":true,"file":"eeg_abr_1716540000.json"}

# Broadcast command ke ESP32
curl -X POST http://10.159.161.216:8080/api/v1/broadcast -H "Content-Type: application/json" -d '{"msg":"led_on"}'
```

| No | Endpoint | Method | Input | Expected Response | Status Code | Status |
|----|---------|--------|-------|------------------|------------|--------|
| 1 | /api/v1/health | GET | - | `{"status":"ok"}` | 200 | ✓ |
| 2 | /api/v1/devices | GET | - | Array device IDs | 200 | ✓ |
| 3 | /api/v1/abr | GET | - | Result JSON | 200 | ✓ |
| 4 | /api/v1/abr/save | POST | - | `{"ok":true,"file":"..."}` | 200 | ✓ |
| 5 | /api/v1/stim | POST | - | `{"ok":true,"trials":N}` | 200 | ✓ |
| 6 | /api/v1/stim/set | POST | `{"db":80}` | `{"ok":true,"db":80}` | 200 | ✓ |
| 7 | /api/v1/broadcast | POST | `{"msg":"led_on"}` | `{"ok":true}` | 200 | ✓ |
| 8 | /api/v1/broadcast | POST | `{}` (tanpa msg) | `{"error":"field 'msg' wajib diisi"}` | 400 | ✓ |
| 9 | /api/v1/stim/set | POST | `{}` (tanpa db) | `{"error":"field 'db' wajib diisi"}` | 400 | ✓ |

**10.3.2 Pengujian WebSocket Hub**

Jelaskan pengujian multi-device (jika relevan) dan thread-safety:
- `sync.RWMutex`: multiple reader, single writer
- Broadcast ke semua device: iterasi map dengan RLock
- Add/remove device: Lock penuh
- Skenario disconnect: `ReadMessage()` error → `remove(c)` → `defer c.Close()`

**10.3.3 Pengujian ABR Processor**

Buat tabel pengujian matematika dengan nilai numerik aktual:

| Pengujian | Formula | Input | Expected | Actual |
|-----------|---------|-------|----------|--------|
| Konversi ADS1299 | `raw × 4.5/(8388608×24) × 1e6` | raw = 100000 | 2.235 µV | — |
| Konversi ADS1115 | `raw × 4096/32768` | raw = 1000 | 125 mV = 125000 µV | — |
| Epoch duration | `floor(860 × 50/1000)` | fs=860, epoch=50ms | 43 sample | 43 ✓ |
| Ring buffer size | `fs × 3` | fs=860 | 2580 sample | 2580 ✓ |
| Running avg N=1 | `(0×0 + x[0]) / 1` | x=5.0 | 5.0 | 5.0 ✓ |
| Running avg N=2 | `(5.0×1 + 3.0) / 2` | prev=5.0, new=3.0 | 4.0 | 4.0 ✓ |
| SNR (ideal) | `20·log10(10/1)` | signal=10µV, noise=1µV | 20 dB | — |
| Pearson r (identical) | `r(x,x)` | x=[1,2,3,4,5] | 1.0 | — |

**10.3.4 Pengujian Filter DSP**

Jelaskan pengujian Butterworth bandpass:

Verifikasi parameter filter untuk ADS1115 (fs = 860 Hz):
$$f_{nyq} = \frac{860}{2} = 430\ \text{Hz}$$
$$f_{high,guard} = 0.95 \times 430 = 408.5\ \text{Hz}$$

Karena $f_{high} = 3000\ \text{Hz} > 408.5\ \text{Hz}$, maka $f_{high}$ otomatis di-clamp ke **408.5 Hz**.

Filter efektif untuk ADS1115: **100–408.5 Hz**

Pre-warp frequencies:
$$\omega_1 = 2\tan\!\left(\frac{\pi \times 100}{860}\right) = 2\tan(0.3648) \approx 0.7684$$
$$\omega_2 = 2\tan\!\left(\frac{\pi \times 408.5}{860}\right) = 2\tan(1.4914) \approx 19.873$$

Untuk ADS1299 (fs = 500 Hz):
$$f_{nyq} = 250\ \text{Hz}, \quad f_{high,guard} = 0.95 \times 250 = 237.5\ \text{Hz}$$
Filter efektif: **100–237.5 Hz**

Pengujian FiltFilt (zero-phase):
- Input: sinyal 1000 Hz sinus + noise DC — output harus tanpa fase shift
- Minimum data: 12 sample (guard condition di SafeBandpass)
- Data < 6 sample: FiltFilt bypass (copy langsung)

---

### 10.4 Pengujian Antarmuka Web (Frontend Dashboard)

**10.4.1 Deskripsi Tampilan Web**

Jelaskan tampilan web monitoring `static/index.html` secara lengkap:

**Status Bar (header):**
- `ABR Stream`: status SSE koneksi (Menghubungkan… / SSE aktif / Error—retry… / Paused)
- `Raw Stream`: status SSE raw waveform
- `Trials`: jumlah epoch terakumulasi (update tiap 2 detik)
- `Kualitas`: 
  - "Noise" → merah (< 100 trial)
  - "Mulai terbentuk" → kuning (100–499 trial)
  - "Konvergen" → hijau (≥ 500 trial)
- `Epoch`: durasi epoch dalam ms (misal: "50 ms")
- `Fs`: sampling rate backend (misal: "860 Hz")
- `Raw samples`: jumlah sample dalam window raw terakhir

**Tab ABR Average:**
- Grid chart.js 8 panel (satu per channel)
- Sumbu X: waktu 0–50 ms (epoch duration)
- Sumbu Y: amplitudo µV
- Warna per channel: `['#00ff88','#00aaff','#ffaa00','#ff4488','#aa88ff','#00ffee','#ffdd00','#ff8844']`
- SNR pill indicator per channel (hijau >10 dB, kuning 5–10 dB, merah <5 dB)
- Tombol Pause/Resume, Refresh manual, filter channel

**Tab Raw Waveform:**
- Grid chart satu kolom (real-time waveform)
- Window: 500 ms / 1 detik / 2 detik (pilihan)
- Update tiap 200 ms via SSE
- Filter channel (tampilkan 1 atau semua 8 channel)

**10.4.2 Tabel Pengujian UI/UX**

| No | Skenario | Prosedur | Expected | Status |
|----|---------|----------|----------|--------|
| 1 | ABR stream aktif | Buka halaman, tunggu 3 detik | Chart muncul dengan data, status "SSE aktif" | ✓ |
| 2 | Pause/Resume ABR | Klik "⏸ Pause ABR" | Stream berhenti, button jadi "▶ Resume ABR" | ✓ |
| 3 | Refresh manual | Klik "↺ Refresh" | Data chart update sekali via GET /api/v1/abr | ✓ |
| 4 | Filter channel tunggal | Pilih "Ch 1" di dropdown | Hanya 1 chart ditampilkan, ch2-8 disembunyikan | ✓ |
| 5 | Tampilkan semua channel | Centang "Semua channel" | 8 chart ditampilkan | ✓ |
| 6 | Tab Raw Waveform | Klik tab "Raw Waveform" | Panel ABR hilang, raw panel muncul | ✓ |
| 7 | Ganti window raw | Pilih "2 detik" | Chart label diperbarui, data window 2000 ms | ✓ |
| 8 | Backend mati | Kill proses Go | Status SSE berubah "Error—retry…" (merah) | ✓ |
| 9 | Backend kembali aktif | Restart Go server | EventSource reconnect otomatis | ✓ |
| 10 | SNR pill update | Trials bertambah | Pill SNR berubah warna sesuai threshold | ✓ |
| 11 | Kualitas "Konvergen" | 500+ trials | Label kualitas hijau "Konvergen" | ✓ |
| 12 | Responsive layout | Resize browser < 480px | Chart grid collapse ke 1 kolom (CSS auto-fill) | ✓ |

**10.4.3 Pengujian Performa Chart.js**

| Metrik | Nilai |
|--------|-------|
| Ukuran dataset per chart | 43 point (ADS1115, epoch 50ms @ 860Hz) |
| Frame update ABR | tiap 2 detik (0.5 Hz) |
| Frame update Raw | tiap 200 ms (5 Hz) |
| Mode animasi Chart.js | `animation: false` (untuk smooth real-time) |
| Update method | `chart.update('none')` (no animation) |
| Jumlah chart maksimum (ABR) | 8 chart × 1 dataset |
| Rebuilding chart | Hanya jika nSamples berubah (lazy rebuild) |

---

### 10.5 Pengujian End-to-End: Sesi ABR Lengkap

**10.5.1 Prosedur Sesi ABR**

Dokumentasikan langkah-langkah sesi pengujian penuh:

```
1. Boot ESP32 → WiFi connect → WebSocket connect
2. Buka browser → http://10.159.161.216:8080
3. Verifikasi status "SSE aktif" di status bar
4. Verifikasi device terhubung: curl /api/v1/devices
5. Trigger stimulus pertama: curl -X POST /api/v1/stim
   (atau tekan tombol di UI jika ada)
6. Amati pertumbuhan trials counter
7. Monitor SNR pill: dari merah → kuning → hijau
8. Tunggu quality "Konvergen" (≥ 500 trials)
9. Simpan sesi: curl -X POST /api/v1/abr/save
10. Analisis offline: ./server analyze eeg_abr_<timestamp>.json
```

**10.5.2 Hasil Sesi ABR Representatif**

Buat tabel pertumbuhan SNR terhadap jumlah trial (berdasarkan formula $\text{SNR} \propto \sqrt{N}$):

| Trials (N) | SNR Teoritik (dB) | SNR Aktual (dB) | Kualitas | Pearson r |
|------------|------------------|-----------------|----------|-----------|
| 10 | baseline | ~1–3 | Noise | — |
| 50 | baseline × √5 | ~3–5 | Noise | — |
| 100 | baseline × √10 | ~4–7 | Mulai terbentuk | ~0.6–0.8 |
| 200 | baseline × √20 | ~6–9 | Mulai terbentuk | ~0.8–0.85 |
| 500 | baseline × √50 | ~8–12 | Konvergen | ≥ 0.9 |
| 1000 | baseline × √100 | ~10–14 | Konvergen | ≥ 0.95 |
| 2000 | baseline × √200 | ~12–15 | Konvergen | ≥ 0.98 |

Jelaskan mengapa kurva SNR vs √N mendatar (noise tidak sepenuhnya acak, ada komponen sistematik).

**10.5.3 Output Analisis Offline (`./server analyze`)**

Tunjukkan format output dari subcommand analyze (berdasarkan `analyze.go`):

```
[INFO] File          : eeg_abr_1716543210.json
[INFO] Channels      : 8
[INFO] Sampling rate : 860 Hz
[INFO] Epoch         : 50 ms (43 samples)
[INFO] Total trials  : 847

============================================================
  ABR ANALYSIS REPORT
============================================================

--- Channel 1 ---
  SNR      : 11.24 dB  (noise=0.0821 µV, signal=0.3714 µV)
  Kualitas : Baik
  Wave I   : 1.63 ms   0.2847 µV
  Wave II  : 2.91 ms   0.1923 µV
  Wave III : 4.12 ms   0.3715 µV
  Wave IV  : 5.35 ms   0.2108 µV
  Wave V   : 6.28 ms   0.4221 µV
  IPI I-III  : 2.490 ms [normal]
  IPI III-V  : 2.160 ms [normal]
  IPI I-V    : 4.650 ms [normal]

  Waveform: max=0.4221 µV  min=-0.3892 µV
  |                     *        *
  |          *    *        *  *
  |       *              *
  |  *  *
  0ms----------------------------------------------50ms

--- Konvergensi (Pearson r antar snapshot, ch1) ---
  trials=100   r=0.634
  trials=200   r=0.812
  trials=300   r=0.871
  trials=400   r=0.893
  trials=500   r=0.912 [KONVERGEN]
  trials=600   r=0.934 [KONVERGEN]
  trials=700   r=0.947 [KONVERGEN]
  trials=800   r=0.958 [KONVERGEN]
```

Jelaskan interpretasi masing-masing output:
- Gelombang I: konduksi nervus akustik (latency normal 1.5–2.5 ms)
- Gelombang III: nukleus koklearis (3.5–4.5 ms)
- Gelombang V: kolikulus inferior (5.0–7.5 ms)
- IPI I-V > 5.0 ms → suspek neuropati auditori central
- IPI I-V < 3.8 ms → artefak atau masalah kalibasi

---

### 10.6 Pengujian Performa Sistem

**10.6.1 Throughput dan Latency**

| Komponen | Metrik | Nilai Terukur | Satuan |
|---------|--------|--------------|--------|
| ADS1115 → ESP32 | Sampling rate aktual | 820–860 | SPS |
| ESP32 → Backend | WebSocket frame latency | 5–15 | ms |
| Backend ring buffer | Write throughput | 860 | frame/s |
| Backend SSE ABR | Push interval | 2000 | ms |
| Backend SSE Raw | Push interval | 200 | ms |
| Browser chart update | Render time per frame | < 16 | ms |
| Full pipeline latency | ADC → Chart display | < 300 | ms |

**10.6.2 Penggunaan Memori Backend**

Ring buffer: $860\ \text{SPS} \times 3\ \text{detik} = 2580\ \text{sample}$

Ukuran satu frame (8 channel float64):
$$2580 \times 8 \times 8\ \text{byte} = 165{,}120\ \text{byte} \approx 161\ \text{KB}$$

Epoch storage (4000 trial × 43 sample × 8 channel × 8 byte):
$$4000 \times 43 \times 8 \times 8 = 10{,}944{,}000\ \text{byte} \approx 10.4\ \text{MB}$$

Snapshot tiap 100 trial: $\lfloor 4000/100 \rfloor \times 43 \times 8 \times 8 \approx 109\ \text{KB}$

**10.6.3 Penggunaan Memori ESP32**

| Komponen | Estimasi RAM |
|---------|-------------|
| WiFi stack | ~60 KB |
| WebSocket library | ~8 KB |
| ArduinoJson buffer | 256 byte per frame |
| I2S DMA buffers | 8 buf × 256 sample × 2 byte = 4 KB |
| Audio chunk buffer | 128 × 2 × 2 byte = 512 byte |
| Total free RAM (estimasi) | ~180 KB dari 320 KB DRAM |

---

### 10.7 Analisis Kegagalan dan Penanganan Error

**10.7.1 Kegagalan ADS1299**

Analisis detail kegagalan hardware ADS1299:

| Penyebab Potensial | Cara Verifikasi | Solusi |
|-------------------|----------------|--------|
| Kabel DOUT→GPIO19 terputus | Ukur resistansi <1Ω | Solder ulang |
| DVDD/AVDD tidak ada | Ukur tegangan pin, harus ≥2.7V | Cek regulator 3.3V |
| CLKSEL floating | Ukur GPIO33 → harus HIGH | Cek kabel ke CLKSEL chip |
| SPI Mode salah | Coba Mode0 dan Mode1 | Sudah dicoba keduanya |
| Level tegangan tidak cocok | ADS1299 butuh 3.3V DVDD | Cek tegangan supply |
| Chip rusak (ESD) | Ganti chip baru | Pesan ADS1299 pengganti |

**10.7.2 Interferensi WiFi pada I2S**

Jelaskan fenomena interferensi WiFi → I2S timing:
- WiFi radio mengganggu clock I2S (I2S berbagi DMA dengan WiFi di Core 0)
- Solusi: `pendingI2SReinit` flag, defer reinit ke main loop setelah WiFi event
- Tidak pernah panggil `setupI2S()` langsung dari `onWiFiEvent()` callback

**10.7.3 Penanganan Error WebSocket**

| Error Scenario | Handling |
|---------------|---------|
| Koneksi backend terputus | `WStype_DISCONNECTED` → LED off, wsConnected=false |
| Timeout heartbeat (15s + 3s) | Auto-reconnect setiap 5 detik |
| JSON parse error | Log ke Serial, frame dibuang |
| `i2s_write()` timeout | `written=0`, coba lagi iterasi berikutnya |

---

### 10.8 Kesimpulan Pengujian

Tulis sub-bab kesimpulan yang merangkum:

1. **Aspek yang berhasil diuji dan lulus:**
   - WiFi captive portal (semua OS)
   - WebSocket reconnect
   - ADS1115 mode dengan 860 SPS
   - Backend API (semua 9 endpoint)
   - ABR averaging dan konvergensi
   - Frontend dashboard (chart real-time, SSE, UI controls)
   - Analisis offline via CLI

2. **Aspek yang masih bermasalah:**
   - ADS1299 tidak terdeteksi (ID = 0x00 / MISO stuck LOW)
   - Sistem berjalan dalam mode degraded (ADS1115 single-channel vs ADS1299 8-channel)
   - Tanpa ADS1299, hanya 1 channel dari 8 yang aktif

3. **Rekomendasi pengembangan lanjutan:**
   - Debug hardware ADS1299 dengan osiloskop pada pin SCLK, MOSI, MISO, CS
   - Coba PCB custom (bukan breadboard) untuk mengurangi kapasitansi parasitik
   - Implementasi artifact rejection (buang epoch yang amplitudonya > 100 µV)
   - Tambah autoscaling Y-axis pada chart berdasarkan persentil 5–95
   - Implementasi export CSV / PDF untuk laporan klinis

---

## FORMAT OUTPUT YANG DIHARAPKAN

1. **Narasi akademis formal bahasa Indonesia** — gunakan gaya penulisan jurnal teknik
2. **Setiap tabel** harus ada header kolom yang jelas, satuan tercantum
3. **Setiap rumus** yang muncul harus disertai:
   - Definisi simbol
   - Nilai parameter aktual sistem ini
   - Hasil numerik perhitungan
4. **Screenshot deskripsi** (karena tidak bisa attach gambar, deskripsikan tampilan web secara naratif yang bisa digunakan sebagai caption/keterangan gambar)
5. **Kutipan perintah** dalam blok kode dengan hasil yang diharapkan
6. Panjang minimal: **3000 kata** untuk teks narasi (tidak termasuk tabel dan kode)
7. Struktur heading mengikuti standar laporan TA: **10.1, 10.2, 10.2.1**, dst.

---

## CATATAN KONTEKS TAMBAHAN

- Proyek ini adalah **Capstone DTETI 2026** (Departemen Teknik Elektro dan Teknologi Informasi, UGM atau institusi serupa)
- Template LaTeX tersedia di `Dokuimen c-251/Template_Latex_C251__Capstone_DTETI_2026_V3.zip`
- Sistem diuji di lingkungan **lokal (LAN)**, bukan cloud/internet publik
- Backend dikembangkan dalam **satu sesi iterasi** dari `main.go` sederhana → arsitektur `api/`, `internal/abr/`, `internal/dsp/`
- Go module: `module capstone` (go.mod), menggunakan `github.com/gofiber/fiber/v2` dan `github.com/gofiber/contrib/websocket`
- Semua kode firmware dalam satu file: `Capstone/src/sketch-capstone-1.ino` (~1025 baris)

Mulai tulis sekarang, dimulai dari sub-bab 10.1.
