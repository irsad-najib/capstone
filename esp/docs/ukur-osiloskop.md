# Pengukuran firmware esp pakai osiloskop

Tujuan: membuktikan rantai audio linier, kiri = kanan, tahu level mulai clipping,
dan burst sama tingginya dengan tone kontinu (Fase 1–2 panduan Youlean, versi tegangan).
Isi tabel di bawah, lalu kirim balik ke Claude.

Firmware: `esp/` commit terbaru (ada perintah `b` dan `remote`). Cek dulu: `i2s` → ±48000 frame/s, error 0.

## Persiapan osiloskop (langkah pemula)

Alat: **Texio DCS-1102B** (2 ch, 100 MHz, 1 GS/s, 1 mV/div – 10 V/div, Average 2–256).
Seri ini sama dengan GW Instek GDS-1000B, jadi nama tombolnya mengikuti seri itu. Kalau ada yang beda di
alatmu, foto panelnya.

Cara pakai menu: tekan tombol di panel → menu muncul di **bawah layar** (dipilih dengan tombol di bawah layar)
dan/atau di **kanan layar** (dipilih dengan tombol di kanan layar). Nilai diubah dengan knob **VARIABLE**,
dikonfirmasi dengan tombol **Select**.

### A. Kenalan dengan bagian depan

| Bagian                                            | Fungsi                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Colokan BNC **CH1**                               | Tempat probe. Pakai CH1 saja untuk semua uji                                                                 |
| Knob **Volts/div** (VERTICAL, besar)              | Tinggi tampilan: berapa volt per kotak vertikal                                                              |
| Knob **Position** (VERTICAL, kecil)               | Geser gelombang naik/turun                                                                                   |
| Knob **Time/div** (HORIZONTAL, besar)             | Lebar tampilan: berapa waktu per kotak horizontal                                                            |
| Knob **LEVEL** (TRIGGER)                          | Garis batas supaya gelombang diam, tidak lari-lari. Tombol **50%** di dekatnya menaruhnya otomatis di tengah |
| Tombol **Menu** (TRIGGER)                         | Setelan trigger: tipe, sumber, slope, mode Auto/Normal                                                       |
| **Autoset**                                       | Atur otomatis. Paling gampang untuk tone kontinu                                                             |
| **Default**                                       | Kembalikan semua setelan pabrik, kalau tampilan sudah kacau                                                  |
| **Run/Stop**                                      | Bekukan / jalankan lagi tampilan                                                                             |
| **Single**                                        | Tangkap satu kejadian saja (untuk burst)                                                                     |
| **Measure**                                       | Tampilkan angka Vpp, Vrms, frekuensi                                                                         |
| **Cursor**                                        | Garis ukur manual. Tekan sekali = cursor waktu, tekan lagi = cursor tegangan                                 |
| **Acquire**                                       | Mode Normal / Average (rata-rata, untuk sinyal kecil)                                                        |
| **Hardcopy**                                      | Simpan screenshot ke flashdisk di port USB depan                                                             |
| Terminal **Probe Comp** (logam kecil, ~5 V 1 kHz) | Sinyal kotak untuk mengecek probe                                                                            |

### B. Pasang dan cek probe (sekali di awal)

1. Di badan probe ada saklar **x1 / x10** → geser ke **x10**.
2. Colok BNC probe ke **CH1**, putar seperempat putaran sampai terkunci.
3. Tekan tombol **CH1** (kuning) → di menu bawah pilih **Probe** → **Voltage**, putar VARIABLE ke **10X**.
   Lalu **Coupling = DC** (untuk tes ini dulu).
4. Jepit **ujung probe** ke terminal Probe Comp, **jepit buaya (ground)** ke terminal ground di sebelahnya.
5. Tekan **AutoSet**. Harus muncul gelombang **kotak** sekitar 5 Vpp, 1 kHz.
6. Kalau sudut kotaknya melengkung atau ada tonjolan runcing, putar sekrup kecil di probe (kompensasi)
   pakai obeng plastik sampai sudutnya siku. Kalau sudah siku, lanjut.

### C. Setelan untuk mengukur audio

1. Tekan **CH1** → **Coupling = AC** (membuang tegangan DC, hanya sinyal audio yang tampil).
2. Tekan **Measure** → **Select Measurement** → putar VARIABLE, pilih **Pk-Pk** → Select. Ulangi untuk **RMS**
   dan **Frequency**. Sumbernya **CH1**. Angkanya tampil di bawah layar. (Di alat ini "Vpp" namanya **Pk-Pk**.)
3. Tekan **Menu** di bagian TRIGGER → **Type = Edge**, **Source = CH1**, **Slope = naik (↗)**, **Mode = Auto**.
4. **Jepit buaya ground selalu ke GND board** (kaki GND TDA1308 / ground jack). Ujung probe yang pindah-pindah titik.
   Jangan pernah jepit ground ke titik sinyal.

### D. Cara membaca satu titik (dipakai di semua uji)

1. Nyalakan tone dari ESP (mis. `f 1000`, `l 0`, `on`).
2. Tempelkan ujung probe ke titik ukur.
3. Tekan **AutoSet**. Harus muncul sinus.
4. Kalau gelombang lari-lari: tekan **50%** di bagian TRIGGER, atau putar knob **LEVEL** sampai garisnya di tengah
   gelombang. Gelombang akan diam.
5. Atur supaya rapi: **Volts/div** sampai sinus mengisi ±6 kotak vertikal (tidak keluar layar);
   **Time/div** ke **500 µs** supaya terlihat beberapa siklus.
6. Baca angka **Vpp** dan **Vrms** di bawah layar, catat di tabel.
7. Kalau sinyal sangat kecil (angka loncat-loncat, gelombang "berbulu"): **Acquire → Average**, putar VARIABLE ke **16**
   (atau 64).
   Tunggu beberapa detik sampai angka stabil. Kembalikan ke **Normal** setelah selesai.

Kalau Vpp tampil tapi frekuensi bukan 1000/2000 Hz, atau tertulis "?", gelombangnya keluar layar / terlalu kecil →
atur Volts/div lagi.

### E. Cara menangkap burst (Uji 4)

1. **Menu** (TRIGGER) → **Mode = Normal** (bukan Auto). Di mode Normal layar hanya diperbarui saat ada burst.
2. **Time/div = 500 µs**. Burst 2-1-2 di 2 kHz panjangnya 2,5 ms = 5 kotak.
3. Putar knob **LEVEL** ke sekitar sepertiga tinggi burst (sedikit di atas garis nol).
4. Geser posisi horizontal supaya burst ada di tengah layar.
5. Tekan **Run/Stop** untuk membekukan, lalu tekan **Cursor** sampai muncul cursor **tegangan** (garis horizontal).
   Putar VARIABLE untuk menggeser cursor 1 ke puncak atas bagian datar, tekan **Select** untuk pindah ke cursor 2,
   geser ke puncak bawah → angka Δ di layar = Vpp burst.
   (Angka Vpp otomatis kadang ikut menghitung noise, jadi cursor lebih bisa dipercaya.)
6. Untuk burst 2 detik (`b 2000`): pakai **Single**, ketik `b 2000` di ESP, layar menangkap sekali.
   Time/div boleh dibiarkan 500 µs, yang dilihat bagian datarnya.

Foto layar: colok flashdisk ke USB depan, tekan **Hardcopy**. Kalau yang tersimpan bukan gambar, cek
**Utility → Hardcopy → Save Image**. Foto pakai HP juga boleh.

### F. Bonus: cek distorsi pakai FFT (opsional, Uji 3)

**Math → FFT**, sumber CH1, Vertical = **dBV RMS**, Window = **Hanning**. Tone 2 kHz bersih = satu tiang tinggi di
2 kHz. Kalau mulai clipping, muncul tiang di 4 kHz, 6 kHz, dst. yang makin tinggi. Catat selisih tinggi tiang
2 kHz vs 6 kHz di level yang dipakai.

Driver/headphone **tetap terpasang** (beban asli), tapi **jauh dari telinga**: di 0 dBFS suaranya bisa >100 dB.
Trimpot RV1/RV3 jangan diputar selama pengukuran. Kalau terpaksa diputar, ulangi dari awal.

## Titik ukur

| Titik | Lokasi                                                 | Nilai teori di 0 dBFS   |
| ----- | ------------------------------------------------------ | ----------------------- |
| TP1   | Output PCM5102A (OUTL / OUTR modul GY-PCM5102)         | 2,97 Vp = 5,94 Vpp      |
| TP2   | Titik pembagi: R1/R4 22k ke (R2/R5 330 Ω ∥ trimpot 1 kΩ) | 5,94 × 0,01115 ≈ 66 mVpp (23,4 mVrms) |
| TP3   | Output TDA1308 / pin jack PJ-320 (driver terpasang)    | belum diketahui, diukur |

Rumus teori: `Vpp(l) = Vpp(0 dBFS) × 10^(l/20)` → tiap −10 dBFS tegangan ÷ 3,16, tiap −20 dBFS ÷ 10.

---

## Uji 1 — Rantai penguatan (1 kHz, channel L)

Ketik: `f 1000`, `c L`, `l 0`, `on`

| Titik | Vpp terukur | Vrms terukur | Bentuk (bersih / terpotong) |
| ----- | ----------- | ------------ | --------------------------- |
| TP1   | 6           | 2,08         | bersih (teori 5,94 / 2,1)  |
| TP2   |             |              |                             |
| TP3   |             |              |                             |

Kalau TP3 sudah terpotong (puncak datar) di 0 dBFS, turunkan `l` per 1 dB sampai bersih lagi → itu Uji 3.

## Uji 2 — Linieritas di TP3 (2 kHz)

Ketik: `f 2000`, `c L`, `on`, lalu tiap baris `l <angka>`. Tunggu 2–3 detik, baca Vpp.
Pakai Average untuk level kecil. Ulangi untuk R (`c R`).

| dBFS | Vpp L | Vpp R | Rasio ke baris atas (L) | Catatan |
| ---- | ----- | ----- | ----------------------- | ------- |
| 0    |       |       | –                       |         |
| −10  |       |       |                         |         |
| −20  |       |       |                         |         |
| −30  |       |       |                         |         |
| −40  |       |       |                         |         |
| −50  |       |       |                         |         |
| −60  |       |       |                         |         |
| −70  |       |       |                         |         |
| −80  |       |       |                         |         |

Lulus: rasio ≈ 3,16 (±0,4) per baris. Selisih L–R `20·log10(VppL/VppR)` ≤ 1 dB.
Di level sangat kecil angka mulai mendatar karena noise osiloskop → catat dari level berapa.

Noise lantai (ketik `off`, ukur Vpp/Vrms di TP3): **\_\_\_\_**

## Uji 3 — Level clipping

Di TP3, 2 kHz, channel L: naikkan `l` dari −20 per 1–2 dB (`+`) sampai puncak sinus mulai rata.

| Item                       | Nilai         |
| -------------------------- | ------------- |
| Level mulai clipping (L)   | **\_\_** dBFS |
| Level mulai clipping (R)   | **\_\_** dBFS |
| Vpp tepat sebelum clipping | **\_\_**      |
| Tegangan supply TDA1308    | **\_\_** V    |

## Uji 4 — Burst vs tone kontinu (2 kHz)

Burst dari firmware: naik 2 siklus (1 ms), datar sesuai `ms`, turun 2 siklus. Tanpa ramp gain.

1. `f 2000`, `c L`, `l -20`, `on` → catat Vpp kontinu di TP3.
2. `b 0.5 10` → burst 2-1-2 (total 2,5 ms) 10× per detik. Trigger **Normal**, edge naik, level ±30% puncak, time/div 500 µs.
   Ukur Vpp bagian datar (pakai cursor kalau Measure ikut menghitung bagian naik/turun).
3. `b 2000` → burst 2 detik sekali; Vpp bagian datar harus sama dengan langkah 1.
4. `off` untuk berhenti. Ulangi di `l -40`.

| Level | Vpp kontinu | Vpp datar burst 0,5 ms | Vpp burst 2 s | Selisih dB |
| ----- | ----------- | ---------------------- | ------------- | ---------- |
| −20   |             |                        |               |            |
| −40   |             |                        |               |            |

Lulus: selisih ≤ 1 dB. Cek juga di layar: naik/turun halus tanpa loncatan, durasi total ≈ 2,5 ms.

## Lain-lain

| Item                            | Nilai |
| ------------------------------- | ----- |
| Posisi trimpot RV1 / RV3        |       |
| Driver / headphone yang dipakai |       |
| Model osiloskop                 |       |
| Tanggal                         |       |
| Hasil `i2s` (frame/s, error)    |       |

Foto layar osiloskop (terutama Uji 1 TP3, Uji 3 saat clipping, Uji 4 burst) ikut dikirim kalau bisa.
