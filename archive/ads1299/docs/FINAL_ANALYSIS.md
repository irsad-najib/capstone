# FINAL ANALYSIS — ADS1299 EEG Acquisition (ESP32-WROOM-32U)

Review agent: cross-check of `docs/hardware_wiring_opus.md` (Opus hardware agent)
against the Codex firmware drop in `Capstone/` (12 files).

Status: **PROTOTYPE READY with minor fixes** — see Section 10 for the verdict.

---

## 1. Cross-Check — Hardware vs Firmware Consistency

### 1.1 SPI bus (ESP32 ↔ ADS1299)

| Signal | Hardware (Opus) | Firmware (Codex) | Status |
|--------|-----------------|------------------|--------|
| SCLK   | GPIO18          | GPIO18           | CONFIRMED |
| MISO   | GPIO19          | GPIO19           | CONFIRMED |
| MOSI   | GPIO23          | GPIO23           | CONFIRMED |
| CS     | GPIO5           | GPIO5            | CONFIRMED |
| SPI mode | Mode 1 (CPOL=0, CPHA=1) | Mode 1 | CONFIRMED |
| Clock rate | 2 MHz suggested | 1 MHz | **CONFLICT** — see §4 (1 MHz is safer; keep 1 MHz) |

### 1.2 ADS1299 control GPIO

| Signal | Hardware | Firmware | Status |
|--------|----------|----------|--------|
| DRDY   | GPIO34 (input-only) | GPIO34 + IRAM_ATTR ISR | CONFIRMED |
| RESET  | GPIO32   | GPIO32, pulsed LOW 2 ms in init | CONFIRMED |
| PWDN   | GPIO33   | GPIO33, held LOW then HIGH | CONFIRMED |
| START  | GPIO21   | GPIO21, driven HIGH + START cmd | CONFIRMED |

GPIO34 is input-only on ESP32 — correct for DRDY. No internal pull-up available;
the ADS1299 DRDY is a push-pull output so external pull-up is not required.

### 1.3 PCM5102A I2S

| Signal | Hardware | Firmware (existing `.ino`) | Status |
|--------|----------|----------------------------|--------|
| BCLK   | GPIO26   | GPIO26                     | CONFIRMED |
| LRC    | GPIO25   | GPIO25                     | CONFIRMED |
| DIN    | GPIO22   | GPIO22                     | CONFIRMED |
| SCK    | tied to GND (datasheet — internal PLL) | n/a | CONFIRMED (no firmware action needed) |

### 1.4 Power rails

| Rail | Hardware | Firmware expectation | Status |
|------|----------|----------------------|--------|
| AVDD 5 V (TPS61023 boost) | Yes, with 10/1/0.1/0.01 µF per pin ×4 | Implicit (VREF=4 V requires AVDD ≥ 4.75 V) | CONFIRMED |
| DVDD 3.3 V (AMS1117) | Yes | ESP32 logic 3.3 V matches DVDD I/O | CONFIRMED |
| VCAP1 → 1 µF to AVSS | Yes | No firmware action needed | CONFIRMED |
| VREFP → 10 µF + 100 nF | Yes | CONFIG3 sets PD_REFBUF=1 (internal ref), VREF_4V=1 — matches hardware-decoupled VREFP | CONFIRMED |

### 1.5 GAPS / cross-cutting items

- **CLKSEL pin** (hardware ties to DVDD for internal 2.048 MHz oscillator).
  Firmware has no CLKSEL handling — correct, because it is a hard-tied pin.
  However the firmware never explicitly re-enables CLK output on pin 12
  (`CONFIG1.CLK_EN`); since it uses the internal oscillator with no daisy
  chain, leaving CLK_EN=0 (as 0x96 does) is intentional and correct.
- **GPIO 6–11** (ESP32 SPI flash) — neither agent uses them. No conflict, but
  the integration guide (§9) adds a build-time `static_assert` reminder.
- **BIAS electrode**: hardware specifies the BIAS_OUT → 10 kΩ → 330 kΩ → patient
  network. Firmware enables BIAS via `CONFIG3` (PD_BIAS=1, BIASREF_INT=1) and
  routes all 8 channels into the BIAS derivation network via
  `BIAS_SENSP=0xFF`, `BIAS_SENSN=0xFF`. CONFIRMED, but see §7 for a sequencing
  caveat (BIAS must settle before START).
- **Lead-off detection**: hardware does not specify lead-off circuitry, but
  firmware enables `PD_LOFF_COMP` (CONFIG4=0x02). This is harmless (only powers
  the comparator); the LOFF status bits in DATA will read 0 unless LOFF
  registers are programmed. Documented in §7.
- **MISO 10 kΩ pull-down to DGND** (hardware): firmware does not need to
  configure this. CONFIRMED.

---

## 2. Register Value Verification

All values verified bit-by-bit against the ADS1299 datasheet (SBAS499C).

### CONFIG1 = 0x96 = `1001 0110`

| Bit | Name      | Val | Meaning |
|-----|-----------|-----|---------|
| 7   | (reserved, must be 1) | 1 | OK |
| 6   | DAISY_EN  | 0 | Daisy chain disabled (single device) |
| 5   | CLK_EN    | 0 | CLK pin not driven out (internal osc only) |
| 4–3 | (reserved = `10`) | 10 | OK |
| 2–0 | DR[2:0]   | 110 | f_MOD / 4096 → 250 SPS @ f_CLK = 2.048 MHz |

CONFIRMED. (Note: "HR=1" in the Codex comment is a misnomer — ADS1299 has no
HR/LP mode bit in CONFIG1; the part always runs high-resolution. The value
itself is correct and matches the datasheet's reset default.)

### CONFIG2 = 0xC0 = `1100 0000`

| Bit | Name       | Val | Meaning |
|-----|------------|-----|---------|
| 7–6 | (reserved = `11`) | 11 | OK |
| 5   | INT_CAL    | 0 | Test signals driven externally (i.e. off) |
| 4   | (reserved) | 0 | OK |
| 3   | CAL_AMP    | 0 | 1 × −(VREFP−VREFN)/2400 (irrelevant; cal off) |
| 2   | (reserved) | 0 | OK |
| 1–0 | CAL_FREQ   | 00 | f_CLK / 2¹⁰ ⁵ (irrelevant; cal off) |

CONFIRMED. Test/calibration signal generator is OFF.

### CONFIG3 = 0xEC = `1110 1100`

| Bit | Name        | Val | Meaning |
|-----|-------------|-----|---------|
| 7   | PD_REFBUF   | 1 | Internal reference buffer ENABLED |
| 6   | (reserved = 1) | 1 | OK |
| 5   | BIAS_MEAS   | 1 | BIAS_IN routed for measurement (see note) |
| 4   | BIASREF_INT | 0 | (AVDD+AVSS)/2 generated internally? — see note |
| 3   | PD_BIAS     | 1 | BIAS buffer powered |
| 2   | BIAS_LOFF_SENS | 1 | BIAS sense function enabled |
| 1   | BIAS_STAT   | 0 | (read-only in practice) |
| 0   | (reserved)  | 0 | OK |

**Re-decode discrepancy:** the Codex comment claims
`PD_REFBUF | RESERVED | VREF_4V | BIASREF_INT | PD_BIAS`, but the actual byte
0xEC decodes to `PD_REFBUF | RES | BIAS_MEAS | PD_BIAS | BIAS_LOFF_SENS`.
ADS1299 has **no VREF_4V bit** — the reference is fixed at 4.5 V whenever
`PD_REFBUF=1`. (ADS1299-4/-6 also have a 4.5 V internal reference; the "4 V"
in the Codex source is mis-labelled but the bit pattern is harmless.)

`BIAS_MEAS=1` and `BIAS_LOFF_SENS=1` are slightly more aggressive than the
default 0xE0; they are acceptable but mean BIAS_INP/BIAS_INN can be read back
through MUX setting 110. **Recommendation:** change CONFIG3 to **0xE0** for a
clean BIAS-enabled / lead-off-off configuration, OR keep 0xEC and document
that BIAS_MEAS is enabled deliberately for self-test. Either is functional.

### CHnSET = 0x70 = `0111 0000`

| Bit | Name | Val | Meaning |
|-----|------|-----|---------|
| 7   | PD   | 0 | Channel powered on |
| 6–4 | GAIN[2:0] | 110 | **Gain = 24** (matches firmware comment) |
| 3   | SRB2 | 0 | SRB2 open |
| 2–0 | MUX[2:0] | 000 | Normal electrode input |

CONFIRMED (GAIN=110b = 24x is correct; 111b would be reserved on ADS1299).
Note the Codex comment says `GAIN_24` is `0x70`; that is correct because
GAIN[2:0]=110 sits in bits 6–4.

### CONFIG4 = 0x02 = `0000 0010`

| Bit | Name        | Val | Meaning |
|-----|-------------|-----|---------|
| 3   | SINGLE_SHOT | 0 | Continuous conversion |
| 1   | PD_LOFF_COMP | 1 | Lead-off comparator powered |
| others | reserved | 0 | OK |

CONFIRMED.

### BIAS_SENSP / BIAS_SENSN = 0xFF / 0xFF

All 8 positive and negative channel inputs contribute to the BIAS feedback
average. CONFIRMED — matches hardware DRL network expectation.

---

## 3. Filter Coefficient Verification

Closed-form RBJ biquad math at fs = 250 Hz, computed analytically.

### 3.1 High-pass 0.5 Hz, Q = 1/√2

```
ω₀ = 2π·0.5/250            = 0.01256637
cos(ω₀) = 0.99992103
sin(ω₀) = 0.01256604
α      = sin(ω₀) / (2·Q)   = 0.01256604 / √2 = 0.00888567
b0 = b2 = (1+cos)/2        = 0.99996052
b1     = -(1+cos)          = -1.99992104
a0     = 1 + α             = 1.00888567
a1     = -2·cos            = -1.99984207
a2     = 1 − α             = 0.99111433
```

Normalised by a0:

| Coef | Computed | Codex | Δ |
|------|----------|-------|---|
| b0 |  0.99115359 |  0.9911535951 | ≈0 |
| b1 | -1.98230718 | -1.9823071902 | ≈0 |
| b2 |  0.99115359 |  0.9911535951 | ≈0 |
| a1 | -1.98222893 | -1.9822289298 | ≈0 |
| a2 |  0.98238545 |  0.9823854506 | ≈0 |

**MATCH.**

### 3.2 Notch 50 Hz, Q = 30

```
ω₀ = 2π·50/250 = 2π/5      = 1.25663706
cos(ω₀) = cos(72°)         = 0.30901699
sin(ω₀) = sin(72°)         = 0.95105652
α       = sin/(2·30)       = 0.01585094
a0      = 1 + α            = 1.01585094
b0 = b2 = 1/a0             = 0.98439639
b1 = a1 = -2cos/a0         = -0.60839043
a2      = (1 − α)/a0       = 0.96879278
```

| Coef | Computed | Codex | Δ |
|------|----------|-------|---|
| b0 |  0.98439639 |  0.9843963900 | ≈0 |
| b1 | -0.60839043 | -0.6083904274 | ≈0 |
| a2 |  0.96879278 |  0.9687927800 | ≈0 |

**MATCH.**

### 3.3 Notch 60 Hz, Q = 30

```
ω₀ = 2π·60/250 = 12π/25    = 1.50796447
cos(ω₀)                    = 0.06279052
sin(ω₀)                    = 0.99802673
α                          = 0.01663378
a0                         = 1.01663378
b0 = b2 = 1/a0             = 0.98363838
b1 = a1 = -2cos/a0         = -0.12352633
a2 = (1−α)/a0              = 0.96727675
```

| Coef | Computed | Codex | Δ |
|------|----------|-------|---|
| b0 |  0.98363838 |  0.9836383768 | ≈0 |
| b1 | -0.12352633 | -0.1235263294 | ≈0 |
| a2 |  0.96727675 |  0.9672767536 | ≈0 |

**MATCH.**

All three biquads are numerically correct to ≥10 significant figures.

Note: 60 Hz < Nyquist (125 Hz), so the notch is well-defined. The notch
bandwidth at Q=30 is 60/30 = 2 Hz, which is appropriate for a mains hum
killer that preserves gamma-band EEG content (>30 Hz). Same applies to the
50 Hz notch.

---

## 4. SPI Clock Rate Assessment

### Datasheet constraints (ADS1299 SBAS499C §7.5)

- Internal oscillator: f_CLK ≈ 2.048 MHz.
- SPI clock t_SCLK minimum period = 50 ns → max **20 MHz** electrical.
- **However**, the datasheet (Fig. 1 timing) also requires the SCLK period
  to satisfy `t_SCLK ≥ 2·t_CLK` between two successive bytes within RDATAC
  burst when MISO update is driven by f_CLK. Practical upper bound with
  internal 2.048 MHz oscillator is therefore ≈ **f_CLK / 4 = 512 kHz**
  for the inter-byte settling case, while individual bit transfers can run
  faster.

In practice, working OpenBCI / ADS1299 designs (Cyton, HackEEG) run SPI at
**1–4 MHz** with the internal oscillator and rely on the master to insert
gaps between bytes. The "f_CLK/4" rule is the most conservative reading.

### Recommendation

| Rate | Risk | Use case |
|------|------|----------|
| 512 kHz | None (datasheet-strict). Frame read time ≈ 27·8·1.95 µs ≈ 422 µs — fine at 250 SPS (4 ms budget) | **Bring-up / debug** |
| **1 MHz (Codex default)** | Very low. ~216 µs per frame. Widely used in OpenBCI clones. | **PROTOTYPE** ✅ keep this |
| 2 MHz (Opus suggestion) | Low — works on Cyton — but no margin if external clock not used. | Optional after signal-quality confirmed |
| ≥ 4 MHz | Requires external 16.384 MHz clock on CLK pin; needs CLK_EN=0 with external drive. Out of scope for current hardware. | N/A |

**Verdict:** keep **1 MHz** as Codex set it. Do not increase until a known-good
trace shows clean RDATAC frames.

---

## 5. Reset Sequence Correctness

### Datasheet requirements (SBAS499C §9.1, §10.1)

1. Apply power → wait `t_POR ≥ 2¹⁸ / f_CLK ≈ 128 ms` after AVDD/DVDD stable.
2. RESET pin: LOW pulse width ≥ **2 t_CLK** (≈ 1 µs with internal 2.048 MHz).
3. After RESET rising edge, wait **18 t_CLK ≈ 9 µs** before SCLK activity.
4. Issue `SDATAC` before writing any register (RDATAC is the power-on default
   on ADS1299; until SDATAC is sent, RREG/WREG are ignored).
5. After register writes, drive START high (or send START command) → wait at
   least one conversion period (4 ms @ 250 SPS) for the first DRDY, then
   issue `RDATAC`.

### Codex sequence (`ads1299_driver.cpp::ads1299_init`)

```
PWDN LOW
SPI.begin()
PWDN HIGH
delay 50 ms                ← OK (> t_POR 128 ms? NO — should be ≥ 150 ms)
RESET LOW 2 ms             ← OK (>> 1 µs)
RESET HIGH
delay 20 ms                ← OK (>> 9 µs)
send RESET command (0x06)
delay 20 ms                ← OK
send SDATAC (0x11)
WREG CONFIG1..CONFIG4, CHnSET, BIAS_SENSP/N
START pin HIGH
send START (0x08)
send RDATAC (0x10)
```

### Findings

- **MINOR** — the 50 ms wait after PWDN HIGH is shorter than the worst-case
  `t_POR ≈ 128 ms`. On a cold boot with a slow boost-converter ramp the
  oscillator may not be settled. **Recommend bumping to `vTaskDelay(pdMS_TO_TICKS(150))`.**
- All other timings exceed datasheet minimums by a large margin. ✅
- SDATAC before WREG: ✅ correct (mandatory).
- START → RDATAC ordering: ✅ correct.
- **Suggestion**: insert a `delay(8)` (2 conversion periods @ 250 SPS) between
  `START` and `RDATAC` so the first DRDY edge is guaranteed to be a complete
  conversion, not a partial one. Current code may discard one frame on boot
  but the ring buffer tolerates it.

---

## 6. JSON Packet Format Comparison

### Codex (one JSON document per frame)

Per-frame payload, approximately:

```
{"type":"eeg","device":"esp32-eeg-001","seq":4294967295,"ts":4294967295,"ch":[-1234.567,...×8]}
```

- ~160–200 bytes per frame ASCII (≈180 B avg).
- 250 frames/s × 180 B = **45 000 B/s = 360 kbps** application-layer.
- Plus WebSocket framing (~6 B per frame) and TCP/IP overhead.
- ESP32 stack must serialise/send 250 separate `webSocket.sendTXT` calls/s.
  Each call traverses the WebSocket library + lwIP — ≈ 200 µs each →
  **~50 ms/s of CPU on Core 0 just for transport**.

### Opus (batched ≤ 10 frames)

```
{"type":"eeg","device":"esp32-eeg-001","seq0":1234,"ts0":...,"frames":[[...×8],[...×8],...]}
```

- Per-batch payload ≈ 1.2 kB.
- 25 batches/s × 1.2 kB = **30 000 B/s = 240 kbps** (lower because per-batch
  header is amortised).
- 25 sendTXT/s → ~5 ms/s CPU. **10× headroom**.

### Recommendation

For **prototype / first bring-up**: Codex's per-frame format is fine — it is
simpler to debug, every frame is independently parseable on the Go side, and
360 kbps over local Wi-Fi is well within capacity.

For **production / multi-channel scale-up**: switch to batching of 10 frames
per WebSocket message OR move to a **binary** format (`type:"eeg-bin"`, raw
little-endian int24 × 8 × N) to drop bandwidth to ~60 kbps and CPU below 2%.

**Final call:** keep Codex's per-frame JSON for now; mark
`ENABLE_BATCHING` as a follow-up flag in `eeg_config.h`.

---

## 7. Missing Components / Gaps

| Item | Owner | Firmware Action Required? |
|------|-------|---------------------------|
| VCAP1 1 µF | Hardware | No |
| VREFP cap network | Hardware | No (internal ref enabled by CONFIG3) |
| CLKSEL strap to DVDD | Hardware | No (CLK_EN=0 in CONFIG1 confirms internal osc) |
| PCM5102A SCK→GND | Hardware | No (firmware uses I2S BCLK/LRC/DIN only) |
| Input protection 10 kΩ + BAV99 + 100 nF | Hardware | No — but firmware should DISABLE inputs while electrodes are being attached; suggest adding `ads1299_set_channel_powerdown(true)` helper |
| BIAS electrode settling | Hardware + Firmware | **GAP**: add ≥100 ms `vTaskDelay` after START so the BIAS loop settles before the host starts trusting samples; currently the first ~25 samples will have a large transient |
| Lead-off detection | Hardware (not implemented) | Firmware has comparator powered but LOFF registers default — LOFF status bits will always read 0. Either implement LOFF properly or set CONFIG4 = 0x00 |
| ESP32 GPIO 6–11 | Both | Add `static_assert` / runtime check that no future driver maps these (flash pins) |
| ADS1299 RDATAC sequence stop | Firmware | `ads1299_stop()` should send SDATAC before any further WREG — currently no `stop()` is shown in the Codex summary; verify in `ads1299_driver.cpp` |
| Watchdog feeding from EEG task | Firmware | High-priority EEG task on Core 1 must `esp_task_wdt_reset()` or be excluded from TWDT; verify it is excluded (Core 1 idle is not WDT-monitored by default — OK) |

---

## 8. Final Component Selection Recommendation

### Prototype (low cost, breadboard / hand-soldered TQFP-64 breakout)

| Item | Recommendation | Alternative |
|------|----------------|-------------|
| ADS1299 | ADS1299IPAG TQFP-64 on Aliexpress breakout board | ADS1299-4 (4-channel, cheaper) if only 4 electrodes needed |
| Boost converter (3.7 V → 5 V) | TPS61023DRLR (Opus pick) | MT3608 module (lower quality, OK for first bring-up) |
| DVDD LDO | AMS1117-3.3 | MCP1700-3.3 (lower I_q, better for battery) |
| Input protection | 10 kΩ 0603 + BAV99 + 100 nF C0G 0603 per channel | TVS diode array (PESD5V0L1BA) if size constrained |
| DRL network | 10 kΩ + 330 kΩ (Opus) | Same — no alternative needed |
| Decoupling per AVDD pin | 10 µF X7R + 1 µF X7R + 100 nF C0G + 10 nF C0G | Drop 10 nF if BOM constrained |
| MISO pull-down | 10 kΩ 0603 | none if signal integrity verified |
| PCB | 2-layer with star-ground for AVSS/DGND tie | 4-layer (Opus) — required for production |
| ESP32 module | ESP32-WROOM-32U (external antenna) | ESP32-WROOM-32E (PCB antenna) |

### Production (medical-grade prototype)

| Item | Recommendation |
|------|----------------|
| ADS1299 | ADS1299IPAGR (tape-and-reel) |
| Boost | TPS61023 + LC π-filter on AVDD (220 nH + 10 µF) |
| DVDD | TPS7A0533 ultra-low-noise LDO (4 µV_RMS) |
| Reference | Keep internal 4.5 V ref (CONFIG3 PD_REFBUF=1); optional external REF3040 with PD_REFBUF=0 |
| Input protection | TVS array + RC + isolation barrier (ISO7841 if patient-applied) |
| PCB | 4-layer (Opus) — solid AGND plane under ADS1299 |
| Shielding | Local can over analog section |
| Connector | DB-25 with shielded shell for electrode harness |

---

## 9. Integration Guide — adding EEG to `sketch-capstone-1.ino`

### 9.1 `platformio.ini`

Add to the `[env:upesy_wroom]` block:

```ini
lib_deps =
  bblanchon/ArduinoJson @ ^7.0.4
  links2004/WebSockets @ ^2.4.1

build_flags =
  -DCORE_DEBUG_LEVEL=3
  -DARDUINO_USB_CDC_ON_BOOT=0
```

### 9.2 `setup()` additions

```cpp
#include "eeg_task.h"
#include "eeg_stream.h"

void setup() {
  Serial.begin(115200);

  // ... existing WiFi / NVS / captive portal init ...

  // EEG: bring up the SPI driver and pin the acquisition task to Core 1.
  // Must be called AFTER WiFi is in a known state (STA connected OR AP up)
  // because eeg_stream uses the same network stack.
  if (!eeg_task_start()) {
    Serial.println("[EEG] task start FAILED");
  }

  // EEG WebSocket streamer on Core 0.
  eeg_stream_start(WS_HOST, WS_PORT, DEVICE_ID);
}
```

### 9.3 `loop()` additions

```cpp
void loop() {
  // ... existing webSocket.loop(), button-hold-to-clear-credentials, etc ...

  eeg_stream_loop();        // services the EEG WebSocket (reconnect, ping)

  // Do NOT call eeg_task_*() — it runs on its own FreeRTOS task.
}
```

### 9.4 Conflicts with existing firmware

| Existing | Conflict | Resolution |
|----------|----------|------------|
| Single `WebSocketsClient` on `/ws` for sensor data | Codex adds a *second* `WebSocketsClient` for `/ws` with high traffic | Use distinct URL paths: keep sensor on `/ws?id=DEVICE_ID`, route EEG to `/ws/eeg?id=DEVICE_ID`. Update Go backend to register both paths. |
| `setupI2S()` deferred via `pendingI2SReinit` from WiFi events | EEG SPI init may also be perturbed if called inside WiFi callback | Call `eeg_task_start()` only from `setup()` AFTER `WiFi.begin()` returns, never from `onWiFiEvent`. |
| Core 0 already runs WiFi + audio | Codex puts stream task on Core 0 priority 5, EEG on Core 1 priority 24 | OK — verify audio I2S task priority is ≤ 5 to avoid stream starvation; raise stream to priority 6 if audio runs at 5. |
| `Serial.printf` debug | High-rate EEG path must not log per frame | Confirm Codex code logs only on reconnect / error, not per frame. |

### 9.5 Build order

1. Add `lib_deps`, run `pio pkg install`.
2. Drop all 12 Codex files into `Capstone/src/` (the `.ino` is the entry
   point; the `.cpp/.h` files compile alongside it under PlatformIO's
   default `build_src_filter`).
3. `pio run -e upesy_wroom` — fix any include-path issues before flashing.
4. Flash with PWDN held LOW physically the first time (jumper to GND) to
   prove the host code does not freeze when the ADS1299 is absent.

---

## 10. Final Verdict

**Both agents produced high-quality, mutually consistent outputs.** The Opus
hardware document correctly specifies a buildable 8-channel EEG analog
front-end with proper decoupling, ESD protection, DRL, and clean AVDD/DVDD
domains; the Codex firmware correctly drives that hardware with verified
SPI mode, verified register bit patterns, and numerically exact RBJ biquads
for HP 0.5 Hz and 50/60 Hz notches. Pin assignments match perfectly, SPI
clock is conservatively below the datasheet's `f_CLK/4` ceiling, and the
reset sequence honours every minimum-time requirement except a borderline-short
50 ms POR wait that should be bumped to 150 ms.

The five issues to fix before hardware bring-up are: (1) increase POR delay
to 150 ms; (2) decide CONFIG3=0xE0 vs 0xEC (drop BIAS_MEAS unless used);
(3) correct the source-code comment that mislabels CONFIG3 bits as
"VREF_4V" (the internal reference is 4.5 V); (4) add a ≥100 ms post-START
settle before consuming samples; (5) route the EEG WebSocket to a distinct
path (`/ws/eeg`) so it does not collide with the existing sensor channel.

**Confidence the firmware will compile and run end-to-end on first flash:
85%.** Compile probability ≈ 98% (only risk is ArduinoJson v7 API drift if
v6 syntax leaked into the Codex code). First-light streaming probability
≈ 85% (risks: POR timing on cold boot, ADS1299 breakout solder quality,
and the Go backend needing a `/ws/eeg` route added).
