# Kalau ADS1299 diganti ADS1256: apa saja yang berubah

Ringkasnya: **bukan sekadar ganti chip.** ADS1256 adalah ADC presisi umum, bukan front-end
biopotensial. Board 1, firmware `esp/src/ads1299.c`, dan beberapa konstanta backend semuanya
harus disesuaikan. Hal yang tetap sama: ESP32 Board 2, audio/stimulus, WiFi, WSS, baterai,
dan format paket biner (kalau mau dipertahankan).

> Angka di bawah dari ingatan datasheet ADS1256 (SBAS288) dan ADS1299 (SBAS499).
> Cocokkan lagi dengan datasheet sebelum dipakai untuk desain PCB atau laporan.

## 1. Perbedaan chip yang berpengaruh

| Hal | ADS1299 (sekarang) | ADS1256 | Akibatnya |
|---|---|---|---|
| Arsitektur | 1 ADC per kanal, semua kanal **serentak** | **1 ADC** + multiplexer 8 input (4 diferensial) | CH1 dan CH2 tidak bisa diambil bersamaan |
| Laju maks | 16 kSPS semua kanal | 30 kSPS untuk 1 kanal; ±4,4 kSPS total kalau mux berpindah tiap sampel (±2,2 kSPS per kanal untuk 2 kanal) | 2 kanal sekaligus terlalu lambat untuk ABR → **1 kanal per pengukuran** |
| Laju yang tersedia | 16000, 8000, … | 30000, 15000, 7500, 3750, 2000, 1000, … (tidak ada 16000) | `Fs` backend harus ikut berubah |
| Gain | PGA 1–24 | PGA 1–64 | sinyal ABR (< 1 µV) tetap butuh penguat instrumentasi di depan (lihat bagian 2) |
| Impedansi input | sangat tinggi (front-end EEG) | buffer OFF: turun ke orde kΩ di PGA tinggi; buffer ON: tinggi, tapi rentang input jadi AGND … AVDD−2 V | elektroda **tidak boleh langsung** ke ADS1256 |
| Referensi | internal 4,5 V | **eksternal** (umumnya 2,5 V) di VREFP/VREFN | perlu IC referensi (sudah ada di modul jadi) |
| Clock | internal 2,048 MHz | **kristal 7,68 MHz eksternal** | perlu kristal (sudah ada di modul jadi) |
| BIAS / right-leg drive | ada (BIASOUT) | **tidak ada** | buat sendiri: elektroda referensi ke mid-supply |
| Sinyal uji internal | ada (`ads test on`) | tidak ada | `ads_test_signal()` harus diganti, misal input dihubung-singkat lewat MUX |
| Lead-off, SRB | ada | tidak ada | fitur terkait dihapus |
| Kaki kontrol | START, RESET, PWDN, DRDY, CS | SYNC/PDWN (satu kaki), RESET, DRDY, CS (tanpa START) | lihat tabel pin |
| Kemasan | TQFP-64 | SSOP-28 | **footprint Board 1 tidak bisa dipakai** |
| Supply | AVDD 5 V, DVDD 3,3 V | AVDD 5 V, DVDD 1,8–3,6 V | rel daya Board 3/Board 2 tetap cocok |

## 2. Perangkat keras

### Pilihan realistis (deadline dekat): modul ADS1256 jadi + AD620

Modul ADS1256 yang banyak dijual (biru / Waveshare) sudah berisi kristal 7,68 MHz,
referensi 2,5 V, dan regulator. Jadi yang perlu disiapkan:

```
Elektroda Cz ─┐                                        ┌─────────────┐
              ├─ AD620 (gain ±100–1000) ── OUT ───────► AIN0         │
Elektroda A1 ─┘      REF = 2,5 V ───────────────────► AIN1 (AINCOM) │ ADS1256
                                                       │  modul      │── SPI ─► ESP32
Elektroda ground/ref ── ke 2,5 V lewat resistor        └─────────────┘
```

- **AD620 harus disuplai ≥ 5 V tunggal** (minimal ±2,3 V). Rig lama di `archive/ads1115/WIRING.md`
  memakai 3,3 V, itu di luar spesifikasi AD620; pindahkan ke 5 V dari Board 3.
- REF AD620 dan elektroda ground ke **2,5 V** (tengah 0–5 V) supaya keluaran AD620 bisa naik-turun.
  Pembagi 2 × 10 kΩ + buffer op-amp, atau langsung pakai VREF 2,5 V modul (jangan dibebani berat).
- Karena keluaran AD620 berimpedansi rendah, **buffer ADS1256 boleh OFF** dan rentang input 0–5 V penuh.
- Gain total: AD620 gain G × PGA ADS1256. Mulai dari G ≈ 100 dan PGA 8–16; naikkan selama
  `ads` tidak saturasi. Jangan langsung G = 1000 + PGA 64: offset elektroda (puluhan mV) akan membuat rel penuh.
- Untuk kanal kedua (Cz-A2) cukup **satu AD620 lagi ke AIN2/AIN3**. ABR diukur satu telinga per sesi
  (stimulus kiri → Cz-A1, kanan → Cz-A2), jadi firmware cukup memindah MUX di antara sesi.

### Pilihan jangka panjang: Board 1 baru

Footprint, routing, kristal, referensi, AD620/INA, dan proteksi input harus didesain ulang.
Tidak masuk akal untuk 3 hari.

### Sambungan ke Board 2 (pin ESP tetap sama)

| ESP32 | Dulu (ADS1299) | Sekarang (ADS1256) |
|---|---|---|
| IO23 MOSI | DIN | DIN |
| IO19 MISO | DOUT | DOUT |
| IO18 SCLK | SCLK | SCLK |
| IO21 CS_N | CS | CS |
| IO34 DRDY | DRDY | DRDY |
| IO26 RESET_N | RESET | RESET (kalau modul mengeluarkan kakinya; kalau tidak, pakai perintah RESET 0xFE) |
| IO27 PWDN_N | PWDN | SYNC/PDWN |
| IO25 START | START | **tidak dipakai** (ADS1256 tidak punya START) |
| 5 V / GND | POWER header | 5 V dan GND modul; DVDD modul 3,3 V supaya level logika cocok dengan ESP32 |

Aturan aman tetap: USB laptop dan Board 3 tidak bersamaan, elektroda tidak di kepala orang saat USB tercolok.

## 3. Firmware (`esp/src/`)

Paling rapi: buat `ads1256.c` baru dengan **antarmuka yang sama** seperti `ads1299.h`
(`ads_init`, `ads_start`, `ads_stop`, `ads_poll`, `ads_check`, …), lalu di `CMakeLists.txt`
ganti `ads1299.c` dengan `ads1256.c`. `main.c` dan `net.c` hampir tidak perlu disentuh.

### Yang bisa dipakai ulang dari `ads1299.c`

- CS manual (`gpio_set_level(PIN_CS, …)`), jadi jeda antar-byte gampang disisipkan.
- ISR DRDY di core 1 (`isr_install_task`), task akuisisi, pool paket `free_q`/`full_q`, `send_task`,
  `flush_pkt`, penandaan onset `ads_mark_stim_isr`, ringkasan `ads_poll`.
- `ads_drdy_test`, `ads_scope`, `ads_pwdn_cycle` (ganti kaki START/PWDN sesuai tabel di atas).

### Yang harus diganti

| Bagian | ADS1299 | ADS1256 |
|---|---|---|
| Kode perintah | WAKEUP 0x02, RESET 0x06, START 0x08, STOP 0x0A, RDATAC 0x10, SDATAC 0x11, RDATA 0x12, RREG 0x20, WREG 0x40 | WAKEUP 0x00, RDATA 0x01, RDATAC 0x03, SDATAC 0x0F, RREG 0x10, WREG 0x50, SELFCAL 0xF0, SYNC 0xFC, STANDBY 0xFD, RESET 0xFE |
| Register | ID, CONFIG1–3, CHnSET, BIAS_SENS, MISC1 | STATUS 0x00, MUX 0x01, ADCON 0x02, DRATE 0x03, IO 0x04 |
| Deteksi chip | `id_valid()` cek ID 0x3C (ADS1299-4) | STATUS bit 7:4 = **0x3** |
| `write_config()` | CONFIG1 16 kSPS, CHSET gain 24, BIAS | STATUS: ACAL=1, BUFEN=0; MUX = 0x01 (AIN0−AIN1); ADCON = PGA; DRATE = 0xE0 (15 kSPS) atau 0xF0 (30 kSPS); lalu **SELFCAL** dan tunggu DRDY turun |
| Clock SPI | `SPI_SLOW_HZ` 1 MHz, `SPI_FAST_HZ` 4 MHz | SCLK maks = fCLKIN/4 ≈ **1,92 MHz** → set keduanya ≤ 1,9 MHz (mode SPI tetap 1) |
| Jeda wajib | 4 tCLK antar byte | setelah RREG/RDATA tunggu t6 = 50 τCLKIN ≈ **6,5 µs** sebelum membaca; setelah SYNC ≈ 3,2 µs sebelum WAKEUP |
| Baca data | frame 15 byte (3 status + 3 × kanal) | **3 byte** per DRDY (RDATAC), tanpa byte status; `s_frame = 3`, `FRAME_MAX` = 3 |
| Mulai akuisisi | kaki START naik + RDATAC | SYNC + WAKEUP + RDATAC; DRDY langsung jalan terus selama tidak STANDBY |
| `s_nch`, `set_nch()` | dari ID (4/6/8) | hapus; 1 kanal aktif, pilih lewat MUX |
| `ads_test_signal()` | CHSET_TEST | tidak ada sinyal uji: ganti dengan MUX AIN0−AIN0 (input pendek, cek noise) atau biarkan sebagai "tidak didukung" |
| `ads_check()` | 7 langkah ADS1299 | sesuaikan: ID dari STATUS, register tulis-baca MUX/ADCON/DRATE, laju DRDY ≈ DRATE, cek noise input pendek |
| `POWERUP_MS` / VCAP1 | 1000 ms untuk VCAP1 | tunggu ±30 ms + osilator kristal stabil, lalu SELFCAL |
| `ADS_SPS`, `ADS_GAIN` | 16000 / 24 | misal 15000 / PGA yang dipilih |

### Format paket ke backend

Paling sedikit perubahan: **format tetap 7 byte per sampel**. Isi CH1 dengan sampel kanal aktif,
CH2 diisi 0 (atau kanal aktif sesi berikutnya). Flag onset tetap bit0. Header tetap.

Perintah baru yang berguna di `main.c`: `ads ch 1` / `ads ch 2` untuk memilih MUX (Cz-A1 / Cz-A2),
dan `ads pga <n>`.

## 4. Backend (`neurosound-backend/`)

| File | Sekarang | Harus jadi |
|---|---|---|
| `internal/ws/handler.go:62` `binFs` | 16000 | laju ADS1256 (15000 / 30000). Lebih bersih: naikkan `binVersion` ke 2 dan tambah u16 Fs di header (header 16 byte sekarang sudah penuh, jadi 18 byte) |
| `internal/processor/processor.go:16` `Fs` | 16000 | sama dengan di atas |
| `processor.go` `preSamples` 160, `postSamples` 800 | dihitung untuk 16 kHz (10 ms / 50 ms) | hitung dari `Fs`: `PreStimMs*Fs/1000` dan `(EpochMs-PreStimMs)*Fs/1000` |
| `processor.go:90` konversi µV | `raw × 2·4,5 / 2²⁴ / 24` (VREF 4,5 V, gain 24) | `raw × 4·VREF / 2²⁴ / PGA / G_AD620` (VREF 2,5 V, rentang ±2·VREF/PGA) |
| analisis wave V | memakai CH1 dan CH2 | kalau CH2 = 0, perbandingan kiri/kanan diambil dari **dua sesi** berbeda, bukan dua kanal satu sesi |
| test (`analysis_test.go`, `processor_test.go`, `handler_test.go`) | asumsi 16 kHz | sesuaikan nilai Fs dan timestamp |

Di dashboard/frontend: label "ADS1299" dan laju 16 kSPS diganti.

## 5. Dampak ke hasil dan laporan

- **Tidak serentak**: kanal kiri dan kanan tidak lagi direkam bersamaan. Untuk ABR ini tidak
  masalah karena stimulus diberikan per telinga, tapi tulis di laporan.
- **Noise**: rantai AD620 + ADS1256 lebih ber-noise dibanding front-end ADS1299 yang khusus EEG.
  Wave V butuh lebih banyak rata-rata (trial). Uji dulu: input AD620 dihubung-singkat, lihat noise di log.
- **Keamanan subjek**: ADS1299 di Board 1 punya resistor seri di input. Rangkaian AD620 baru juga
  harus punya resistor seri (±10 kΩ) di tiap elektroda, dan tetap hanya dijalankan dari baterai.
- Debugging ADS1299 (VCAP1 0,7–1,0 V, DRDY selalu LOW, ID 0xFF meski supply dan board sehat)
  layak ditulis sebagai alasan penggantian.

## 6. Urutan kerja kalau jadi ganti

1. Dapatkan modul ADS1256 + AD620 (atau INA128), cek modul sendirian: 5 V, 3,3 V, kristal.
2. Sambung modul ke Board 2 sesuai tabel pin (power OFF).
3. Firmware `ads1256.c`: deteksi STATUS ID → tulis/baca register → laju DRDY → baca data input pendek.
4. Backend: Fs, pre/post samples, konversi µV.
5. Rangkai AD620, uji dengan sinyal kecil dari generator / pembagi tegangan, baru ke elektroda.
