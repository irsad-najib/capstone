# Next tasks (per 31 Okt 2026)

Konteks: firmware `esp-ads1256/` (ADS1256 15 kSPS + 2× AD620), backend `neurosound-backend/`, server `capstone.irsad.site`.

## Status sekarang

| Bagian | Status |
|---|---|
| ADS1256 + AD620 (ID 3, DRDY 14.9 kHz, A0 ≈ 1.5 V, A1/A3 = GND, CH1/CH2 lolos `ads check`) | OK (dari USB laptop; dari baterai ADS juga normal) |
| Stream ESP → server | 11.500 sampel/s rata-rata lewat `ws://` + Cloudflare, 0 putus selama 90 s. Sisa ±20 % sampel terbuang saat hotspot tersendat |
| Backend (commit `0304f94`, sudah di server) | artifact rejection, r split-half, SNR ± average, deteksi III/I relatif V, Pass = Konvergen + V. Verdict server 6/8 benar (lama 3/8), positif palsu 0 |
| Excel validasi | `~/Downloads/NeuroSound_Validasi_DSP.xlsx`, `NeuroSound_Validasi_DSP_Sebelum_Sesudah.xlsx`, `NeuroSound_TesA_tanpa_sinyal.xlsx` |
| Firmware terbaru | **belum di-commit** (lihat tugas 1) |

## Tugas

### 1. Commit dan push firmware (siap, tinggal izin)
Perubahan lokal belum ter-push: `esp-ads1256/` (`ws://`, TCP_NODELAY, buffer TCP 16 KB, MSS 1200, tcpip + WS task di core 0, paket v3 sudah ter-push, perintah `full` / `ads dump` / `net bench`, log penyebab reset, antrian 12 paket, isi sampel terlewat) dan `.gitignore`.
- Password hotspot sudah dipindah ke `src/wifi_default.h` (di-gitignore). Contoh: `src/wifi_default.example.h`.
- Cek dulu: `ADS_SKIP_ID_CHECK` di `ads1256.h` masih `1`. ADS sudah terdeteksi normal, ganti ke `0`.
- Keputusan: `ws://` berarti data ESP → Cloudflare tidak terenkripsi. Cukup untuk uji; bahas ulang sebelum dipakai ke pasien.

### 2. Daya ESP dari baterai (belum bisa konek)
Dari USB jalan, dari baterai ESP tidak konek WiFi dan AP `ESP32-Setup` pun tidak muncul. Aturan: **jangan colok USB dan baterai bersamaan** pada DevKitC.
- Lihat memory `ad620-module-power`: modul AD620 XY-FD wajib 6–11 V; dari rail 5V ESP, V− ambruk dan ADS1256 baca kacau.
- Cek: LED ESP, tegangan 5V dan 3V3 saat WiFi mengirim (multimeter tidak menangkap lonjakan ms). Tambah 470–1000 µF di 5V–GND dekat ESP, buck ≥ 1 A, naikkan ke 5.1–5.2 V.
- Firmware sudah mencatat `penyebab reset` (BROWNOUT / POWERON / WDT / PANIC) ke `/api/v1/logs` begitu ESP sempat konek.
- Satu reset `PANIC` pernah terlihat (08:14 UTC); belum sempat ditangkap backtrace-nya.

### 3. Tes B: loopback (bukti alat + DSP)
Tujuan: bukti latensi, amplitudo, dan polaritas dari alat asli, plus offset waktu sistem (isi baris `[ukur]` di tabel slide).
- Ujung jack audio kiri → S+ AD620 #1, GND jack → S− AD620 #1 (lepas sambungan S− lama). Earphone dicabut.
- Rekam klik dengan `record.py`-style (reset → `c L;db 50;on` → ±500 epoch), bandingkan puncak dengan hitungan: waktu (0–1 ms) dan tinggi.
- Buat grafik dan Excel dengan format yang sama seperti Tes A.

### 4. Noise hardware
Input dihubung-singkat masih ±150 µVrms terfilter di elektroda (target ≤ 5–10 µVrms; ABR asli 0.1–0.5 µV). Ada riak ±750 Hz dan lonjakan ±4 mV.
- Sambungkan REF AD620 ke A1/A3 sebagai pengganti GND (CH1 ≈ 0 V), bypass 100 nF + 10 µF di VCC–GND tiap modul AD620, sambungan breadboard dikencangkan.
- Gunakan `ads dump` untuk frekuensi dominan (50 Hz = dengung, kHz = osilasi/ripple ICL7660).
- `ads check` langkah 7 masih menulis "DI LUAR RENTANG" untuk CH1 ≈ 0 V atau 1.5 V (kriteria mengira A1 = GND). Ubah kriterianya.

### 5. Lonjakan salah-baca ADC
Sampel `0xFFFFFF` sudah ditahan (sampel sebelumnya), tapi `0x7FFFFF` / `0x800000` (±250 mV) masih lolos ±2×/detik. Tahan juga nilai itu di `ads_task`. Backend sudah membuang epoch berlonjak (field `rejected`), jadi ini hanya mengurangi kehilangan epoch.

### 6. Backend / validasi lanjutan
- 30 dB dan 50 dB masih Refer (negatif palsu; respons 0.11–0.15 µV). Opsi: tambah jumlah epoch di level rendah, atau turunkan `ConvergeR` (sekarang 0.4, ±2 % positif palsu pada noise).
- Aturan I/III: `bandIIIToV` dan `bandIToV` mengandalkan interpeak normal dewasa; periksa untuk bayi/pasien dengan konduksi memanjang.
- Ulangi validasi setelah perubahan: `validate_dsp.py` (semua rekaman dummy server) lalu bandingkan dengan Excel sebelum/sesudah.
- Pertimbangkan penyimpanan hasil validasi di repo (folder `docs/` atau `tests/`) supaya bisa direproduksi. Skrip dan data ada di scratchpad sesi ini dan tidak ikut repo.

### 7. Frontend / alur uji
- `Start test` sudah otomatis: kanan lalu kiri, level 80 → 60 → 40 dB, auto-save setelah trial ≥ target dan 5 detik settle. Tampilkan peringatan jika `ads:false` di `/api/v1/devices`.
- Backend memvalidasi byte kanal paket (off 18) terhadap telinga yang dites (belum).
- Kalibrasi level: `DB_AT_0DBFS = 90` belum terkalibrasi. Selisih kiri-kanan driver ukuran lapangan 3–5.5 dB; firmware sekarang kiri −5.5 dB (`cal L <dB>` untuk menyetel). Ukur ulang dengan tone kontinu 1 kHz, posisi mic sama.
- Admin: slider kecepatan dummy 1–20× sudah ada; data ESP diabaikan selama dummy jalan.

### 8. Dokumen
- Isi tabel "Evaluasi & Hasil" di slide (sampling rate 15.000 SPS, bukan 16.000; label "ADS1115 @ 860 SPS" → "ADS1256 @ 15.000 SPS"). Angka yang sudah ada: LSB 0.030 µV di elektroda, filter 100–3000 Hz, epoch 60 ms, laju stimulus 11.1/s. Yang masih `[ukur]`: latensi transmisi, noise setelah averaging, konvergensi, latensi V, interpeak, durasi baterai.
- Perbarui `CLAUDE.md` bila ada perubahan layout.

## Catatan teknis

- **Montase:** Cz → S+ kedua modul AD620, A1 → S− modul 1 (CH1, kiri), A2 → S− modul 2 (CH2, kanan), Fpz → GND bersama. Satu kanal direkam per sesi (`c L` → CH1, `c R` → CH2). Hanya baterai saat elektroda terpasang.
- **Perintah ESP berguna:** `full`, `ads check|scan|dump|ch 1|2`, `net`, `net bench`, `bat`, `debug on`, `cal`, `c L|R|B`, `db <dB>`, `on|off`, `tone`/`abr`.
- **Perintah remote:** `POST /api/v1/command?token=…` body `{"device":"esp32-audio-001","cmd":"ads"}`; log di `/api/v1/logs?token=…`. Membuka serial me-reset ESP (DTR/RTS); pakai backend bila ESP sedang merekam.
- **ESP32 hanya 2,4 GHz.** Hotspot iPhone: aktifkan "Maximize Compatibility".
- **Dua ESP memakai ID sama** (`esp32-audio-001`). Jangan nyalakan bersamaan, atau ubah `NET_DEVICE_ID` di `net.h`.
- **Flash sering gagal sekali** (`The chip stopped responding`); ulangi `pio run -t upload`.
- **Token log** `LOG_TOKEN` jangan di-commit.
