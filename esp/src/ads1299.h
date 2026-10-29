#pragma once
#include <stdbool.h>
#include <stdint.h>

/* ADS1299 di Board 1 (Analog EEG Board A v14, Cz-A1 + Cz-A2), lewat stack ke Board 2.
 *
 *   ESP32 (Board 2)          ADS1299 (Board 1)
 *   IO23 ─ R10 33Ω ─ MOSI →  DIN    (34)
 *   IO19 ─ R11 33Ω ─ MISO ←  DOUT   (43)
 *   IO18 ─ R12 33Ω ─ SCLK →  SCLK   (40)
 *   IO21           ─ CS_N →  CS     (39)
 *   IO34           ← DRDY    DRDY   (47)
 *   IO25           ─ START → START  (38)
 *   IO26         ─ RESET_N → RESET  (36)
 *   IO27          ─ PWDN_N → PWDN   (35)
 *
 * Analog: AVDD 5 V unipolar, VREFP internal 4.5 V. CLKSEL pull-up → clock internal 2.048 MHz.
 *   CH1 = IN1P Cz, IN1N A1   (Cz-A1)
 *   CH2 = IN2P Cz, IN2N A2   (Cz-A2)
 *   Chip ADS1299-4 (ID 0x3C, frame 15 byte); jumlah kanal dibaca dari ID.
 *   IN3..IN8 diikat ke AVDD lewat 0 Ω → kanal 3–4 dimatikan.
 *   Di Board 1: PWDN/RESET/START pull-down 10k (R13/R14/R15), CS pull-up 10k (R16),
 *   jadi chip mati sampai ESP menaikkan PWDN dan RESET.
 *   SRB1 ke GND → MISC1.SRB1 wajib 0 (kalau 1 semua input N terhubung ke GND).
 *   BIAS: BIASOUT/BIASINV + R24 1M ke elektroda BIAS, BIASREF tidak tersambung → BIASREF internal.
 *
 * Data dikirim ke backend sebagai pesan WebSocket biner, little-endian:
 *   off 0  u8   0xEE (magic)
 *   off 1  u8   versi = 1
 *   off 2  u16  n sampel
 *   off 4  u32  nomor urut sampel pertama
 *   off 8  u64  waktu sampel pertama (µs sejak boot, esp_timer)
 *   off 16 n × { u8 flag (bit0 = onset stimulus), i24 CH1, i24 CH2 }   ← i24 big-endian, apa adanya dari ADS
 * Laju sampel ADS_SPS, jadi waktu sampel ke-i = t0 + i × 1e6 / ADS_SPS.
 */

#define ADS_SPS          16000    /* CONFIG1 DR = 000; backend memakai Fs = 16000 */
#define ADS_GAIN         24
#define ADS_PKT_SAMPLES  160      /* 10 ms per pesan */

/* Reset, cek ID, tulis register. false = ADS1299 tidak terdeteksi (Board 1 tidak terpasang);
 * ads_poll() lalu mencoba lagi tiap 5 detik dan mengulang peringatan tiap 30 detik. */
bool ads_init(void);
bool ads_present(void);

/* Mulai / hentikan akuisisi (START + RDATAC) dan streaming ke backend. */
void ads_start(void);
void ads_stop(void);
bool ads_running(void);

/* Sinyal uji internal ADS (kotak ~1 Hz, amplitudo 1.875 mV) di CH1/CH2, untuk cek rantai tanpa elektroda. */
void ads_test_signal(bool on);

/* Dipanggil dari ISR I2S tepat saat blok audio berisi onset stimulus mulai diputar.
 * Sampel ADS berikutnya diberi flag stimulus. */
void ads_mark_stim_isr(void);

void ads_print_status(void);

/* Cek bring-up 7 langkah (GPIO, jalur MISO/DRDY, power-up, ID, register, laju DRDY,
 * data sinyal uji) dengan log tiap langkah ([CHECK]). Akuisisi dihentikan sementara. */
void ads_check(void);

/* Uji DRDY rinci: level dan tepi DRDY saat power-down, power-up 0..2 s, setelah reset,
 * START lewat kaki dan lewat perintah SPI, lalu kesimpulan ([DRDY]). */
void ads_drdy_test(void);

/* Pola SPI/RESET/START berulang selama seconds detik (default 20) untuk diukur osiloskop. */
void ads_scope(int seconds);

/* PWDN/RESET bergantian LOW/HIGH tiap 5 s selama seconds detik (default 60), untuk uji arus chip. */
void ads_pwdn_cycle(int seconds);

/* Ringkasan tiap 10 detik (DBG, hanya saat "debug on") + peringatan (selalu) (DRDY hilang, sampel terlewat, SPI, paket gagal,
 * onset tidak tertandai, saturasi) lewat LOG(), jadi ikut terbaca di /api/v1/logs.
 * onsets_played = jumlah onset stimulus yang sudah diputar (dari ISR I2S). */
bool ads_poll(uint32_t onsets_played);   /* true = ADS baru saja terdeteksi */

/* Coba deteksi ulang (Board 1 dicolok setelah boot). true kalau sekarang terdeteksi. */
bool ads_reprobe(void);
