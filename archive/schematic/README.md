# ESP-EEG v1 — rebuild KiCad (2 kanal, PCB 2 layer)

Project KiCad 10 hasil rebuild dari `v1_schematic.pdf` (Cerelog Inc.,
[ESP-EEG](https://github.com/Cerelog-ESP-EEG/ESP-EEG), `hardware/v1_schematic.pdf`).

PDF aslinya diekspor dari KiCad tapi **teksnya di-outline jadi vektor**, jadi tidak ada
netlist yang bisa diekstrak. Seluruh schematic ini digambar ulang dari hasil pembacaan
render PDF resolusi tinggi — bukan konversi otomatis.

## Lisensi

Schematic asli berlisensi **CC-BY-NC-SA 4.0** (Cerelog Inc.). Turunan ini:

- boleh dipakai/di-layout ulang untuk keperluan pribadi, riset, dan pendidikan
- **tidak boleh dijual** atau dipakai komersial
- wajib mencantumkan kredit ke Cerelog Inc. dan memakai lisensi yang sama

> **Bukan alat medis.** Riset/pengembangan saja. Selalu pakai daya baterai saat
> terhubung ke subjek manusia.

## Isi

| File | Keterangan |
|---|---|
| `eeg_v1.kicad_pro` / `eeg_v1.kicad_sch` | root project (buka file ini di KiCad) |
| `analog.kicad_sch` | ADS1299 + 2 kanal probe + BIAS/DRL + konektor elektroda |
| `power.kicad_sch` | USB-C charge, TP4056, proteksi DW01A/FS8205A, boost MT3608, rail ±2.5V |
| `mcu.kicad_sch` | socket 2×15 untuk DevKit ESP32-WROOM-32U + LED status |
| `eeg_v1.kicad_pcb` | **layout PCB 2 layer** (115 × 75 mm) |
| `eeg_v1_schematic.pdf`, `eeg_v1_pcb.pdf` | hasil plot |
| `eeg_v1.net` / `bom.csv` | netlist + BOM |
| `tools/` | generator Python yang membuat file `.kicad_sch` ini |

Status: **ERC 0 error**, **DRC 0 error** (clearance/short/courtyard), 103 komponen, 96 net.

## Perubahan dari v1 asli (sesuai permintaan)

| v1 asli | Dipakai di sini | Catatan |
|---|---|---|
| 8 kanal | **2 kanal** | IN3..IN8 (pin 1–12 ADS1299) diikat ke GND. GND di sini = mid-supply karena rail ±2.5V. Matikan kanal 3–8 lewat register CHnSET di firmware |
| `TPD4E1B06DCKR` ×4 (ESD 4-line) | `USBLC6-2SC6` ×3 (2-line) | 1 per kanal + 1 untuk BIAS/SRB1. Pin `VBUS` diikat ke AVDD, `GND` ke GND |
| `FS8205A` (SOP-8, pinout khusus) | dual N-MOSFET SOIC-8 (mis. `Si4936BDY`) | tidak ada symbol/footprint FS8205A di library standar; topologi back-to-back sama |
| `LM2664M6` (charge pump, −5V) | `ICL7660` ×2 **cascade** → −10V | supaya LM337 punya headroom |
| `TLV70025DDCR` (+2.5V) | `SPX3819M5-2.5` | pin BP diberi C 10nF ke GND |
| `TPS72325DBVR` (−2.5V) | `LM337` (SOT-223) | R110=120Ω, R111=120Ω → −1.25×(1+R111/R110) = **−2.5V** |
| ESP32-WROOM-32 onboard + CH340C + AMS1117 + USB-C data | **DevKit ESP32-WROOM-32U** di socket 2×15 | USB data, regulator 3V3, tombol EN/BOOT ikut DevKit. USB-C di board tinggal untuk charging |

### Kenapa ICL7660 di-cascade

LM337 butuh differential in→out minimal ~3V, sedangkan −5V→−2.5V cuma 2.5V — dan
ICL7660 (Zout ~55Ω) masih sag lagi di beban. Dua ICL7660 cascade (stage 2: `V+`=GND,
`GND`=−5V, `LV`=−5V, `VOUT`=−10V) memberi −10V, jadi headroom LM337 ~7.5V.
Disipasi kecil (~10mA × 7.5V ≈ 75mW). Divider 120Ω/120Ω juga sekaligus memenuhi
syarat beban minimum LM337 (≈10mA).

ERC akan memunculkan 1 warning `ground_pin_not_ground` pada pin GND ICL7660 stage 2 —
itu **memang benar** untuk konfigurasi cascade.

## Pemetaan pin ESP32 ↔ ADS1299

Diambil apa adanya dari header J2/J3 di v1 (yang di sana di-DNP karena pakai WROOM
onboard). Cocok dengan DevKit 30-pin DOIT/uPesy.

| Fungsi | GPIO | Socket |
|---|---|---|
| MOSI → `DIN` | GPIO23 | J202-15 |
| MISO ← `DOUT` | GPIO19 | J202-10 |
| SCLK | GPIO18 | J202-9 |
| `CS` | GPIO5 | J202-8 |
| `DRDY` | GPIO27 | J201-10 |
| `START` | GPIO14 | J201-11 |
| `RESET` | GPIO12 | J201-12 |
| `PWDN` | GPIO13 | J201-13 |
| `SRB1` | GPIO26 (DAC2) | J201-9 |
| `SRB2` | GPIO25 (DAC1) | J201-8 |
| LED status / data | GPIO17 / GPIO16 | J202-7 / J202-6 |
| +5V ke DevKit VIN | — | J201-15 |
| +3V3 dari DevKit | — | J202-1 |

`J201` = baris kiri DevKit (pin 1 = EN … pin 15 = VIN),
`J202` = baris kanan (pin 1 = 3V3 … pin 15 = GPIO23).
**Perhatikan saat bikin footprint:** kedua baris berjalan berlawanan arah pada socket fisik.

Pin DevKit yang tidak dipakai (GPIO2/4/15/21/22/32/33/34/35/36/39, UART0, EN) tetap
diberi label sebagai dokumentasi — ini sumber 14 warning `isolated_pin_label` di ERC.

## Keputusan interpretasi

Beberapa hal tidak 100% terbaca dari PDF dan diputuskan berdasarkan datasheet TI:

- **Jaringan BIAS/DRL**: R17 1M ∥ C17 1nF antara `BIASINV`–`BIASOUT` (feedback amp),
  R18 2k seri `BIASOUT`→elektroda, `BIASIN` disense dari `BIAS_PROBE`, `BIASREF`→GND.
  Di PDF tampak R 2k, R 1M (ERJ-2RKF1004X), dan 3× 1nF — nilai sama, topologi ini
  adalah konfigurasi standar ADS1299.
- **VCAP/VREF**: VREFP 10µF+0.1µF, VCAP1 1µF+100µF tantalum, VCAP2 1nF,
  VCAP3 1µF+0.1µF, VCAP4 0.1µF — sesuai part yang terbaca di PDF.
- **Refdes dinomori ulang** (analog 1–99, power 100–199, mcu 200–299). Penomoran v1
  tidak dipertahankan karena banyak label tertimpa dan tidak terbaca pasti.
- `SRB1`/`SRB2` ikut dibawa ke konektor elektroda (J1 pin 7/8); di v1 keduanya hanya
  sampai pin DAC ESP32.
- Konektor elektroda sekarang 2×5: `Probe_1-`, `Probe_1+`, `Probe_2-`, `Probe_2+`,
  `BIAS_PROBE` ×2, `SRB1`, `SRB2`, `GND` ×2.
- USB-C di board sekarang **charge-only** (D+/D− tetap disambung tapi tidak ke IC apa pun).


## PCB (2 layer)

`eeg_v1.kicad_pcb` — 115 × 75 mm, sudut rounded R4, 4 lubang M3.

Pembagian area:

```
+-------------------------------------------------------------+
|  [elektroda]  ESD+RC   ADS1299        socket DevKit ESP32    |
|      J1        D1-D3   U1 + dekopling     J201 / J202  LED   |
|---------------------------------------------------------------|
|      rail analog: SPX3819 (+2.5V)  ICL7660 x2  LM337 (-2.5V)  |
|---------------------------------------------------------------|
|  USB-C  TP4056  DW01A+MOSFET   MT3608 boost   switch          |
+---------------------------------------------------------------+
```

Aturan desain: trace sinyal 0.2 mm, power 0.4 mm, clearance netclass 0.14 mm (min fab JLCPCB 0.127 mm),
via 0.6/0.3 mm. Aman untuk fab murah (JLCPCB dll).

### ⚠️ Yang WAJIB Anda lakukan sebelum fabrikasi

1. **Buka PCB di KiCad lalu tekan `B`** untuk mengisi copper pour. GND *tidak*
   dirouting sebagai track — seluruh GND mengandalkan pour di F.Cu dan B.Cu.
   Sebelum diisi, DRC akan melaporkan ~88 pad GND "unconnected"; itu normal.
2. **Selesaikan 5 koneksi yang belum ter-routing** (autorouter menyerah di area
   padat sekitar QFP). Ratsnest-nya akan kelihatan di KiCad:
   `VCAP3 (U1.55–C13)`, `VCAP4 (U1.26–C15)`, `VREFP (U1.24–C9)`,
   `SCLK (U1.40–J202.9)`, `DRDY (U1.47–J201.10)`.
   Sisanya (2014 segmen, 123 via) sudah ter-routing.
3. **Review routing analog.** Board ini di-autoroute oleh router sederhana
   (maze/A*, `tools/router.py`). Netlist dan clearance-nya benar, tapi router
   tidak paham hal yang penting untuk EEG: jalur input probe sebaiknya pendek,
   simetris antar pasangan +/−, jauh dari jalur switching MT3608 dan dari
   kristal/antena ESP32. Minimal: cek ulang Probe_1±/Probe_2± dan area BIAS.
4. Jalur bentuknya masih tangga ortogonal (bukan 45°). Fungsional, tapi kalau
   mau rapi pakai *Route → Cleanup tracks* atau rutekan ulang manual.

### Status DRC

`kicad-cli pcb drc --severity-error` → 0 clearance, 0 short, 0 courtyard
overlap. Yang tersisa hanya `unconnected_items` (GND pour + 5 koneksi di atas).

### Regenerate PCB

```bash
python3 tools/buildpcb.py            # placement + autoroute -> eeg_v1.kicad_pcb
ROUTE=0 python3 tools/buildpcb.py    # placement saja, tanpa routing
```

`tools/buildpcb.py` berisi floorplan (koordinat tiap komponen),
`tools/pcb_core.py` menulis format `.kicad_pcb`, `tools/router.py` autorouter-nya.

## Yang belum dikerjakan

- Semua koneksi memakai **label per pin**, bukan wire yang digambar rapi. Netlist,
  ERC, dan export ke PCB benar, tapi tampilannya "label farm". Merapikan jadi wire
  manual bisa dilakukan langsung di Eeschema.
- Footprint sudah diisi untuk mayoritas part (0402/0805/SOT/SOIC). Beberapa masih
  kosong (USB-C, slide switch) — pilih sesuai part yang dibeli.
- Routing masih hasil autorouter — lihat catatan di bagian PCB.
- Belum ada gerber (`kicad-cli pcb export gerbers` setelah pour diisi).

## Regenerate

```bash
python3 tools/build.py          # tulis ulang *.kicad_sch
kicad-cli sch erc --severity-error --output /tmp/erc.txt eeg_v1.kicad_sch
python3 tools/audit.py          # dump semua net dari eeg_v1.net
```

`tools/build.py` berisi seluruh deskripsi rangkaian (komponen + net per pin);
`tools/gen_core.py` yang menulis format `.kicad_sch`.
