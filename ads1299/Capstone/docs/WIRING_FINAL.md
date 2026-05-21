# Wiring Final — ESP32-WROOM-32U + ADS1299 + PCM5102A

Dokumen ini adalah referensi wiring tunggal yang sinkron dengan kode firmware di `Capstone/`.
Setiap koneksi di sini langsung cocok dengan define di `include/eeg_config.h`.

---

## 1. Ringkasan Pin ESP32 → ADS1299

| ESP32 GPIO | ADS1299 Pin | Nama Sinyal | Arah | Keterangan                                                                   |
| ---------- | ----------- | ----------- | ---- | ---------------------------------------------------------------------------- |
| GPIO 18    | SCLK        | SPI Clock   | OUT  | Defined: `EEG_PIN_SPI_SCLK`                                                  |
| GPIO 19    | DOUT        | SPI MISO    | IN   | Defined: `EEG_PIN_SPI_MISO` — pasang 10kΩ pull-down ke GND                   |
| GPIO 23    | DIN         | SPI MOSI    | OUT  | Defined: `EEG_PIN_SPI_MOSI`                                                  |
| GPIO 5     | CS          | Chip Select | OUT  | Defined: `EEG_PIN_ADS1299_CS` — active-low, pasang 10kΩ pull-up ke 3V3       |
| GPIO 34    | DRDY        | Data Ready  | IN   | Defined: `EEG_PIN_ADS1299_DRDY` — input-only GPIO, active-low IRQ            |
| GPIO 32    | RESET       | Reset       | OUT  | Defined: `EEG_PIN_ADS1299_RESET` — active-low, pasang 10kΩ pull-up ke 3V3    |
| GPIO 33    | PWDN        | Power Down  | OUT  | Defined: `EEG_PIN_ADS1299_PWDN` — active-low, pasang 10kΩ pull-up ke 3V3     |
| GPIO 21    | START       | Start/Stop  | OUT  | Defined: `EEG_PIN_ADS1299_START` — active-high, pasang 10kΩ pull-down ke GND |

---

## 2. Ringkasan Pin ESP32 → PCM5102A

| ESP32 GPIO | PCM5102A Pin | Nama Sinyal        | Arah | Keterangan                  |
| ---------- | ------------ | ------------------ | ---- | --------------------------- |
| GPIO 26    | BCK          | Bit Clock          | OUT  | Defined: `EEG_PIN_I2S_BCLK` |
| GPIO 25    | LCK          | Word Select (LRCK) | OUT  | Defined: `EEG_PIN_I2S_LRC`  |
| GPIO 22    | DIN          | Data In            | OUT  | Defined: `EEG_PIN_I2S_DOUT` |
| 3V3        | VIN          | Supply             | PWR  |                             |
| GND        | GND          | Ground             | GND  |                             |

### Pin PCM5102A yang di-strap ke GND/VCC (tidak ke ESP32):

| PCM5102A Pin | Sambung ke     | Fungsi                                           |
| ------------ | -------------- | ------------------------------------------------ |
| SCK          | GND            | Internal PLL aktif (tidak butuh MCLK dari ESP32) |
| FMT          | GND            | Format I2S standar                               |
| FLT          | GND            | Normal latency filter                            |
| DEMP         | GND            | De-emphasis off                                  |
| XMT          | 3V3 (via 10kΩ) | Un-mute (aktif)                                  |

---

## 3. Power Supply — Dari LiPo ke ADS1299

```
LiPo 3.7V
    │
    ├──► TP4056 module (USB-C charging) ──┐
    │                                     │ (charge only, no data ke ESP32)
    │
    ├──► SPDT Power Switch
          │
          ▼
     TPS61023 (Boost)
     3.7V → 5V
          │
          ├──► 10µF (bulk)
          │
          ├──[BLM18PG121 Ferrite 120Ω]──► 5V_AVDD ──► ADS1299 AVDD (pin 1,12,28,64)
          │                                           (decoupling per pin: 10µF+1µF+100nF+10nF)
          │
          └──► AMS1117-3.3 (LDO)
               │
               └──► 3.3V ──► ESP32 VIN
                         └──► ADS1299 DVDD
                         └──► PCM5102A VIN
```

### Tegangan Per Rail:

| Rail    | Tegangan        | Sumber             | Untuk                         |
| ------- | --------------- | ------------------ | ----------------------------- |
| VBAT    | 3.0–4.2V        | LiPo               | Input boost saja              |
| 5V_AVDD | 5.0V (filtered) | TPS61023 + ferrite | ADS1299 AVDD                  |
| 3V3     | 3.3V            | AMS1117-3.3        | ESP32, ADS1299 DVDD, PCM5102A |

---

## 4. ADS1299 — Koneksi Supply & Strap

| ADS1299 Pin | No. Pin | Sambung ke | Nilai | Keterangan |
|-------------|---------|------------|-------|------------|
| AVDD | **19, 21, 56, 59** | 5V_AVDD | — | Semua 4 pin → 5V. Decoupling per pin: 10µF ‖ 1µF ‖ 100nF ‖ 10nF ke AVSS |
| AVDD1 | **54** | 5V_AVDD | — | Charge pump supply → 5V, 1µF ke AVSS1 (pin 53) |
| AVSS | **20, 23, 32, 57** | GND (star point) | — | Analog ground |
| AVSS1 | **53, 58** | GND | — | Charge pump analog ground |
| DVDD | **48, 50** | 3V3 | — | 100nF ‖ 10nF ke DGND |
| DGND | **33, 49, 51** | GND | — | Digital ground |
| VCAP1 | **28** | GND via cap | **100µF** | **Wajib — internal LDO. 100µF bukan 1µF!** |
| VCAP2 | **30** | GND via cap | 1µF | Internal LDO cap |
| VCAP3 | **55** | GND via cap | 1µF ‖ 0.1µF | Internal LDO cap (paralel) |
| VCAP4 | **26** | GND via cap | 1µF | Internal LDO cap |
| VREFP | **24** | GND via cap | 10µF ‖ 100nF | Internal 4.5V reference (aktif via CONFIG3) |
| VREFN | **25** | GND | short | |
| CLKSEL | **52** | GND | 10kΩ | Internal oscillator 2.048 MHz aktif |
| CLK | **37** | NC | — | Biarkan floating (test point opsional) |
| Reserved | **64** | NC | — | Leave open circuit |

---

## 5. ADS1299 — Input Elektroda Per Channel (×8)

Contoh untuk Channel 1 (ulangi untuk CH2–CH8):

```
Elektroda (+)
     │
     ├── 10kΩ ──┬──────────────────► IN1P (ADS1299)
                │
                ├── BAV99 ──► AVDD (5V)   (clamp atas)
                ├── BAV99 ──► AVSS (GND)  (clamp bawah)
                │
                └── 100nF C0G ──► AVSS   (LPF fc ≈ 159Hz)

Elektroda (-)
     │
     └── 10kΩ ──┬──────────────────► IN1N (ADS1299)
                │ (proteksi identik: BAV99 + 100nF C0G)
```

### Koneksi Elektroda (semua 8 channel):

| Konektor | Resistor | ESD       | Cap       | ADS1299 Pin |
| -------- | -------- | --------- | --------- | ----------- |
| IN1+     | R1 10kΩ  | D1 BAV99  | C1 100nF  | IN1P        |
| IN1-     | R2 10kΩ  | D2 BAV99  | C2 100nF  | IN1N        |
| IN2+     | R3 10kΩ  | D3 BAV99  | C3 100nF  | IN2P        |
| IN2-     | R4 10kΩ  | D4 BAV99  | C4 100nF  | IN2N        |
| IN3+     | R5 10kΩ  | D5 BAV99  | C5 100nF  | IN3P        |
| IN3-     | R6 10kΩ  | D6 BAV99  | C6 100nF  | IN3N        |
| IN4+     | R7 10kΩ  | D7 BAV99  | C7 100nF  | IN4P        |
| IN4-     | R8 10kΩ  | D8 BAV99  | C8 100nF  | IN4N        |
| IN5+     | R9 10kΩ  | D9 BAV99  | C9 100nF  | IN5P        |
| IN5-     | R10 10kΩ | D10 BAV99 | C10 100nF | IN5N        |
| IN6+     | R11 10kΩ | D11 BAV99 | C11 100nF | IN6P        |
| IN6-     | R12 10kΩ | D12 BAV99 | C12 100nF | IN6N        |
| IN7+     | R13 10kΩ | D13 BAV99 | C13 100nF | IN7P        |
| IN7-     | R14 10kΩ | D14 BAV99 | C14 100nF | IN7N        |
| IN8+     | R15 10kΩ | D15 BAV99 | C15 100nF | IN8P        |
| IN8-     | R16 10kΩ | D16 BAV99 | C16 100nF | IN8N        |

---

## 6. DRL (Driven Right Leg) — Sirkuit Referensi Pasien

```
ADS1299 BIAS_OUT
      │
      └──[R18: 10kΩ]──┬──[C42: 1nF]──┐  (kompensasi stabilitas)
                      └──────────────┘
                      │
                      └──[R17: 330kΩ]──► Elektroda BIAS (kaki kanan / mastoid)
```

Config di firmware (`CONFIG3 = 0xE0`):

- `PD_BIAS = 1` → BIAS buffer aktif
- `BIASREF_INT = 1` → referensi (AVDD+AVSS)/2 internal
- `BIAS_SENSP = 0xFF`, `BIAS_SENSN = 0xFF` → semua 8 channel kontribusi ke DRL

---

## 7. Pull-up / Pull-down Resistor Summary

| Pin             | Nilai | Ke  | Fungsi                               |
| --------------- | ----- | --- | ------------------------------------ |
| MISO (GPIO 19)  | 10kΩ  | GND | Cegah noise saat CS=HIGH (tri-state) |
| CS (GPIO 5)     | 10kΩ  | 3V3 | Idle HIGH (chip tidak dipilih)       |
| RESET (GPIO 32) | 10kΩ  | 3V3 | Cegah reset tidak sengaja            |
| PWDN (GPIO 33)  | 10kΩ  | 3V3 | Default = powered (tidak power-down) |
| START (GPIO 21) | 10kΩ  | GND | Default = stop conversion            |
| CLKSEL          | 10kΩ  | GND | Pilih internal oscillator            |

---

## 8. SPI Configuration (dari firmware)

```
SPIClass SPI(HSPI)
SPI.begin(SCLK=18, MISO=19, MOSI=23, CS=5)

SPISettings:
  Clock    : 1,000,000 Hz (1 MHz)
  Bit order: MSBFIRST
  Mode     : SPI_MODE1 (CPOL=0, CPHA=1)
```

---

## 9. Diagram Blok Sistem Lengkap

```
                    ┌──────────────────────────────────────────────┐
  LiPo 3.7V ──────►│ TPS61023 Boost │ AMS1117-3.3 │ TP4056 Charge │
                    └──────┬─────────────────┬──────────────────────┘
                    5V_AVDD│          3V3────┤
                           │                 │
                    ┌──────┴──────┐   ┌──────┴────────────────────────┐
                    │  ADS1299    │   │     ESP32-WROOM-32U           │
                    │  TQFP-64   │   │                               │
                    │            │   │  GPIO18 ──► SCLK              │
                    │ SCLK ◄─────┼───┤  GPIO19 ◄── DOUT (MISO)      │
                    │ DIN  ◄─────┼───┤  GPIO23 ──► DIN  (MOSI)      │
                    │ DOUT ─────►┼───┤  GPIO5  ──► CS               │
                    │ CS   ◄─────┼───┤  GPIO34 ◄── DRDY (IRQ)       │
                    │ DRDY ─────►┼───┤  GPIO32 ──► RESET            │
                    │ RESET◄─────┼───┤  GPIO33 ──► PWDN             │
                    │ PWDN ◄─────┼───┤  GPIO21 ──► START            │
                    │ START◄─────┼───┤                               │
                    │            │   │  GPIO26 ──► I2S BCLK─────────┼──┐
                    │ IN1P..IN8P │   │  GPIO25 ──► I2S LRC ─────────┼──┤
                    │ IN1N..IN8N │   │  GPIO22 ──► I2S DIN ─────────┼──┤
                    │ BIAS_OUT──►│DRL│  GPIO2  ──► LED               │  │
                    │ CLKSEL=GND │   │  GPIO0  ──► BOOT BTN          │  │
                    └────────────┘   └───────────────────────────────┘  │
                         │                                               │
                    Elektroda                                    ┌───────┴─────┐
                    (10kΩ + BAV99                               │  PCM5102A   │
                    + 100nF per pin)                             │  BCK/LCK/DIN│
                                                                │  → L/R OUT  │
                                                                └─────────────┘
```

---

## 10. GPIO yang DILARANG (ESP32 Flash)

| GPIO               | Alasan                                                  |
| ------------------ | ------------------------------------------------------- |
| 6, 7, 8, 9, 10, 11 | Terhubung ke flash SPI internal — jangan pernah dipakai |
| 1 (TX), 3 (RX)     | UART debug — jangan pakai untuk peripheral lain         |

---

## 11. Checklist Koneksi Sebelum Power On

- [ ] AVDD (pin 1,12,28,64) semua terhubung ke 5V_AVDD
- [ ] VCAP1 ada 1µF ke AVSS
- [ ] CLKSEL terhubung ke GND via 10kΩ
- [ ] MISO (GPIO 19) ada 10kΩ pull-down ke GND
- [ ] CS (GPIO 5) ada 10kΩ pull-up ke 3V3
- [ ] RESET (GPIO 32) ada 10kΩ pull-up ke 3V3
- [ ] PWDN (GPIO 33) ada 10kΩ pull-up ke 3V3
- [ ] START (GPIO 21) ada 10kΩ pull-down ke GND
- [ ] BAV99 orientasi benar (katoda ke AVDD, anoda ke AVSS)
- [ ] PCM5102A: SCK → GND, FMT → GND, XMT → 3V3
- [ ] GPIO 6–11 tidak ada yang tersambung ke apapun

---

_Sinkron dengan: `include/eeg_config.h` | Firmware version: Codex drop 2026-05-19_
