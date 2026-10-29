# Setup NeuroSound dari nol: baterai sampai tersambung ke server

Server: `wss://capstone.irsad.site/ws?id=esp32-audio-001` (sudah tertanam di firmware, `src/net.h`).

## Aturan aman (baca dulu)

- **USB laptop dan Board 3 tidak boleh tersambung bersamaan.** USB hanya untuk flash / serial monitor.
- **Pasang / cabut board atau kabel hanya saat power MATI.**
- **Elektroda tidak boleh di kepala orang selama USB laptop tercolok.**
- Konektor JST Board 3 → Board 2 warnanya tidak standar: **hitam = 5 V**, **merah = GND**,
  **kuning = VBAT**. Jangan menebak dari warna; cek dengan multimeter kalau ragu.

## 1. Baterai

1. Cas baterai sampai penuh (± 4,1–4,2 V) lewat port charge Board 3 memakai charger HP, bukan USB laptop.
2. Pasang baterai ke Board 3. Perhatikan + dan −.
3. Saklar Board 3 masih **OFF**.

## 2. Susun board (power masih OFF)

1. Pasang Board 1 (ADS1299) ke Board 2 lewat dua header stack (POWER dan SIGNAL). Pin 1 ketemu pin 1, tidak bergeser.
2. Colok JST Board 3 ke Board 2.
3. Cabut USB laptop kalau masih tercolok.

## 3. Nyalakan

1. Nyalakan Board 3. LED indikator 5V/3V3 di Board 1 menyala.
2. Kalau mau cek cepat dengan multimeter (opsional): header POWER pin 2/3 ≈ 5 V, pin 10/11 ≈ 3,3 V.

## 4. Hubungkan ke WiFi (sekali saja, tersimpan permanen)

Kalau ESP belum punya WiFi tersimpan, ia membuka hotspot sendiri.

1. Dari HP / laptop, sambung ke WiFi **`ESP32-Setup`**, password **`12345678`**.
2. Halaman setup biasanya muncul otomatis. Kalau tidak, buka **http://4.3.2.1/**.
3. Pilih WiFi tujuan (**harus 2,4 GHz**; ESP32 tidak bisa 5 GHz), isi password, tekan simpan.
4. ESP restart sendiri dan konek ke WiFi tersebut, lalu ke server.

Hotspot HP juga bisa dipakai; pastikan mode 2,4 GHz / "kompatibilitas maksimum" aktif.

**Ganti WiFi:** tahan tombol **BOOT** sambil menyalakan, atau kirim perintah `wifi reset`.
ESP kembali membuka `ESP32-Setup`.

## 5. Cek sudah tersambung ke server

- Buka **https://capstone.irsad.site/api/v1/devices**. `esp32-audio-001` harus `"connected": true`.
  Di situ juga terlihat `bat_mv` (tegangan baterai) dan `ads` (ADS1299 terdeteksi atau tidak).
- Log lengkap: **https://capstone.irsad.site/logs?token=…** (token dari pengelola server).
- Saat tersambung, ESP otomatis menjalankan `ads check` dan hasilnya muncul di log.

## 6. Perintah yang sering dipakai (dari dashboard / log page)

| Perintah | Fungsi |
|---|---|
| `bat` | tegangan baterai |
| `ads check` | cek ADS1299 7 langkah |
| `ads drdy` | uji DRDY rinci |
| `abr` lalu `on` / `off` | mulai / stop stimulus ABR |
| `debug on` | log lebih rinci |
| `?` | semua perintah |

## Kalau tidak tersambung

| Gejala | Coba |
|---|---|
| `ESP32-Setup` tidak muncul dan device tidak online | WiFi tersimpan salah / di luar jangkauan: tahan BOOT saat menyalakan, setup ulang |
| WiFi tujuan tidak ada di daftar | WiFi 5 GHz; pakai 2,4 GHz |
| Online lalu putus terus / ESP restart sendiri | Baterai lemah: cas sampai > 3,8 V |
| `bat` = "tidak terdeteksi" | ESP jalan dari USB, bukan Board 3 |
| Device online tapi `ads: false` | Masalah Board 1 / ADS1299, lihat `ads check` di log |

## Flash firmware (hanya kalau perlu update)

1. Matikan Board 3, colok USB laptop.
2. Di folder `esp/`: `pio run -e esp32dev -t upload` (tutup serial monitor dulu).
3. Cabut USB, nyalakan Board 3 lagi. WiFi tersimpan tidak hilang setelah flash.
