# Wiring: ESP32-WROOM-32U + AD620 + ADS1115

## Skema Lengkap

```
                    ┌─────────────┐
Elektroda (+) ──────┤ IN+ (pin 3) │
                    │             │
Elektroda (-) ──────┤ IN- (pin 2) │
                    │   AD620     │
     ┌──── Rg ─────┤ RG1 (pin 1) │
     └─────────────┤ RG2 (pin 8) │
                    │             │
  mid-supply ───────┤ REF (pin 5) │
  (1.65V)          │             │──── OUT (pin 6) ────► A0 (ADS1115)
                    │             │
     +3.3V ─────────┤ VS+ (pin 7) │
       GND ─────────┤ VS- (pin 4) │
                    └─────────────┘

                    ┌─────────────┐
      +3.3V ─────────┤ VDD         │
        GND ─────────┤ GND         │
  GPIO 21  ─────────┤ SDA         │   ADS1115
  GPIO 22  ─────────┤ SCL         │   (I2C addr: 0x48)
        GND ─────────┤ ADDR        │
  GPIO 34  ─────────┤ ALRT/DRDY   │
                    └─────────────┘
```

## Komponen & Nilai

| Komponen        | Nilai / Spesifikasi                        |
|-----------------|--------------------------------------------|
| Rg (gain AD620) | 49.9Ω → Gain ~1000 (untuk EEG 10–100µV)   |
|                 | 100Ω  → Gain ~495  (untuk EMG)             |
|                 | 499Ω  → Gain ~100  (untuk ECG)             |
| Mid-supply      | Voltage divider: 2× 10kΩ dari 3.3V ke GND |
|                 | Output divider = 1.65V → sambung ke REF    |
| Decoupling ADS  | 100nF ceramic di VDD ADS1115 (dekat pin)   |
| Decoupling AD620| 100nF ceramic di VS+ AD620 (dekat pin)     |
| Bias elektroda  | 10MΩ dari IN+ ke 1.65V mid-supply          |
|                 | 10MΩ dari IN- ke 1.65V mid-supply          |

## GPIO ESP32

| Fungsi   | GPIO |
|----------|------|
| I2C SDA  | 21   |
| I2C SCL  | 22   |
| ALRT/DRDY| 34   |

## Gain AD620

```
Gain = 1 + (49.4kΩ / Rg)

Rg = 49.9Ω  → Gain ≈ 1000   (EEG, sinyal 10–100µV)
Rg = 100Ω   → Gain ≈ 495    (EMG)
Rg = 499Ω   → Gain ≈ 100    (ECG, sinyal lebih besar)
```

## PGA Setting ADS1115

Sesuaikan dengan gain AD620:

| Gain AD620 | Sinyal max masuk | PGA ADS1115      | Kode               |
|------------|------------------|------------------|--------------------|
| 1000       | 100µV → 100mV    | ±0.256V          | `GAIN_SIXTEEN`     |
| 495        | 1mV   → 495mV    | ±0.512V          | `GAIN_EIGHT`       |
| 100        | 10mV  → 100mV    | ±0.256V          | `GAIN_SIXTEEN`     |

## Tips Noise

1. **Bias resistor wajib** — tanpa ini elektroda floating, output saturasi
2. **REF pin AD620** jangan floating — hubungkan ke mid-supply (1.65V)
3. **Star ground** — semua GND analog ketemu di 1 titik, baru konek ke ESP32 GND
4. **Decoupling cap** 100nF sedekat mungkin ke pin VDD chip
5. **WiFi ESP32** bisa inject noise — power analog dari rail terpisah jika perlu akurasi tinggi
6. **Kabel elektroda** — pakai twisted pair / shielded, panjang < 1 meter
