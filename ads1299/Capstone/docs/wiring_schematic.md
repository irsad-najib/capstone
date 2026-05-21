# ADS1299 + ESP32-WROOM-32U EEG Wiring Schematic

This wiring note documents the module files in `include/` and `src/`. A sketch should connect WiFi first, then include `eeg_task.h` and `eeg_stream.h`, call `eeg_task_start()`, and call `eeg_stream_start()` after WiFi is connected.

## ASCII Block Diagram

```text
LiPo -> 5 V boost -> ADS1299 AVDD and 3.3 V low-noise LDO
                                      |-> ESP32-WROOM-32U, ADS1299 DVDD/IOVDD
Electrodes CH1-CH8 -> 10k -> BAV99 clamp + 100 nF -> ADS1299 INxP/INxN
DRL electrode <- DRL resistor/protection <- ADS1299 BIASOUT
ADS1299 SPI/DRDY/START/RESET/PWDN <-> ESP32
ESP32 I2S BCLK/LRC/DOUT -> PCM5102A -> audio output
ESP32 WiFi -> WebSocket backend ws://HOST:8080/ws?id=esp32-eeg-001
```

## Power Rail

| Net | Source pin | Destination pin | Component value / note |
| --- | --- | --- | --- |
| BAT+ | LiPo JST pin 1 | Boost VIN+ | 1-cell protected LiPo, fused if enclosure allows |
| BAT- | LiPo JST pin 2 | Boost VIN- / system GND | Star return to analog ground entry |
| +5V | Boost VOUT+ | 3.3 V LDO VIN, ADS1299 AVDD filter input, PCM5102A VIN if module expects 5 V | Add 22 uF low-ESR bulk capacitor at boost output |
| GND | Boost VOUT- | LDO GND, ESP32 GND, ADS1299 AVSS/DGND, PCM5102A GND | Use continuous ground plane with analog partitioning |
| +3V3 | LDO VOUT | ESP32 3V3, ADS1299 DVDD, ADS1299 IOVDD | Add 10 uF bulk and 100 nF local capacitor |
| AVDD | +5V through ferrite bead or low-noise analog filter | ADS1299 AVDD | Supports the configured 4.5 V internal reference; place 10 uF + 100 nF close to AVDD |
| AVSS | System GND | ADS1299 AVSS | Tie to analog ground plane close to ADS1299 |

## SPI Bus

| Net | Source pin | Destination pin | Component value / note |
| --- | --- | --- | --- |
| SCLK | ESP32 GPIO18 | ADS1299 SCLK | Keep short, optional 22-47 ohm series damping near ESP32 |
| MISO / DOUT | ADS1299 DOUT | ESP32 GPIO19 | 3.3 V logic |
| MOSI / DIN | ESP32 GPIO23 | ADS1299 DIN | 3.3 V logic |
| CS | ESP32 GPIO5 | ADS1299 CS | Pull up with 10 kOhm to IOVDD |

## Control Signals

| Net | Source pin | Destination pin | Component value / note |
| --- | --- | --- | --- |
| DRDY | ADS1299 DRDY | ESP32 GPIO34 | Falling-edge interrupt input, optional 10 kOhm pull-up if layout needs it |
| RESET | ESP32 GPIO32 | ADS1299 RESET | Pull up with 10 kOhm to IOVDD |
| PWDN | ESP32 GPIO33 | ADS1299 PWDN | Pull up with 10 kOhm to IOVDD for default awake state |
| START | ESP32 GPIO21 | ADS1299 START | Driven high for continuous conversions |
| CLKSEL | ADS1299 CLKSEL | IOVDD | Use internal oscillator unless an external clock is fitted |

## I2S DAC

| Net | Source pin | Destination pin | Component value / note |
| --- | --- | --- | --- |
| I2S BCLK | ESP32 GPIO26 | PCM5102A BCK | Already allocated by firmware |
| I2S LRC | ESP32 GPIO25 | PCM5102A LCK / LRCK | Already allocated by firmware |
| I2S DOUT | ESP32 GPIO22 | PCM5102A DIN | Already allocated by firmware |
| DAC VIN | +5V or +3V3 | PCM5102A VIN | Match the PCM5102A module regulator requirements |
| DAC GND | System GND | PCM5102A GND | Route away from electrode front-end inputs |

## Per-Channel EEG Inputs

Each channel uses the same input protection topology. Place the 10 kOhm resistor before the clamp, place BAV99 close to the ADS1299 pin, and place 100 nF after the resistor to analog ground to form the input RF shunt.

| Channel | Electrode net | Series resistor | Clamp | Filter capacitor | ADS1299 destination |
| --- | --- | --- | --- | --- | --- |
| CH1 | E1P/E1N | R101/R102, 10 kOhm | D101/D102 BAV99 to AVDD/AVSS | C101/C102, 100 nF to AVSS | IN1P/IN1N |
| CH2 | E2P/E2N | R201/R202, 10 kOhm | D201/D202 BAV99 to AVDD/AVSS | C201/C202, 100 nF to AVSS | IN2P/IN2N |
| CH3 | E3P/E3N | R301/R302, 10 kOhm | D301/D302 BAV99 to AVDD/AVSS | C301/C302, 100 nF to AVSS | IN3P/IN3N |
| CH4 | E4P/E4N | R401/R402, 10 kOhm | D401/D402 BAV99 to AVDD/AVSS | C401/C402, 100 nF to AVSS | IN4P/IN4N |
| CH5 | E5P/E5N | R501/R502, 10 kOhm | D501/D502 BAV99 to AVDD/AVSS | C501/C502, 100 nF to AVSS | IN5P/IN5N |
| CH6 | E6P/E6N | R601/R602, 10 kOhm | D601/D602 BAV99 to AVDD/AVSS | C601/C602, 100 nF to AVSS | IN6P/IN6N |
| CH7 | E7P/E7N | R701/R702, 10 kOhm | D701/D702 BAV99 to AVDD/AVSS | C701/C702, 100 nF to AVSS | IN7P/IN7N |
| CH8 | E8P/E8N | R801/R802, 10 kOhm | D801/D802 BAV99 to AVDD/AVSS | C801/C802, 100 nF to AVSS | IN8P/IN8N |

## DRL Output

| Net | Source pin | Destination pin | Component value / note |
| --- | --- | --- | --- |
| BIASOUT | ADS1299 BIASOUT | DRL stability network input | Firmware enables BIAS_SENSP and BIAS_SENSN for all eight channels |
| DRL_FB | ADS1299 BIASINV / BIASREF network | Bias amplifier feedback | Use datasheet-recommended feedback capacitor footprint, typically 1.5 nF to 10 nF for stability tuning |
| DRL_ELECTRODE | DRL output network | Right-leg / driven-reference electrode | 100 kOhm series patient-protection resistor plus same ESD topology as inputs |
| BIASREF | ADS1299 internal mid-supply | Bias amplifier reference | CONFIG3 selects internal bias reference |

## Decoupling Caps

| Net / pin | Capacitor | Placement |
| --- | --- | --- |
| AVDD to AVSS | 100 nF ceramic + 10 uF ceramic/tantalum | Within 2-3 mm of ADS1299 AVDD pins |
| DVDD to DGND | 100 nF ceramic + 1 uF ceramic | Within 2-3 mm of ADS1299 DVDD |
| IOVDD to DGND | 100 nF ceramic + 1 uF ceramic | Within 2-3 mm of ADS1299 IOVDD |
| VCAP1 to AVSS | 1 uF low-leakage ceramic | Dedicated trace, no external load |
| VCAP2 to AVSS | 1 uF low-leakage ceramic | Dedicated trace, no external load |
| VREFP/VREFN | 10 uF + 100 nF per datasheet reference layout | Keep reference loop short and quiet |
| ESP32 3V3 | 10 uF + 100 nF | Close to ESP32 module 3V3 entry |
| PCM5102A supply | 10 uF + 100 nF | Close to DAC module pins |

## BOM

| Reference | Description | Value / part number | Qty |
| --- | --- | --- | --- |
| U1 | WiFi MCU module | ESP32-WROOM-32U on upesy_wroom board | 1 |
| U2 | 8-channel EEG ADC | Texas Instruments ADS1299 | 1 |
| U3 | I2S DAC | PCM5102A module or IC circuit | 1 |
| U4 | 5 V boost regulator | Low-noise LiPo boost module | 1 |
| U5 | 3.3 V LDO regulator | Low-noise LDO, 500 mA class | 1 |
| J1 | Battery connector | 2-pin JST LiPo | 1 |
| J2-J9 | Electrode connectors | Touch-proof EEG connectors | 8 |
| J10 | DRL electrode connector | Touch-proof EEG connector | 1 |
| R101-R802 | Input series resistors | 10 kOhm, 1 percent | 16 |
| D101-D802 | ESD clamp diodes | BAV99 or low-leakage equivalent | 16 |
| C101-C802 | Input shunt capacitors | 100 nF C0G/X7R | 16 |
| R901 | DRL patient-protection resistor | 100 kOhm, 1 percent | 1 |
| C901 | DRL feedback capacitor footprint | 1.5 nF to 10 nF, tune for stability | 1 |
| R1-R4 | Digital pull-up resistors | 10 kOhm | 4 |
| C1-C12 | Local decoupling capacitors | 100 nF ceramic | 12 |
| C13-C20 | Bulk and reference capacitors | 1 uF to 22 uF as listed above | 8 |
| FB1 | Analog supply isolation | Ferrite bead or 10 ohm resistor | 1 |
