# Wiring Minimal — Tes Nyala ADS1299 + ESP32-WROOM-32U

> Tujuan: cek SPI communicate, baca ID register (harus return 0x3E), DRDY toggle.
> Tidak ada proteksi — jangan sambung elektroda ke orang.

---

## Kabel yang dibutuhkan: 11 kabel

### ESP32 → ADS1299 (SPI + Control)

| ESP32 GPIO | →   | ADS1299 Pin | Nama        |
| ---------- | --- | ----------- | ----------- |
| GPIO 18    | →   | SCLK        | SPI Clock   |
| GPIO 19    | ←   | DOUT        | MISO        |
| GPIO 23    | →   | DIN         | MOSI        |
| GPIO 5     | →   | CS̄          | Chip Select |
| GPIO 34    | ←   | DRDY        | Data Ready  |
| GPIO 32    | →   | RESET̄       | Reset       |
| GPIO 33    | →   | PWDN̄        | Power Down  |
| GPIO 21    | →   | START       | Start       |

### Power ADS1299

| Sambung ke  | →   | ADS1299 Pin (no.)                      | Keterangan                             |
| ----------- | --- | -------------------------------------- | -------------------------------------- |
| 5V          | →   | AVDD — pin **19, 21, 56, 59**          | semua 4 pin harus tersambung ke 5V     |
| 5V          | →   | AVDD1 — pin **54**                     | charge pump supply, sambung ke 5V juga |
| 3.3V        | →   | DVDD — pin **48, 50**                  | supply digital                         |
| GND         | →   | AVSS — pin **20, 23, 32, 57**          | analog ground                          |
| GND         | →   | AVSS1 — pin **53, 58**                 | charge pump ground                     |
| GND         | →   | DGND — pin **33, 49, 51**              | digital ground                         |
| GND         | →   | VREFN — pin **25**                     | short ke GND                           |
| GND via cap | →   | VCAP1 — pin **28** → [**100µF**] → GND | **wajib! internal LDO cap**            |
| GND via cap | →   | VCAP2 — pin **30** → [1µF] → GND       | internal LDO cap                       |
| GND via cap | →   | VCAP3 — pin **55** → [1µF‖0.1µF] → GND | internal LDO cap                       |
| GND via cap | →   | VCAP4 — pin **26** → [1µF] → GND       | internal LDO cap                       |
| GND         | →   | CLKSEL — pin **52** via 10kΩ           | internal osc 2.048 MHz aktif           |

> **VCAP1 (pin 28) wajib pakai 100µF ke GND** — bukan 1µF, lihat datasheet halaman 7.
>
> **RESET (pin 36) dan PWDN (pin 35)** sudah dikontrol firmware via GPIO 32 & 33 — tidak perlu pull-up eksternal untuk tes minimal.

---

## Diagram Breadboard

```
ESP32-WROOM-32U          ADS1299 (breakout)

3V3  ─────────────────── DVDD (pin 48, 50)
3V3  ─────────────────── RESET via 10kΩ (pin 36)
3V3  ─────────────────── PWDN  via 10kΩ (pin 35)
GND  ─────────────────── CLKSEL via 10kΩ (pin 52)
GND  ─────────────────── AVSS (pin 20, 23, 32, 57)
GND  ─────────────────── AVSS1 (pin 53, 58)
GND  ─────────────────── DGND (pin 33, 49, 51)
GND  ─────────────────── VREFN (pin 25)
5V   ─────────────────── AVDD (pin 19, 21, 56, 59) ← semua 4!
5V   ─────────────────── AVDD1 (pin 54)

GPIO 18 ──────────────── SCLK (pin 40)
GPIO 19 ──────────────── DOUT (pin 43)
GPIO 23 ──────────────── DIN  (pin 34)
GPIO 5  ──────────────── CS   (pin 39)
GPIO 34 ──────────────── DRDY (pin 47)
GPIO 32 ──────────────── RESET (pin 36)
GPIO 33 ──────────────── PWDN  (pin 35)
GPIO 21 ──────────────── START (pin 38)

VCAP1 (pin 28) ─[100µF]─ GND  ← 100µF! wajib
VCAP2 (pin 30) ─[1µF]─── GND
VCAP3 (pin 55) ─[1µF‖0.1µF]─ GND
VCAP4 (pin 26) ─[1µF]─── GND
```

---

## Sumber 5V untuk AVDD

Kalau belum punya boost converter, bisa pakai:

- Pin **VIN** ESP32 dev board (biasanya 5V dari USB) → sambung ke AVDD
- Atau pin **5V** dari USB power bank langsung

---

## Tes Sukses

Flash firmware lalu buka serial monitor 115200 baud.
Harus muncul:

```
ADS1299 ID: 0x3E  ← ini artinya SPI jalan
DRDY toggling at 250 SPS
EEG task started on Core 1
```

Kalau ID = 0x00 atau 0xFF → cek kabel SCLK/MOSI/MISO/CS.

---

_Setelah tes nyala, tambah proteksi (resistor + BAV99 + cap) sebelum pakai elektroda._
