# ADS1299 EEG System — Complete Hardware Wiring Documentation

**Project:** ESP32-WROOM-32U + ADS1299 (8-channel EEG) + PCM5102A (audio feedback)
**Backend:** Go WebSocket server on `:8080`
**Reference:** Adapted from [Meower](https://github.com/nikki-uwu/Meower) (dual ADS1299 + ESP32-C3)
**Revision:** 1.0 — 2026-05-19
**Author:** Opus Agent 1

---

## Table of Contents

1. [Bill of Materials (BOM)](#1-bill-of-materials-bom)
2. [Power Supply Design](#2-power-supply-design)
3. [Full Wiring Schematic](#3-full-wiring-schematic)
4. [Per-Channel Electrode Input Protection](#4-per-channel-electrode-input-protection)
5. [PCM5102A Wiring Table](#5-pcm5102a-wiring-table)
6. [Top 10 PCB Layout Rules](#6-top-10-pcb-layout-rules)
7. [Safety Notes](#7-safety-notes)
8. [Testing Checklist](#8-testing-checklist)

---

## 1. Bill of Materials (BOM)

### 1.1 Core ICs and Modules

| Reference | Component | Value / Part # | Qty | Purpose | Notes |
|-----------|-----------|----------------|-----|---------|-------|
| U1 | EEG AFE | **ADS1299IPAG** (TQFP-64) | 1 | 8-channel 24-bit Σ-Δ ADC | Reel/tray only; hand-solder requires fine-tip iron + flux. Pin 1 dot toward NW corner. |
| U2 | MCU module | **ESP32-WROOM-32U** | 1 | WiFi + WebSocket + SPI master + I2S master | U-variant has u.FL antenna connector (better RF than PCB-antenna for shielded enclosures). |
| U3 | Audio DAC module | **PCM5102A breakout** (GY-PCM5102) | 1 | I2S → analog audio for neurofeedback tone | Module includes its own 3.3V LDO and PLL. |
| U4 | 3.3V LDO | **AMS1117-3.3** (SOT-223) | 1 | 5V → 3.3V for ESP32 + DVDD | 1A capacity; add 10µF tantalum in + 22µF out. |
| U5 | Boost converter | **TPS61023** (or MT3608 module) | 1 | 3.7V LiPo → 5V AVDD | TPS61023 = 0.5V start-up, 96% η. MT3608 module = cheap but noisier. |
| U6 | Battery protection IC | **TP4056 + DW01 + FS8205** module | 1 | LiPo charge + over-discharge + short-circuit | Standard 1-cell USB-C charge module. |

### 1.2 Passive Components — Power Decoupling

| Reference | Component | Value | Qty | Purpose | Notes |
|-----------|-----------|-------|-----|---------|-------|
| C1–C4 | Ceramic X7R 0603 | **10 µF / 10 V** | 4 | Bulk decoupling on each AVDD pin | One per AVDD pin (ADS1299 has 4 AVDD pins). |
| C5–C8 | Ceramic X7R 0603 | **1 µF / 10 V** | 4 | Mid-frequency decoupling | One per AVDD pin. |
| C9–C12 | Ceramic C0G 0402 | **100 nF / 10 V** | 4 | HF decoupling | One per AVDD pin, *closest* to pin. |
| C13–C16 | Ceramic C0G 0402 | **10 nF / 10 V** | 4 | VHF decoupling | One per AVDD pin. |
| C17 | Ceramic X7R 0603 | **100 nF** | 1 | DVDD decoupling | At ADS1299 DVDD pin. |
| C18 | Ceramic C0G 0402 | **10 nF** | 1 | DVDD HF decoupling | At ADS1299 DVDD pin. |
| C19 | Ceramic X7R 0805 | **10 µF / 10 V** | 1 | Bulk on 5V rail post-ferrite | After FB1. |
| C20 | Ceramic X7R 0805 | **10 µF / 10 V** | 1 | Boost output bulk | TPS61023 Vout. |
| C21 | Ceramic X7R 0805 | **10 µF / 10 V** | 1 | AMS1117 input | |
| C22 | Tantalum | **22 µF / 10 V** | 1 | AMS1117 output | Required for AMS1117 stability. |
| C23 | Ceramic X7R 0603 | **1 µF** | 1 | VCAP pin (ADS1299 internal LDO) | Per datasheet — **DO NOT OMIT**. |
| C24 | Ceramic X7R 0603 | **10 µF** | 1 | VREFP (internal 4.5V ref) | If using internal ref, decouple to AVSS. |
| C25 | Ceramic C0G 0402 | **100 nF** | 1 | VREFP HF decoupling | |
| FB1 | Ferrite bead | **BLM18PG121SN1 (120 Ω @ 100 MHz)** or 10 µH inductor | 1 | Isolate AVDD from digital supply | Between 5V_DIG and 5V_AVDD. |

### 1.3 Per-Channel Input Protection (×8 channels = ×16 inputs)

| Reference | Component | Value | Qty | Purpose | Notes |
|-----------|-----------|-------|-----|---------|-------|
| R1–R16 | Resistor 0603 1% | **10 kΩ** | 16 | Series limiter (current limit during ESD) | One per electrode line (P and N). |
| D1–D16 | Dual ESD diode | **BAV99** (SOT-23) | 16 | Clamp to AVDD / AVSS | One per electrode line. Low leakage (<2.5 nA) critical for µV signals. |
| C26–C41 | Ceramic C0G 0402 | **100 nF / 10 V** | 16 | RC low-pass anti-alias (fc ≈ 159 Hz) | One per electrode line. C0G mandatory (low DA). |

### 1.4 DRL (Driven Right Leg) Circuit

| Reference | Component | Value | Qty | Purpose | Notes |
|-----------|-----------|-------|-----|---------|-------|
| R17 | Resistor 0603 1% | **330 kΩ** | 1 | DRL feedback return | BIAS_OUT → patient. Limits fault current. |
| R18 | Resistor 0603 1% | **10 kΩ** | 1 | DRL series safety | In line with BIAS electrode. |
| C42 | Ceramic C0G | **1 nF** | 1 | DRL compensation | Stability. |

### 1.5 Misc Resistors

| Reference | Component | Value | Qty | Purpose | Notes |
|-----------|-----------|-------|-----|---------|-------|
| R19 | Resistor 0603 | **10 kΩ** | 1 | MISO pull-down | Prevents tri-state noise when CS=HIGH. |
| R20 | Resistor 0603 | **10 kΩ** | 1 | RESET pull-up to DVDD | Prevents accidental reset. |
| R21 | Resistor 0603 | **10 kΩ** | 1 | PWDN pull-up to DVDD | Safe default = powered. |
| R22 | Resistor 0603 | **10 kΩ** | 1 | START pull-down | Safe default = stopped. |
| R23 | Resistor 0603 | **10 kΩ** | 1 | CLKSEL pull-down to DGND | Selects internal 2.048 MHz osc. |
| R24 | Resistor 0603 | **10 kΩ** | 1 | CS pull-up to DVDD | Idle-high. |

### 1.6 Connectors / Enclosure

| Reference | Component | Value / Part # | Qty | Purpose | Notes |
|-----------|-----------|----------------|-----|---------|-------|
| J1 | Electrode connector | **DIN 42802 1.5 mm touch-proof** (×9: 8 + REF + BIAS) | 1 set | Patient electrodes | Medical-grade. Alternative: 3.5 mm TRS jacks or gold-pin headers for prototyping. |
| J2 | Battery JST-PH 2.0 | 2-pin | 1 | LiPo connection | Match cell polarity. |
| J3 | USB-C | TP4056 module | 1 | Charging only | **No data** to ESP32 from this port. |
| J4 | Programming header | 6-pin 2.54 mm | 1 | UART flashing fallback | EN, GPIO0, TX, RX, GND, 3V3. |
| SW1 | Slide switch | SPDT | 1 | Power on/off | Between battery + and boost in. |
| LED1 | LED 0603 | Green | 1 | Power indicator | Series 1 kΩ. |
| LED2 | LED 0603 | Blue | 1 | WiFi/status (= GPIO 2) | Already on ESP32 dev module. |

### 1.7 Battery + PCB

| Reference | Component | Value / Part # | Qty | Purpose | Notes |
|-----------|-----------|----------------|-----|---------|-------|
| BAT1 | LiPo | **3.7 V 1000–2000 mAh** with PCM | 1 | Main power | Battery-only operation mandatory (see §7). |
| PCB1 | PCB | **4-layer FR4, 1.6 mm, ENIG finish** | 1 | Main board | Layer stack: SIG-GND-PWR-SIG. ENIG (not HASL) for low contact resistance on test points. |

---

## 2. Power Supply Design

### 2.1 Topology

```
                ┌───────────┐   ┌────────┐   ┌─────────┐   FB1   ┌──────────────┐
LiPo 3.7 V ──┬─►│ TP4056    │   │ SW1    │   │ TPS61023│  120 Ω  │  5 V AVDD    │──► ADS1299 AVDD (×4 pins)
             │  │ (charge)  │   │ on/off ├──►│  Boost  ├──┬──╫────┤  (filtered)  │
             │  └───────────┘   └────────┘   │  →5 V   │  │      └──────────────┘
             │                               └────┬────┘  │
             │                                    │       │       ┌──────────────┐
             │                                    └───────┴───────┤  5 V DIG     │──► AMS1117-3.3 ──► 3.3 V DVDD + ESP32
             │                                                    └──────────────┘
             └── USB-C charge in (no data line to MCU)
```

### 2.2 Rail Summary

| Rail | Voltage | Source | Max Current | Decoupling at Load | Loads |
|------|---------|--------|-------------|--------------------|-------|
| VBAT | 3.0–4.2 V | LiPo | ~500 mA peak | n/a | Boost input only |
| 5V_DIG | 5.0 V | TPS61023 | ~400 mA | 10 µF + 100 nF | AMS1117 input |
| 5V_AVDD | 5.0 V (filtered) | 5V_DIG via FB1 | ~30 mA | 10+1 µF+100+10 nF ×4 | ADS1299 AVDD pins |
| 3V3 | 3.3 V | AMS1117 | ~300 mA | 22 µF + 100 nF | ESP32, ADS1299 DVDD, PCM5102A VIN |

### 2.3 Why 5 V AVDD Matters

ADS1299 input range = **±(VREFP − VREFN) / Gain**.
With internal VREFP = 4.5 V and gain = 1 → input range = **±4.5 V**.
Running AVDD at 3.3 V would drop VREFP and shrink the input range, plus reduce headroom for the DRL output and internal regulators. Per TI's datasheet **AVDD ≥ 4.75 V** is mandatory; 5.0 V is the standard operating point.

### 2.4 AGND / DGND Strategy

- **Single ground pour, split visually but joined under U1 (ADS1299) AVSS pin only** ("star point").
- Layer 2 = solid GND. Do NOT route signals on this layer.
- Digital return currents (SPI, I2S) must NOT cross under analog input traces.
- The ferrite bead FB1 isolates AVDD switching noise but **does not** create a separate ground domain.
- Battery negative connects to the star point through a single 0 Ω jumper (allows cutting for safety testing).

### 2.5 Boost Converter Choice

| Parameter | TPS61023 | MT3608 module |
|-----------|----------|----------------|
| Switching freq | 1 MHz (fixed) | ~1.2 MHz (variable) |
| Efficiency @ 100 mA | 94% | 88% |
| Noise on output | Low (synchronous) | Medium (asynchronous) |
| BOM | Custom inductor + caps | Drop-in module |
| Recommendation | **Production** | Prototype only |

**Output filter (required either way):** 10 µF ceramic at boost output → FB1 (120 Ω @ 100 MHz ferrite) → 10 µF ceramic at AVDD entry → per-pin decoupling network.

---

## 3. Full Wiring Schematic

### 3.1 System Block Diagram

```
                       ┌─────────────────────────────────────────────────────┐
                       │              ESP32-WROOM-32U (U2)                   │
                       │                                                     │
   ┌─────────────┐     │  SPI (HSPI)              I2S                        │
   │ ADS1299     │◄────┤  GPIO 18  ── SCLK                                   │
   │ (U1)        │◄────┤  GPIO 23  ── MOSI                                   │
   │ TQFP-64     ├────►│  GPIO 19  ── MISO  (10 kΩ pull-down to DGND)        │
   │             │◄────┤  GPIO 5   ── CS    (10 kΩ pull-up to 3V3)           │
   │             ├────►│  GPIO 34  ── DRDY  (input-only, active-low IRQ)     │
   │             │◄────┤  GPIO 32  ── RESET (10 kΩ pull-up to 3V3)           │
   │             │◄────┤  GPIO 33  ── PWDN  (10 kΩ pull-up to 3V3)           │
   │             │◄────┤  GPIO 21  ── START (10 kΩ pull-down to DGND)        │
   │             │     │                                                     │
   │  CLKSEL ── DGND   │                          GPIO 26 ── BCLK ──┐        │
   │  (internal osc)   │                          GPIO 25 ── LRCK ──┼────┐   │
   │                   │                          GPIO 22 ── DOUT ──┼──┐ │   │
   │  IN1P/N…IN8P/N    │                                            │  │ │   │
   │  ◄── electrodes   │                          GPIO 0  ── BOOT btn   │ │   │
   │  BIAS_OUT ─► DRL  │                          GPIO 2  ── LED        │ │   │
   └─────────────┘     │                          GPIO 1/3 ── UART      │ │   │
                       └────────────────────────────────────────────────┼─┼───┘
                                                                        │ │
                                       ┌────────────────────────────────┘ │
                                       │   ┌──────────────────────────────┘
                                       ▼   ▼
                                 ┌──────────────────┐
                                 │  PCM5102A (U3)   │
                                 │  BCK / LCK / DIN │──► L/R analog out ─► amp/speaker
                                 │  VIN = 3V3       │
                                 └──────────────────┘
```

### 3.2 ADS1299 Supply & Control Wiring

```
   AVDD pins (×4):  pins 1, 12, 28, 64
       ────┬──────────┬──────────┬──────────┬──── 5V_AVDD (filtered)
           │          │          │          │
        ┌──┴──┐    ┌──┴──┐    ┌──┴──┐    ┌──┴──┐    Per-pin network:
        │10µF │    │10µF │    │10µF │    │10µF │     10µF ‖ 1µF ‖ 100nF ‖ 10nF
        │1µF  │    │1µF  │    │1µF  │    │1µF  │     (all to AVSS, placed
        │100nF│    │100nF│    │100nF│    │100nF│      within 2 mm of pin)
        │10nF │    │10nF │    │10nF │    │10nF │
        └──┬──┘    └──┬──┘    └──┬──┘    └──┬──┘
           ▼          ▼          ▼          ▼
         AVSS       AVSS       AVSS       AVSS

   AVSS pins:  star-grounded to GND plane (single tie under chip)
   DVDD:    pin → 3V3, decoupled with 100 nF ‖ 10 nF (close to pin)
   DGND:    pin → GND plane
   VCAP1:   1 µF ceramic to AVSS  (internal LDO — mandatory)
   VREFP:   10 µF ‖ 100 nF to AVSS (internal 4.5 V ref, enabled by PD_REFBUF=1)
   VREFN:   short to AVSS
   CLKSEL:  ── 10 kΩ ── DGND  (selects internal 2.048 MHz oscillator)
   CLK:     ── leave floating (test point)

   SPI:
     SCLK   → ESP32 GPIO 18
     DIN    → ESP32 GPIO 23
     DOUT   → ESP32 GPIO 19  (also 10 kΩ to DGND)
     CS̄     → ESP32 GPIO 5   (also 10 kΩ to 3V3)

   Control:
     DRDȲ   → ESP32 GPIO 34
     RESET̄  → ESP32 GPIO 32  (also 10 kΩ to 3V3)
     PWDN̄   → ESP32 GPIO 33  (also 10 kΩ to 3V3)
     START  → ESP32 GPIO 21  (also 10 kΩ to DGND)
```

### 3.3 Voltage Levels — SPI Logic Compatibility

ADS1299 DVDD = 3.3 V → digital I/O is 3.3 V CMOS, **directly compatible** with ESP32-WROOM. No level shifter required.

---

## 4. Per-Channel Electrode Input Protection

### 4.1 Single-Channel Schematic (Channel 1, replicated 8×)

```
   Patient electrode IN1P (DIN 42802 socket)
   ────────────────┐
                   │
                   ▼
              ┌─── R1 ───┐
              │  10 kΩ   │           Series resistor:
              └──────────┘             - limits fault current to <50 µA
                   │                   - forms RC LPF with C26
                   │                     fc = 1 / (2π·10kΩ·100nF) ≈ 159 Hz
                   ├──────────────────────► IN1P (ADS1299 pin)
                   │
                   ├──── BAV99 ──── AVDD (5 V)
                   │     (clamp high)
                   │
                   ├──── BAV99 ──── AVSS (0 V)
                   │     (clamp low)
                   │
                   ║  C26 = 100 nF C0G
                   ═   (low dielectric absorption)
                   │
                   ▼
                  AVSS

   IN1N path (negative electrode): IDENTICAL — R2, D2(BAV99), C27
```

### 4.2 DRL (Driven Right Leg) Circuit

```
   ADS1299 BIAS_OUT pin
        │
        ▼
   ┌── R18 (10 kΩ) ──┐
   │  ┌── C42 ──┐    │   (stability compensation)
   │  │  1 nF   │    │
   │  └────────┘    │
   └───────┬─────────┘
           │
           ▼
       R17 (330 kΩ)   ← Patient safety current limit: 5V/330kΩ = 15 µA
           │
           ▼
   J1 BIAS pin (patient right leg / mastoid)
```

CONFIG bits: `CONFIG3.PD_BIAS=1`, `CONFIG3.BIASREF_INT=1`, set `BIAS_SENSP`/`BIAS_SENSN` registers.

---

## 5. PCM5102A Wiring Table

| Module Pin | Function | Connect To | Voltage | Notes |
|------------|----------|------------|---------|-------|
| VIN | Supply | 3V3 rail | 3.3 V | Module has on-board LDO |
| GND | Ground | GND plane | 0 V | |
| LCK | LRCK (Word Select) | ESP32 **GPIO 25** | 3.3 V | Toggles at sample rate |
| BCK | Bit Clock | ESP32 **GPIO 26** | 3.3 V | 64 × Fs |
| DIN | Data In | ESP32 **GPIO 22** | 3.3 V | MSB-first serial |
| FMT | Format select | GND | 0 V | LOW = I2S standard |
| XMT | Soft mute | 3V3 (10 kΩ) | 3.3 V | HIGH = un-muted |
| FLT | Filter select | GND | 0 V | LOW = normal latency |
| DEMP | De-emphasis | GND | 0 V | LOW = off |
| SCK | System clock | GND | 0 V | LOW = internal PLL (no MCLK needed) |
| L_OUT | Left analog out | Amplifier | — | |
| R_OUT | Right analog out | Amplifier | — | |
| AGND | Audio ground | Main GND | 0 V | Single-point tie |

---

## 6. Top 10 PCB Layout Rules

1. **4-layer stack with solid GND on Layer 2.** Stack: SIG–GND–PWR–SIG. Never route signals on GND layer.
2. **Star-ground at AVSS under U1.** All GND tied here; digital return currents must NOT cross analog input traces.
3. **Decoupling within 2 mm of every supply pin, smallest value closest.** Order: pin → 10 nF → 100 nF → 1 µF → 10 µF.
4. **Differential input pairs tightly coupled.** Match length ±0.5 mm, spacing ±0.2 mm; surround with GND guard rings.
5. **SPI traces on bottom layer, away from analog inputs.** Add 22–33 Ω series on SCLK if ringing at >2 MHz.
6. **Ferrite bead between digital 5 V and AVDD 5 V.** 10 µF on both sides; never share bulk cap between domains.
7. **No vias on analog input nets.** Route INxP/N entirely on top layer: connector → R → BAV99 → C → ADS1299.
8. **Keep CLK pin output as short stub.** CLK radiates even with internal oscillator; leave floating with test point only.
9. **Battery and boost converter opposite side from ADS1299.** SW pin of TPS61023 = smallest copper area possible.
10. **Test points on every rail and control line.** VBAT, 5V_DIG, 5V_AVDD, 3V3, AVSS, DGND, all SPI, DRDY, RESET, PWDN, START, BIAS_OUT, VREFP.

---

## 7. Safety Notes

> **EEG hardware contacts a human scalp. Patient safety is non-negotiable even for research prototypes.**

### 7.1 Mandatory Rules

1. **Battery-only operation, always.** No mains power, no USB tether while electrodes are on a person.
2. **No earth-ground connection in the signal path.** Patient, chassis, and PCB ground must float relative to earth.
3. **USB-C port is for charging only.** Physically isolate USB D+/D− from ESP32 (TP4056 module does this).
4. **DRL series resistor R17 = 330 kΩ minimum.** Limits fault current to <50 µA (IEC 60601-1 limit = 100 µA).
5. **Use medical-grade electrodes only.** DIN 42802 1.5 mm touch-proof connectors. Never reuse disposable pads.
6. **Enclose PCB in insulating plastic.** No exposed metal screws on patient-facing side.

### 7.2 Forbidden Configurations

| Don't | Why |
|-------|-----|
| Power from USB while electrodes attached | Earth-ground loop through laptop chassis |
| Connect ADS1299 GND to mains earth | Direct shock path |
| Replace R17 with smaller value | Fault current exceeds safe limit |
| Use 1N4148 instead of BAV99 | Higher leakage degrades signal |
| Run audio amplifier from mains | Couples noise + creates ground reference |

### 7.3 Disclaimer

This system is for **research and educational use only**. Not a certified medical device. Not for diagnosis or clinical use. Operator assumes all risk.

---

## 8. Testing Checklist

### Phase A — Bare PCB
- [ ] A1. Visual inspection: pin 1 markings on U1, U2, U3, U4, U5
- [ ] A2. Continuity: VBAT, 5V_DIG, 5V_AVDD, 3V3, GND — none shorted to each other
- [ ] A3. Continuity: every ADS1299 pad to its net
- [ ] A4. Confirm AGND/DGND star point under U1

### Phase B — Power Rails (U4, U5 only)
- [ ] B1. Apply 3.7 V @ 200 mA limit
- [ ] B2. 5V_DIG = 5.00 V ± 100 mV
- [ ] B3. 5V_AVDD = 5.00 V ± 100 mV, ripple <5 mVpp
- [ ] B4. 3V3 = 3.30 V ± 50 mV
- [ ] B5. Quiescent current <20 mA

### Phase C — ESP32 Alone
- [ ] C1. Flash minimal sketch via UART
- [ ] C2. WiFi connects to test AP
- [ ] C3. GPIO 2 LED toggles
- [ ] C4. GPIO 0 clears NVS
- [ ] C5. Toggle GPIO 5/18/21/23/32/33 — confirm 3.3 V swing

### Phase D — PCM5102A
- [ ] D1. VIN = 3.3 V at module
- [ ] D2. 1 kHz sine on I2S
- [ ] D3. BCK = 2.8224 MHz, LCK = 44.1 kHz
- [ ] D4. Clean sine on L_OUT
- [ ] D5. No WiFi-correlated clicking

### Phase E — ADS1299 Bring-Up
- [ ] E1. AVDD pins = 5.0 V
- [ ] E2. DVDD = 3.3 V
- [ ] E3. VCAP1 ≈ 1.8 V
- [ ] E4. VREFP = 4.50 V ± 50 mV after CONFIG3 write
- [ ] E5. CLKSEL = 0 V
- [ ] E6. DRDY = HIGH (no data)
- [ ] E7. Read ID register → **0x3E**
- [ ] E8. Internal test signal config
- [ ] E9. DRDY toggles at 250 SPS (4 ms period)
- [ ] E10. Square wave on all 8 channels from test signal

### Phase F — Real Signal
- [ ] F1. Short inputs to AVSS → noise <1 µVpp at 250 SPS / gain=24
- [ ] F2. Forehead electrodes → blink EOG artifacts visible (~100 µV)
- [ ] F3. 50/60 Hz pickup <5 µVpp with DRL active
- [ ] F4. WebSocket streaming to Go :8080 at 250 SPS × 8 ch × 24-bit = 6 kB/s
- [ ] F5. 30-minute continuous run — no dropouts

### Phase G — Safety Verification
- [ ] G1. Battery-powered only: electrode-to-earth = floating
- [ ] G2. 5V inject on electrode: BAV99 clamps, ID register still 0x3E
- [ ] G3. BIAS-to-AVSS resistance ≥ 340 kΩ
- [ ] G4. USB-C only (no battery): ADS1299 AVDD stays at 0 V

---

**End of document.** Revision 1.0 — 2026-05-19.
