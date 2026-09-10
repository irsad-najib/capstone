# PROMPT — BAB 4: PEMODELAN PERMASALAHAN + FLOWCHART SOFTWARE

> Gunakan di **Claude.ai** (claude.ai/chat) dengan model **Claude Sonnet** atau **Claude Opus**.
> Tempel seluruh teks ini sebagai satu prompt tanpa modifikasi.

---

## KONTEKS SISTEM (System Context — jangan ubah bagian ini)

Saya sedang menulis laporan Tugas Akhir / Capstone untuk sistem **Auditory Brainstem Response (ABR) berbasis ESP32**. Sistem ini terdiri dari:

**Hardware:**
- ESP32-WROOM-32U (mikrokontroler utama)
- ADS1299 (ADC 24-bit, 8 channel, khusus biopotensial, SPI interface)
- PCM5102A (DAC I2S untuk output audio stimulus klik)
- ADS1115 (ADC 16-bit, mode fallback single-channel, 860 SPS via I2C)

**Software stack:**
- Firmware: Arduino/PlatformIO pada ESP32 (C++)
- Backend: Go (Fiber framework, port 8080)
- Frontend: HTML/JS + Chart.js (static file, dark-theme monitoring dashboard)
- Komunikasi: WebSocket (ESP32 → backend), Server-Sent Events (backend → browser)

**Alur data:**
```
ADS1299 (SPI, 250 SPS) → ESP32 (sign-extend 24-bit) 
  → WebSocket JSON → Go Backend 
    → Ring Buffer (3 detik, 1500 samples) 
      → Epoch Extraction (50 ms post-stimulus) 
        → Bandpass Filter 100–3000 Hz 
          → Running Average (ABR) 
            → SSE → Browser (Chart.js real-time)
         ↑
PCM5102A (I2S, 44100 Hz) ← Go Backend stimulus trigger
```

---

## RUMUS-RUMUS YANG DIPAKAI DALAM SISTEM (lampirkan ke bab 4)

### 1. Konversi ADC ke Tegangan (µV)

**ADS1299 (8-channel, 24-bit):**
$$V_{ch}[\mu V] = \text{raw}_{ch} \times \frac{V_{ref}}{2^{23} \times G} \times 10^6$$

Di mana:
- $V_{ref} = 4.5\ \text{V}$ (internal reference ADS1299)
- $2^{23} = 8{,}388{,}608$ (resolusi 24-bit signed, half-scale)
- $G = 24$ (gain PGA, register CHnSET = 0x60)

Implementasi kode (`processor.go`, baris 98):
```go
const lsbToUV = 4.5 / (8388608.0 * 24) * 1e6
// = 4.5 / 201,326,592 * 1,000,000
// ≈ 0.02235 µV per LSB
```

Resolusi efektif: **~0.0224 µV/LSB**

**ADS1115 (single-channel, 16-bit, mode fallback):**
$$V[\mu V] = \text{raw}_{16} \times \frac{FSR}{2^{15}} \times 10^3$$

Di mana $FSR = 4.096\ \text{V}$ (GAIN_ONE), $2^{15} = 32{,}768$:
$$= \text{raw} \times \frac{4096\ \text{mV}}{32768} = \text{raw} \times 0.125\ \text{mV/LSB}$$

Implementasi (`processor.go`, baris 145):
```go
const lsbToUV = 4096.0 / 32768.0  // mV per LSB
uv := float64(raw) * lsbToUV
```

---

### 2. Sign Extension 24-bit → 32-bit (Firmware ESP32)

ADS1299 mengirim data sebagai 3 byte (MSB first, two's complement 24-bit). Sign extension:
$$\text{val}_{32} = \begin{cases} \text{raw}_{24} & \text{jika bit-23 = 0 (positif)} \\ \text{raw}_{24} \mid \texttt{0xFF000000} & \text{jika bit-23 = 1 (negatif)} \end{cases}$$

Implementasi (`sketch-capstone-1.ino`, baris 238–240):
```cpp
if (raw & 0x800000) raw |= 0xFF000000;
channels[i] = (int32_t)raw;
```

---

### 3. Pembangkit Gelombang Sinus Audio (I2S — PCM5102A)

Stimulus klik ABR menggunakan gelombang sinus pada frekuensi tertentu. Nilai sample ke-n:
$$s[n] = A \cdot \sin(\phi_n)$$

Di mana phase increment per sample:
$$\Delta\phi = \frac{2\pi f}{f_s}$$

Phase update setiap sample:
$$\phi_{n+1} = \phi_n + \Delta\phi \pmod{2\pi}$$

Parameter sistem:
- $f_s = 44{,}100\ \text{Hz}$ (sampling rate I2S)
- $A = 20{,}000$ (amplitude, signed 16-bit, range ±32767)
- Format output: I2S 16-bit stereo (L=R=s[n])

Implementasi (`sketch-capstone-1.ino`, baris 149–158):
```cpp
audioPhaseStep = (2.0f * PI * freqHz) / SAMPLE_RATE;
// Tiap frame:
int16_t s = (int16_t)(TICK_VOLUME * sinf(audioPhase));
audioPhase += audioPhaseStep;
if (audioPhase > 2.0f * PI) audioPhase -= 2.0f * PI;
```

---

### 4. Butterworth Bandpass Filter (IIR, 2nd-order)

Filter bandpass Butterworth orde-2 digunakan untuk mengekstrak sinyal ABR (100–3000 Hz). Implementasi menggunakan **Second-Order Sections (SOS)** agar numerik stabil.

**Transformasi pre-warp (bilinear):**
$$\omega_1 = 2 \tan\!\left(\frac{\pi f_{low}}{f_s}\right), \quad \omega_2 = 2 \tan\!\left(\frac{\pi f_{high}}{f_s}\right)$$
$$BW = \omega_2 - \omega_1, \quad \omega_0^2 = \omega_1 \cdot \omega_2$$

**LP prototype → BP transformation:**

Pole LP Butterworth orde-1: $p = \frac{-1+j}{\sqrt{2}}$

Mapping LP → BP:
$$s_{BP} = \frac{s^2 + \omega_0^2}{BW \cdot s} \Rightarrow \text{quadratic: } s^2 - BW \cdot p \cdot s + \omega_0^2 = 0$$

**Koefisien SOS (Direct Form II Transposed):**

Untuk setiap pole $p_k$ hasil BP:
$$a_0 = 4 + 2p_1 + p_0, \quad p_1 = -2\,\text{Re}(p_k), \quad p_0 = |p_k|^2$$

$$b = \left[\frac{2 \cdot BW}{a_0},\ 0,\ \frac{-2 \cdot BW}{a_0}\right]$$
$$a = \left[1,\ \frac{-8 + 2p_0}{a_0},\ \frac{4 - 2p_1 + p_0}{a_0}\right]$$

**Zero-phase filtering (filtfilt):**

Untuk menghilangkan fase shift (penting untuk latensi ABR akurat):
$$y_{forward} = H(z) \cdot x, \quad y_{out} = H(z) \cdot \text{reverse}(y_{forward}) \Rightarrow \text{reverse kembali}$$

Implementasi (`dsp/filter.go`, `ButterBP` + `FiltFilt`):
```go
w1 := 2.0 * math.Tan(math.Pi * lowHz / fsHz)
w2 := 2.0 * math.Tan(math.Pi * highHz / fsHz)
bw := w2 - w1
w0sq := w1 * w2
lpp := complex(-1.0/math.Sqrt2, 1.0/math.Sqrt2)  // LP prototype pole
```

**Guard kondisi:**
- $f_{high} \leq 0.95 \times \frac{f_s}{2}$ (jaga dari aliasing / nyquist)
- $f_{low} \geq 0.5\ \text{Hz}$
- Data minimal 12 sample (jika kurang: bypass filter)

---

### 5. Running Average ABR (Ensemble Averaging)

ABR diperoleh dengan rata-rata ensemble dari N epoch:
$$\bar{x}_{ch}[n] = \frac{1}{N} \sum_{k=1}^{N} x_{ch,k}[n]$$

Dalam implementasi digunakan **running update** (efisien secara memori, tidak simpan semua epoch):
$$\bar{x}[n]^{(N)} = \frac{(N-1) \cdot \bar{x}[n]^{(N-1)} + x_N[n]}{N}$$

SNR meningkat proporsional terhadap $\sqrt{N}$:
$$\text{SNR} \propto \sqrt{N}$$

Implementasi (`processor.go`, baris 228–232):
```go
for i := 0; i < epochSamples && i < len(last); i++ {
    p.abrAvg[ch][i] = (p.abrAvg[ch][i]*float64(n-1) + last[i]) / float64(n)
}
```

---

### 6. Signal-to-Noise Ratio (SNR) dalam dB

Pre-stimulus window (0–2 ms) digunakan sebagai estimasi noise, post-stimulus (2–epochMs ms) sebagai sinyal:

$$\text{RMS}_{noise} = \sqrt{\frac{1}{N_{pre}}\sum_{t_i < 2ms} x[i]^2}$$
$$\text{RMS}_{signal} = \sqrt{\frac{1}{N_{post}}\sum_{t_i \geq 2ms} x[i]^2}$$

$$\text{SNR}_{dB} = 20 \log_{10}\!\left(\frac{\text{RMS}_{signal} + \epsilon}{\text{RMS}_{noise} + \epsilon}\right), \quad \epsilon = 10^{-9}$$

Klasifikasi kualitas:
| SNR | Kualitas |
|-----|---------|
| > 10 dB | Baik |
| 5–10 dB | Cukup |
| < 5 dB  | Buruk  |

Implementasi (`analyze.go`, fungsi `ComputeSNR`).

---

### 7. Interpeak Intervals (IPI) ABR

IPI digunakan untuk mendeteksi kelainan pendengaran (neuropati auditori, dll.):

$$IPI_{I-III} = L_{III} - L_I, \quad IPI_{III-V} = L_V - L_{III}, \quad IPI_{I-V} = L_V - L_I$$

Nilai normal (ms):
| Pasangan | Normal |
|----------|--------|
| I–III    | 1.8–2.5 ms |
| III–V    | 1.8–2.5 ms |
| I–V      | 3.8–5.0 ms |

Implementasi (`analyze.go`, `InterpeakIntervals`).

---

### 8. Pearson Correlation (Konvergensi ABR)

Untuk menilai apakah ABR sudah konvergen, korelasi Pearson dihitung antar snapshot:

$$r = \frac{\sum_{i=1}^{n}(x_i - \bar{x})(y_i - \bar{y})}{\sqrt{\sum(x_i-\bar{x})^2 \cdot \sum(y_i-\bar{y})^2}}$$

Kriteria konvergen: $r \geq 0.9$

Implementasi (`dsp/filter.go`, fungsi `PearsonR`).

---

### 9. Epoch Extraction & Resampling

Epoch berdurasi $T_{epoch} = 50\ \text{ms}$ diekstrak dari ring buffer:
$$N_{epoch} = \left\lfloor f_s \times \frac{T_{epoch}}{1000} \right\rfloor$$

Untuk ADS1299: $N_{epoch} = \lfloor 500 \times 0.05 \rfloor = 25\ \text{sample}$

Ring buffer: $N_{buf} = f_s \times 3\ \text{detik}$ (misal: 500×3 = 1500 sample)

Jika jumlah sample dalam window < $N_{epoch}/2$, epoch dibuang (dikti tidak valid).

**Baseline correction** (koreksi DC offset menggunakan 1 ms pertama):
$$\text{base} = \frac{1}{N_{base}} \sum_{i=0}^{N_{base}-1} e[i], \quad N_{base} = \max\!\left(1,\ \lfloor f_s \times 0.001 \rfloor\right)$$
$$e'[i] = e[i] - \text{base}$$

---

## INSTRUKSI TUGAS (Yang harus Claude lakukan)

Kamu adalah asisten penulisan laporan Tugas Akhir Teknik. Tugas utamamu:

### A. Tulis BAB 4 — PEMODELAN PERMASALAHAN

Tulis bab 4 laporan yang komprehensif dengan sub-bab berikut:

**4.1 Pemodelan Sistem Secara Keseluruhan**
- Gambarkan model sistem ABR dari stimulus → akuisisi → pemrosesan → tampilan
- Jelaskan mengapa setiap komponen dipilih (ADS1299 untuk resolusi 24-bit biopotensial, PCM5102A untuk stimulus klik audio, ESP32 karena WiFi+SPI+I2S terintegrasi, Go karena konkurensi tinggi)
- Sertakan diagram blok tekstual alur data lengkap

**4.2 Pemodelan Hardware (Model Matematika)**
- Jelaskan model ADC dengan rumus konversi ADS1299 (rumus 1 di atas)
- Jelaskan sign extension 24-bit (rumus 2)
- Jelaskan model pembangkit stimulus sinus (rumus 3) dengan analisis frekuensi dan amplitudo
- Jelaskan mengapa ADS1115 digunakan sebagai fallback (860 SPS vs 250 SPS, 16-bit vs 24-bit trade-off)

**4.3 Pemodelan Pemrosesan Sinyal (DSP)**
- Jelaskan filter Butterworth bandpass 100–3000 Hz secara lengkap (rumus 4) dengan alasan pemilihan rentang frekuensi ABR secara medis
- Jelaskan zero-phase filtering (filtfilt) dan mengapa fasa adalah kritis untuk akurasi latensi gelombang ABR
- Jelaskan running average dan peningkatan SNR (rumus 5 dan 6)
- Jelaskan epoch extraction dengan baseline correction (rumus 9)

**4.4 Pemodelan Komunikasi Real-Time**
- Jelaskan protokol WebSocket (ESP32 → backend) dengan format JSON:
  ```json
  {"t": 1234567, "r": -1204, "s": 1}
  ```
  vs format ADS1299:
  ```json
  {"type":"eeg","device":"esp32-001","ts":123,"ch":[v1,..,v8]}
  ```
- Jelaskan Server-Sent Events (SSE) untuk streaming ABR hasil ke browser (polling 2 detik)
- Jelaskan SSE raw waveform (200 ms polling, window 500 ms default)

**4.5 Pemodelan Perangkat Lunak — Desain Arsitektur**
- Jelaskan arsitektur Hub WebSocket dengan mutex RWMutex (thread-safe multi-device)
- Jelaskan ring buffer circular 3 detik dan alasan pemilihan ukuran tersebut
- Jelaskan alur pemrosesan dari frame masuk → epoch extraction → running average → snapshot tiap 100 trial

**4.6 Kriteria Penilaian Klinis ABR**
- Tabel gelombang ABR I–V dengan rentang latensi dan amplitudo normal
- Tabel IPI (rumus 7) dan nilai normal
- Kriteria konvergensi (Pearson r ≥ 0.9, rumus 8)
- Klasifikasi kualitas SNR (rumus 6 tabel)

### B. Buat Flowchart Software (Tekstual — format ASCII atau Mermaid)

Buat **5 flowchart** berikut dalam format **Mermaid** (bisa di-render di mermaid.live):

**Flowchart 1: Firmware ESP32 — Boot Sequence & Main Loop**
```
START → Serial init → I2S setup → Beep test → BOOT button check 
→ connectSavedWiFi? → [Y] → Reinit I2S → setupADS1299 → WebSocket connect → LOOP
                    → [N] → startConfigPortal → Captive portal serving → [submitted] → ESP.restart()

LOOP: wsClient.loop() → audioService() → adsReadFrame()? → adsSendToWS() → playTick() tiap 2 detik
```

**Flowchart 2: ADS1299 Initialization Sequence**
```
SET pins → CLKSEL HIGH → PWDN cycle → RESET pulse → MISO self-test 
→ SPI bit-bang test (3 kecepatan) → Library SPI test (4 mode/freq kombinasi)
→ ID == 0x3E? → [Y] → Tulis CONFIG1/2/3 + CHnSET → DRDY interrupt attach → START+RDATAC → DONE
             → [N] → diagnosa (0xFF/0x00/other) → RETURN false
```

**Flowchart 3: Go Backend — WebSocket Frame Processing**
```
ReadMessage() → Parse compact JSON {t,r,s}? → [Y] → AddADS1115Frame() → record stats
                                             → [N] → Parse envelope.Type
                                                     → "eeg"  → AddFrameFromJSON()
                                                     → "stim" → LogStimulus() → stim_ack
                                                     → other  → ack JSON
```

**Flowchart 4: ABR Processor — Epoch Extraction**
```
tryExtractEpochs(now) → FOR each stimLog[idx]
  → processed? → SKIP
  → stimT before window? → SKIP
  → stimEnd after now? → SKIP (epoch belum selesai)
  → Kumpulkan samples [stimT, stimEnd] dari ring buffer
  → len < epochSamples/2? → SKIP (data tidak cukup)
  → ResampleLinear → SafeBandpass → Baseline correction
  → Append ke epochs[ch]
  → Running average update
  → n % 100 == 0? → Simpan Snapshot
  → processedStim[idx] = true
```

**Flowchart 5: Frontend — SSE Streaming & Chart Update**
```
startABRStream() → EventSource /api/v1/abr/stream
  → onmessage → abrStreaming? → [Y] → updateABRCharts(data)
                                       → nSamples berubah? → rebuildCharts
                                       → update Chart.js data → chart.update('none')
                             → [N] → drop frame

startRawStream() → EventSource /api/v1/raw/stream (200ms)
  → onmessage → rawStreaming? → [Y] → updateRawCharts(data)
```

---

## FORMAT OUTPUT YANG DIHARAPKAN

1. **Teks bab 4** dalam format narasi akademis bahasa Indonesia (formal, gaya jurnal teknik)
2. **Setiap rumus** disertai:
   - Definisi setiap variabel/simbol
   - Satuan
   - Referensi ke kode implementasi (file + baris)
   - Justifikasi teknis pemilihan nilai parameter
3. **Flowchart** dalam format Mermaid (```mermaid ... ```) yang valid
4. **Tabel** untuk nilai normal ABR, IPI, SNR, dan parameter konfigurasi
5. Panjang minimal: **2000 kata** untuk bagian teks narasi

---

## CATATAN PENTING

- Sistem ini adalah **prototipe penelitian** (bukan produk medis komersial)
- ADS1299 belum berhasil membaca sinyal EEG nyata (masalah hardware belum terselesaikan), sehingga sistem saat ini berjalan dalam mode **ADS1115 fallback**
- Frekuensi sampling ADS1115 = 860 SPS, epoch = 50 ms = 43 sample
- Stimulus klik diputar via PCM5102A pada 1000 Hz / 100 ms (mode uji) atau frekuensi yang dapat dikonfigurasi via `/api/v1/stim/set`
- Backend berjalan di port 8080, dikembangkan dengan Go + Fiber framework
- Semua operasi ring buffer dan ABR averaging thread-safe menggunakan `sync.RWMutex`

Mulai tulis sekarang, dimulai dari sub-bab 4.1.
