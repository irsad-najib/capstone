#pragma once
#include <stdbool.h>
#include <stdint.h>

/* Modul ADS1256 (kuning, kristal 7.68 MHz, VREF 2.5 V) + 2× modul AD620 (gain 20),
 * menggantikan Board 1 ADS1299. Driver diturunkan dari EEG_2ch_Acquire.ino.
 *
 *   ESP32 (Board 2)    ADS1256 modul
 *   IO23 ─ MOSI    →   DIN
 *   IO19 ─ MISO    ←   DOUT
 *   IO18 ─ SCLK    →   SCLK
 *   IO21 ─ CS_N    →   CS
 *   IO34 ← DRDY        DRDY
 *   IO26 ─ RESET_N →   RST
 *   IO27 ─ PDWN    →   PDWN (SYNC/PDWN, tetap HIGH)
 *   IO25 (START ADS1299) tidak dipakai: ADS1256 tidak punya START.
 *
 * Analog: AD620 #1 VOUT → 10 kΩ → AIN0, GND bawah → AIN1  (CH1 = Cz-A1, telinga kiri)
 *         AD620 #2 VOUT → 10 kΩ → AIN2, GND bawah → AIN3  (CH2 = Cz-A2, telinga kanan)
 *
 * ADS1256 hanya punya satu ADC, jadi direkam SATU kanal per sesi pada 15 kSPS (MUX tidak
 * dipindah per sampel). Kanal dipilih lewat "ads ch 1|2", atau otomatis dari "c L" / "c R"
 * (telinga yang diberi bunyi = telinga yang direkam, ipsilateral).
 *
 * Data dikirim ke backend sebagai pesan WebSocket biner versi 2, little-endian:
 *   off 0  u8   0xEE (magic)
 *   off 1  u8   versi = 2
 *   off 2  u16  n sampel
 *   off 4  u32  nomor urut sampel pertama
 *   off 8  u64  waktu sampel pertama (µs sejak boot, esp_timer)
 *   off 16 u16  laju sampel (ADS_SPS)
 *   off 18 u8   kanal aktif (1 = Cz-A1, 2 = Cz-A2, 0 = input dihubung-singkat)
 *   off 19 u8   PGA
 *   off 20 f32  µV per LSB di elektroda (sudah dibagi gain AD620)
 *   off 24 n × { u8 flag (bit0 = onset stimulus), i24 CH1, i24 CH2 }   ← i24 big-endian
 * CH1 selalu berisi kanal aktif, CH2 = 0.
 */

#define ADS_SPS          15000    /* DRATE 0xE0; backend memakai Fs = 15000 */
#define ADS_VREF         2.5f
#define ADS_AMP_GAIN     20.0f    /* gain modul AD620 (ganti kalau RG diganti: G = 1 + 49.4k/RG) */
#define ADS_PGA_DEFAULT  1
#define ADS_PKT_SAMPLES  150      /* 10 ms per pesan */
/* 1 = lewati cek ID saat init: streaming tetap jalan walau STATUS tidak terbaca 3
 * (mis. DOUT/CS bermasalah; data bisa 0 / -1). Hanya untuk uji koneksi ke backend. */
#define ADS_SKIP_ID_CHECK 1

/* Reset, cek ID (STATUS bit 7:4 = 3), tulis register, self-cal. false = ADS1256 tidak
 * terdeteksi; ads_poll() lalu mencoba lagi tiap 5 detik dan mengulang peringatan tiap 30 detik. */
bool ads_init(void);
bool ads_present(void);

/* Mulai / hentikan streaming ke backend. ADS1256 sendiri berkonversi terus. */
void ads_start(void);
void ads_stop(void);
bool ads_running(void);

/* Kanal aktif: 1 = AIN0-AIN1 (Cz-A1), 2 = AIN2-AIN3 (Cz-A2). Boleh dipanggil sebelum
 * ADS terdeteksi; nilainya dipakai saat init. */
void ads_select(int ch);
int  ads_channel(void);

/* PGA 1/2/4/8/16/32/64 dan buffer input. Buffer ON: rentang input 0..3 V (AVDD − 2 V). */
void ads_set_pga(int pga);
void ads_set_buffer(bool on);

/* Input dihubung-singkat (MUX AIN0−AIN0) untuk cek noise ADC tanpa AD620. */
void ads_short(bool on);

/* Dipanggil dari ISR I2S tepat saat blok audio berisi onset stimulus mulai diputar.
 * Sampel ADS berikutnya diberi flag stimulus. */
void ads_mark_stim_isr(void);

void ads_print_status(void);

/* Cek bring-up (GPIO, jalur MISO/DRDY, ID, register, laju DRDY, noise input pendek,
 * level DC AD620) dengan log tiap langkah ([CHECK]). Akuisisi dihentikan sementara. */
void ads_check(void);

/* Scan AIN0..AIN7 terhadap AINCOM dan pasangan AIN0-AIN1 / AIN2-AIN3, buffer ON lalu OFF,
 * dalam volt di input ADC (sama dengan ADS1256_Channel_Scan.ino). */
void ads_scan(void);

/* Ringkasan tiap 10 detik (DBG, hanya saat "debug on") + peringatan (selalu) (DRDY hilang,
 * sampel terlewat, paket gagal, onset tidak tertandai, saturasi) lewat LOG().
 * onsets_played = jumlah onset stimulus yang sudah diputar (dari ISR I2S). */
bool ads_poll(uint32_t onsets_played);   /* true = ADS baru saja terdeteksi */

/* Coba deteksi ulang (modul dinyalakan setelah ESP32 boot). true kalau sekarang terdeteksi. */
bool ads_reprobe(void);
