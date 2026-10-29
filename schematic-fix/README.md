# Skematik final

| File | Isi |
|---|---|
| `board-1-analog.pdf` | Board 1, Analog EEG Board A v14: ADS1299 (CH1 Cz-A1, CH2 Cz-A2), input RC + ESD, BIAS/DRL, indikator 5V/3V3 |
| `board-2-digital.pdf` | Board 2, Digital System: ESP32-DevKitC, PCM5102A → TDA1308 → jack, AMS1117 3V3, sensor baterai |

Board 1 dan Board 2 disambung lewat dua header stack 12 pin (POWER dan SIGNAL).

## Perubahan yang belum ada di PDF

| Komponen | Di PDF | Terpasang | Catatan |
|---|---|---|---|
| R2, R5 (Board 2, pembagi ke TDA1308) | 47 Ω | **330 Ω** | dengan trimpot 1 kΩ paralel (330 ∥ 1k = 248 Ω) redaman jadi −39.1 dB, sama dengan `DIVIDER_DB` di firmware |

## Pin ESP32 (Board 2)

| Sinyal | GPIO |
|---|---|
| I2S BCK / LRCK / DIN (PCM5102A) | 32 / 33 / 14 |
| ADS1299 MOSI / MISO / SCLK (lewat R10–R12 33 Ω) | 23 / 19 / 18 |
| ADS1299 CS_N / DRDY | 21 / 34 |
| ADS1299 START / RESET_N / PWDN_N | 25 / 26 / 27 |
| BAT_SENSE (R8 220k / R9 100k) | 35 |

Firmware yang memakai pin ini: `esp/` (`src/ads1299.h`, `src/main.c`, `src/battery.h`).
