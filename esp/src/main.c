/* Firmware NeuroSound (Board 2 + Board 1): stimulus audio + akuisisi ABR, dan mode tes audio.
 *
 * Dua mode:
 *   abr   ADS1299 (Board 1, ads1299.c) streaming CH1 Cz-A1 / CH2 Cz-A2 16 kSPS ke backend.
 *         "on" memutar stimulus berkala (klik 100 µs atau tone burst 2-1-2), tiap onset
 *         ditandai pada sampel EEG. Level dari backend (set_db) masuk lewat perintah "db".
 *   tone  generator tone / burst untuk ukur level output (osiloskop, Youlean, SLM).
 * Saat boot: mode abr kalau ADS1299 terdeteksi, selain itu tone.
 *
 * Peta pin sesuai skematik Board 2 (ESP32-DevKitC → GY-PCM5102):
 *   IO32 → BCK, IO33 → LRCK, IO14 → DIN. SCK modul tidak dipakai
 *   (PCM5102A pakai PLL internal dari BCK). Pin ADS1299 dan baterai: ads1299.h, battery.h.
 *
 * Rantai analog: DAC (2.1 Vrms @ 0 dBFS) → R 22k / (R 330 ∥ trimpot 1k) (≈ -39.1 dB)
 *   → trimpot RV1/RV3 → TDA1308 → jack PJ-320.
 *
 * Level diatur dalam dBFS (0 dBFS = sinus full scale). Gain digeser pelan
 * (ramp ~10 ms) supaya tidak ada klik saat level/frekuensi diganti.
 *
 * Perintah via serial monitor (115200), ketik lalu Enter:
 *   abr / tone        pindah mode (s, p, b otomatis pindah ke tone)
 *   on / off          abr: mulai / hentikan stimulus. tone: nyalakan / matikan tone
 *   db <dB>           level stimulus dalam dB (dBFS = dB − DB_AT_0DBFS), pindah ke abr
 *   st click|burst    jenis stimulus abr (burst memakai frekuensi f)
 *   rate <per_s>      laju stimulus abr (default 11.1/s, dibulatkan ke kelipatan 5 ms)
 *   pol a|c|r         polaritas: alternating / condensation / rarefaction
 *   ads               status akuisisi;  ads test on|off = sinyal uji internal ADS
 *   ads check         cek bring-up 7 langkah dengan log [CHECK] (otomatis sekali saat
 *                     WebSocket pertama tersambung)
 *   ads drdy          uji DRDY rinci (power-down, power-up, reset, START kaki vs SPI)
 *   ads scope [detik] pola RESET/SPI/START berulang untuk diukur osiloskop (default 20 s)
 *   ads pwdn [detik]  PWDN bergantian LOW/HIGH tiap 5 s untuk uji arus chip (default 60 s)
 *   debug on|off      log debug (ditandai [DEBUG]): register ADS, ringkasan akuisisi tiap 10 s,
 *                     parameter stimulus. Tersimpan di NVS, ikut terkirim ke /api/v1/logs
 *   f <Hz>            frekuensi (20..20000), mis. "f 1000"
 *   l <dBFS>          level (0..-120), mis. "l -20"
 *   +  / -            naik / turun 1 dB  (++ / -- = 10 dB)
 *   c L|R|B           channel kiri / kanan / dua-duanya
 *   b [ms] [per_s]    tone burst di f & l saat ini: naik/turun 2 siklus, datar ms
 *                     (default b 2000 = burst uji 2 s). per_s > 0 = berulang,
 *                     mis. "b 0.5 20" = burst 2-1-2 di 2 kHz, 20 kali/detik
 *   remote on|off     terima / abaikan perintah dari backend
 *   s [a b d t]       step level dari a ke b, langkah d dB, tiap t detik
 *                     (default: s 0 -60 10 5). "s" lagi untuk berhenti
 *   p                 putar frekuensi audiometri 250..8000 Hz, 3 detik tiap step
 *   i2s               laju frame I2S, error write, sampel puncak
 *   bat               tegangan dan persen baterai (IO35)
 *   net               status WiFi / WebSocket
 *   wifi reset        hapus kredensial WiFi, restart ke mode portal
 *   ?                 status + bantuan
 *
 * Jaringan (net.c): WiFi dari NVS → default → AP "ESP32-Setup" + captive portal.
 * Setelah konek, status dikirim ke wss://capstone.irsad.site/ws tiap 5 detik,
 * dan backend bisa mengirim perintah yang sama lewat
 *   {"type":"command","cmd":"l -30"}   (mis. /api/v1/broadcast?msg=l%20-30)
 * Tahan tombol BOOT (GPIO0) saat boot → hapus kredensial WiFi.
 *
 * Audio jalan di Core 0 (sesuai CLAUDE.md), konsol di Core 1 prioritas rendah.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/i2s_std.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "net.h"
#include "battery.h"
#include "ads1299.h"

#define PIN_BCK         32
#define PIN_LRCK        33
#define PIN_DIN         14

#define SAMPLE_RATE     48000
#define FRAMES_PER_BUF  240        /* 5 ms per blok */
#define DAC_FS_VRMS     2.1f       /* PCM5102A, sinus 0 dBFS */
/* R2/R5 330 Ω paralel trimpot RV1/RV3 1 kΩ = 248 Ω terhadap R1/R4 22 kΩ */
#define DIV_SHUNT_OHM   (330.0f * 1000.0f / (330.0f + 1000.0f))
#define DIVIDER_DB      (20.0f * log10f(DIV_SHUNT_OHM / (22000.0f + DIV_SHUNT_OHM)))
#define RAMP_COEF       0.0021f    /* one-pole, τ ≈ 10 ms @ 48 kHz */
#define TWO_PI          6.283185307179586
#define PIN_BOOT        0
/* Batas atas level. Turunkan setelah level maksimum aman diketahui (lab/SLM),
 * sebelum driver dipasang ke telinga orang. */
#define LEVEL_MAX_DBFS  0.0f
#define STATUS_PERIOD_US 5000000
/* Level dB (dari frontend / perintah db) yang dipetakan ke 0 dBFS. BELUM TERKALIBRASI:
 * ganti dengan hasil pengukuran (SLM / ambang normal) sebelum angka dB dipakai di laporan. */
#define DB_AT_0DBFS     90.0f
#define CLICK_SAMPLES   5          /* 104 µs @ 48 kHz */


enum { CH_L = 1, CH_R = 2, CH_B = 3 };

/* Ditulis task konsol, dibaca task audio. Float/int 32-bit → aman tanpa lock. */
static volatile float g_freq     = 1000.0f;
static volatile float g_level_db = -40.0f;
static volatile int   g_channel  = CH_B;
static volatile bool  g_on       = false;

/* Burst: task konsol mengisi parameter lalu menaikkan g_burst_seq. Task audio
 * memainkannya dengan selubung sendiri (naik/turun 2 siklus, sin²) dan TANPA
 * ramp gain, jadi bagian datarnya tepat 10^(l/20) seperti tone kontinu. */
static volatile uint32_t g_burst_seq;
static volatile float    g_burst_flat_ms;
static volatile float    g_burst_rate;    /* burst per detik, 0 = sekali */
static volatile bool     g_burst_rep;     /* false → pengulangan berhenti */

/* Mode abr: stimulus berkala, onset selalu di awal blok I2S. Blok sebelum onset
 * diberi penanda di LSB sampel pertama (−192 dBFS, tidak terdengar); ISR on_sent
 * melihat penanda itu saat blok tersebut selesai = blok onset mulai diputar. */
enum { MODE_TONE, MODE_ABR };
enum { STIM_CLICK, STIM_BURST };
enum { POL_ALT, POL_COND, POL_RARE };
static volatile int   g_mode      = MODE_TONE;
static volatile bool  g_abr_on;
static volatile int   g_stim_type = STIM_CLICK;
static volatile float g_stim_rate = 11.1f;
static volatile int   g_polarity  = POL_ALT;
static volatile uint32_t g_onsets;   /* onset yang benar-benar diputar (dari ISR) */

/* Perintah dari backend boleh dimatikan selama sesi pasien ("remote off"). */
static volatile bool  g_remote_ok = true;

/* Diagnostik I2S: frame terkirim, error write, dan sampel puncak per status. */
static volatile uint32_t g_i2s_frames, g_i2s_errors;
static volatile int32_t  g_i2s_peak;

static i2s_chan_handle_t tx;
static int32_t           buf[FRAMES_PER_BUF * 2];

/* ------------------------------------------------------------------ */
/*  I2S + audio task                                                   */
/* ------------------------------------------------------------------ */
static bool IRAM_ATTR on_i2s_sent(i2s_chan_handle_t h, i2s_event_data_t *e, void *ctx)
{
    (void)h; (void)ctx;
    if (((const int32_t *)e->dma_buf)[0] & 1) {
        g_onsets++;
        ads_mark_stim_isr();
    }
    return false;
}

static int stim_period_blocks(void)
{
    int n = (int)lroundf(SAMPLE_RATE / g_stim_rate / FRAMES_PER_BUF);
    return n < 4 ? 4 : n;
}

static void i2s_init(void)
{
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num  = 8;        /* 40 ms cadangan saat WiFi/TLS sibuk */
    chan_cfg.dma_frame_num = FRAMES_PER_BUF;
    chan_cfg.auto_clear    = true;
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, &tx, NULL));

    i2s_std_config_t std_cfg = {
        .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,
                                                        I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = PIN_BCK,
            .ws   = PIN_LRCK,
            .dout = PIN_DIN,
            .din  = I2S_GPIO_UNUSED,
        },
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx, &std_cfg));
    i2s_event_callbacks_t cbs = { .on_sent = on_i2s_sent };
    ESP_ERROR_CHECK(i2s_channel_register_event_callback(tx, &cbs, NULL));
    ESP_ERROR_CHECK(i2s_channel_enable(tx));
    LOG("I2S", "OK  %d Hz, 32-bit stereo, BCK=%d LRCK=%d DIN=%d",
        SAMPLE_RATE, PIN_BCK, PIN_LRCK, PIN_DIN);
}

static void audio_task(void *arg)
{
    (void)arg;
    double phase = 0.0;
    float  gain  = 0.0f;   /* gain aktual, mengejar target */
    uint32_t burst_seen = g_burst_seq;
    int32_t  bpos = -1;    /* posisi sampel di dalam burst, -1 = tidak ada burst */
    int32_t  b_rise = 0, b_len = 0, b_period = 0;
    /* Stimulus abr */
    bool     abr_prev = false;
    uint32_t blk = 0;
    int32_t  spos = -1, s_rise = 0, s_len = 0;
    bool     s_click = true;
    float    s_sign = 1.0f;
    double   s_phase = 0.0;

    for (;;) {
        float amp    = powf(10.0f, g_level_db / 20.0f);
        float target = g_on ? amp : 0.0f;
        double step  = TWO_PI * g_freq / SAMPLE_RATE;
        int    ch    = g_channel;

        bool abr  = g_mode == MODE_ABR && g_abr_on;
        bool mark = false;
        if (abr) {
            if (!abr_prev) { blk = 0; s_sign = g_polarity == POL_RARE ? 1.0f : -1.0f; }
            int per = stim_period_blocks();
            if (blk > 0 && blk % per == 0) {
                s_click = g_stim_type == STIM_CLICK;
                if (s_click) {
                    s_rise = 0;
                    s_len  = CLICK_SAMPLES;
                } else {   /* tone burst 2-1-2 siklus */
                    s_rise = (int32_t)lroundf(2.0f * SAMPLE_RATE / g_freq);
                    if (s_rise < 1) s_rise = 1;
                    s_len  = (int32_t)lroundf(5.0f * SAMPLE_RATE / g_freq);
                }
                s_sign  = g_polarity == POL_COND ? 1.0f : g_polarity == POL_RARE ? -1.0f : -s_sign;
                s_phase = 0.0;
                spos    = 0;
            }
            mark = blk % per == (uint32_t)per - 1;
            blk++;
            gain = 0.0f;
            bpos = -1;
        } else {
            spos = -1;
        }
        abr_prev = abr;

        if (g_burst_seq != burst_seen) {
            burst_seen = g_burst_seq;
            b_rise   = (int32_t)lroundf(2.0f * SAMPLE_RATE / g_freq);
            if (b_rise < 1) b_rise = 1;
            b_len    = 2 * b_rise + (int32_t)lroundf(g_burst_flat_ms * SAMPLE_RATE / 1000.0f);
            b_period = g_burst_rate > 0.0f ? (int32_t)lroundf(SAMPLE_RATE / g_burst_rate) : 0;
            if (b_period && b_period < b_len) b_period = b_len;
            bpos  = 0;
            phase = 0.0;
            gain  = 0.0f;
        }

        int32_t peak = 0;
        for (int i = 0; i < FRAMES_PER_BUF; i++) {
            if (abr) {
                float v = 0.0f;
                if (spos >= 0) {
                    float env = 1.0f;
                    if (spos < s_rise) {
                        float x = sinf((float)M_PI_2 * spos / s_rise);
                        env = x * x;
                    } else if (spos >= s_len - s_rise && s_rise > 0) {
                        float x = sinf((float)M_PI_2 * (s_len - spos) / s_rise);
                        env = x * x;
                    }
                    v = (s_click ? 1.0f : sinf((float)s_phase)) * env * amp * s_sign;
                    s_phase += step;
                    if (++spos >= s_len) spos = -1;
                }
                int32_t s = (int32_t)(v * 2147483000.0f);
                if (abs(s) > peak) peak = abs(s);
                buf[2 * i]     = (ch & CH_L) ? s : 0;
                buf[2 * i + 1] = (ch & CH_R) ? s : 0;
                continue;
            }
            float g;
            if (bpos >= 0) {
                float env = 0.0f;
                if (bpos < b_rise) {
                    float x = sinf((float)M_PI_2 * bpos / b_rise);
                    env = x * x;
                } else if (bpos < b_len - b_rise) {
                    env = 1.0f;
                } else if (bpos < b_len) {
                    float x = sinf((float)M_PI_2 * (b_len - bpos) / b_rise);
                    env = x * x;
                }
                g = env * amp;
                if (++bpos >= (b_period ? b_period : b_len)) {
                    if (b_period && g_burst_rep) { bpos = 0; phase = 0.0; }
                    else bpos = -1;
                }
            } else {
                gain += (target - gain) * RAMP_COEF;
                g = gain;
            }
            int32_t s = (int32_t)(sinf((float)phase) * g * 2147483000.0f);
            if (abs(s) > peak) peak = abs(s);
            buf[2 * i]     = (ch & CH_L) ? s : 0;
            buf[2 * i + 1] = (ch & CH_R) ? s : 0;
            phase += step;
            if (phase >= TWO_PI) phase -= TWO_PI;
        }

        buf[0] = (buf[0] & ~1) | (mark ? 1 : 0);

        size_t written = 0;
        if (i2s_channel_write(tx, buf, sizeof(buf), &written, portMAX_DELAY) != ESP_OK)
            g_i2s_errors++;
        g_i2s_frames += written / (2 * sizeof(int32_t));
        if (peak > g_i2s_peak) g_i2s_peak = peak;
    }
}

/* ------------------------------------------------------------------ */
/*  Konsol                                                             */
/* ------------------------------------------------------------------ */
static const char *ch_name(int ch)
{
    return ch == CH_L ? "L" : ch == CH_R ? "R" : "L+R";
}

static void print_i2s_diag(void)
{
    static uint32_t last_frames;
    static int64_t  last_us;
    int64_t  now    = esp_timer_get_time();
    uint32_t frames = g_i2s_frames;
    float    rate   = last_us ? (frames - last_frames) * 1e6f / (float)(now - last_us) : 0.0f;
    float    peak   = g_i2s_peak / 2147483647.0f;
    LOG("I2S", "%.0f frame/s (harus ~%d)  error=%lu  puncak=%.1f dBFS",
        rate, SAMPLE_RATE, (unsigned long)g_i2s_errors,
        peak > 0 ? 20.0f * log10f(peak) : -999.0f);
    last_frames = frames;
    last_us     = now;
    g_i2s_peak  = 0;
}

static void print_battery(void)
{
    int mv, pct;
    if (battery_get(&mv, &pct)) LOG("BAT", "%d%%  (%.2f V)", pct, mv / 1000.0f);
    else                        LOG("BAT", "tidak terdeteksi");
}

static const char *stim_name(void)
{
    return g_stim_type == STIM_CLICK ? "klik 100 us" : "burst 2-1-2";
}

static const char *pol_name(void)
{
    return g_polarity == POL_ALT ? "alternating" : g_polarity == POL_COND ? "condensation" : "rarefaction";
}

static void print_status(void)
{
    float dac_vrms = DAC_FS_VRMS * powf(10.0f, g_level_db / 20.0f);
    if (g_mode == MODE_ABR) {
        LOG("STATUS", "ABR %s  %s  f=%.0f Hz  %.1f/s  %s  level=%.1f dBFS (%.0f dB)  ch=%s  onset=%lu",
            g_abr_on ? "ON " : "OFF", stim_name(), g_freq,
            SAMPLE_RATE / (float)(stim_period_blocks() * FRAMES_PER_BUF), pol_name(),
            g_level_db, g_level_db + DB_AT_0DBFS, ch_name(g_channel), (unsigned long)g_onsets);
        LOG("STATUS", "  akuisisi %s", !ads_present() ? "tidak ada (ADS1299 tidak terdeteksi)"
                                     : ads_running() ? "jalan" : "berhenti");
        return;
    }
    LOG("STATUS", "TONE %s  f=%.0f Hz  level=%.1f dBFS  ch=%s",
        g_on ? "ON " : "OFF", g_freq, g_level_db, ch_name(g_channel));
    LOG("STATUS", "  DAC out  ≈ %.2f mVrms (%.1f dBV)",
        dac_vrms * 1000.0f, 20.0f * log10f(dac_vrms));
    LOG("STATUS", "  setelah pembagi ≈ %.3f mVrms (%.1f dBV, pot maksimum)",
        dac_vrms * powf(10.0f, DIVIDER_DB / 20.0f) * 1000.0f,
        20.0f * log10f(dac_vrms) + DIVIDER_DB);
}

static void print_help(void)
{
    printf("\n  f <Hz> | l <dBFS> | + - ++ -- | c L/R/B | on | off\n"
           "  s [mulai akhir langkah detik]  (default s 0 -60 10 5)\n"
           "  b [datar_ms] [per_detik]  (default b 2000 sekali) | remote on/off\n"
           "  abr | tone | db <dB> | st click/burst | rate <per_s> | pol a/c/r | ads [check | drdy | scope | pwdn | test on/off]\n"
           "  debug on/off\n"
           "  p  (sweep 250/500/1k/2k/4k/8k Hz) | i2s | bat | net | wifi reset | ?  status\n\n");
}

static void set_level(float db)
{
    if (db > LEVEL_MAX_DBFS) db = LEVEL_MAX_DBFS;
    if (db < -120.0f) db = -120.0f;
    g_level_db = db;
}

/* Mode otomatis: step level atau sweep frekuensi. */
enum { AUTO_NONE, AUTO_STEP, AUTO_SWEEP };
static int     auto_mode;
static float   step_stop, step_inc;
static int64_t step_period_us, next_us;
static int     sweep_idx;
static const float sweep_freqs[] = { 250, 500, 1000, 2000, 4000, 8000 };
#define SWEEP_N (sizeof(sweep_freqs) / sizeof(sweep_freqs[0]))

static void auto_tick(void)
{
    if (auto_mode == AUTO_NONE || esp_timer_get_time() < next_us) return;
    next_us += step_period_us;

    if (auto_mode == AUTO_STEP) {
        float next = g_level_db - step_inc;
        if (next < step_stop - 0.01f) {
            auto_mode = AUTO_NONE;
            LOG("STEP", "selesai");
            return;
        }
        set_level(next);
        LOG("STEP", "level %.1f dBFS", g_level_db);
    } else {
        if (++sweep_idx >= (int)SWEEP_N) {
            auto_mode = AUTO_NONE;
            LOG("SWEEP", "selesai");
            return;
        }
        g_freq = sweep_freqs[sweep_idx];
        LOG("SWEEP", "f %.0f Hz  (%.1f dBFS)", g_freq, g_level_db);
    }
}

static void enter_tone(void)
{
    if (g_mode == MODE_TONE) return;
    g_abr_on = false;
    g_mode   = MODE_TONE;
    g_on     = false;
    ads_stop();
    LOG("MODE", "tone (tes audio)");
}

static void enter_abr(void)
{
    if (g_mode == MODE_ABR) return;
    auto_mode   = AUTO_NONE;
    g_on        = false;
    g_burst_rep = false;
    g_abr_on    = false;
    g_mode      = MODE_ABR;
    if (ads_present()) ads_start();
    else LOG("MODE", "ADS1299 tidak terdeteksi: stimulus tetap bisa diputar, tanpa rekaman EEG");
    LOG("MODE", "abr (ketik on untuk mulai stimulus)");
}

static void handle_line(char *line)
{
    LOG("CMD", "%s", line);
    char  cmd[8] = {0};
    float a = 0, b = 0, c = 0, d = 0;
    int   n = sscanf(line, "%7s %f %f %f %f", cmd, &a, &b, &c, &d);
    if (n < 1) return;
    if (battery_critical() && (!strcmp(cmd, "on") || !strcmp(cmd, "abr") || !strcmp(cmd, "db") ||
                               !strcmp(cmd, "b")  || !strcmp(cmd, "s")   || !strcmp(cmd, "p"))) {
        LOG("BAT", "ditolak: baterai kritis (< 3.3 V), isi ulang sampai > 3.6 V");
        return;
    }

    if (!strcmp(cmd, "f") && n >= 2) {
        if (a < 20.0f || a > 20000.0f) { LOG("ERR", "frekuensi 20..20000 Hz"); return; }
        g_freq = a;
    } else if (!strcmp(cmd, "l") && n >= 2) {
        set_level(a);
    } else if (!strcmp(cmd, "+"))  { set_level(g_level_db + 1);
    } else if (!strcmp(cmd, "-"))  { set_level(g_level_db - 1);
    } else if (!strcmp(cmd, "++")) { set_level(g_level_db + 10);
    } else if (!strcmp(cmd, "--")) { set_level(g_level_db - 10);
    } else if (!strcmp(cmd, "c")) {
        char ch = 0;
        sscanf(line, "%*s %c", &ch);
        if      (ch == 'L' || ch == 'l') g_channel = CH_L;
        else if (ch == 'R' || ch == 'r') g_channel = CH_R;
        else if (ch == 'B' || ch == 'b') g_channel = CH_B;
        else { LOG("ERR", "pakai c L / c R / c B"); return; }
    } else if (!strcmp(cmd, "debug")) {
        if      (strstr(line, "on"))  net_debug_set(true);
        else if (strstr(line, "off")) net_debug_set(false);
        else LOG("DEBUG", "mode debug %s", net_debug ? "NYALA" : "mati");
        return;
    } else if (!strcmp(cmd, "on")) {
        if (g_mode == MODE_ABR) {
            g_abr_on = true;
            DBG("ABR", "stimulus %s, periode %d blok (%.1f ms), polaritas %s, %.1f dBFS, ch %s, ADS %s",
                stim_name(), stim_period_blocks(), stim_period_blocks() * FRAMES_PER_BUF * 1000.0f / SAMPLE_RATE,
                pol_name(), g_level_db, ch_name(g_channel), ads_running() ? "jalan" : "tidak jalan");
        }
        else { g_on = true; g_burst_rep = false; }
    } else if (!strcmp(cmd, "off")) {
        g_abr_on = false; g_on = false; g_burst_rep = false;
    } else if (!strcmp(cmd, "abr"))  { enter_abr();
    } else if (!strcmp(cmd, "tone")) { enter_tone();
    } else if (!strcmp(cmd, "db") && n >= 2) {
        enter_abr();
        set_level(a - DB_AT_0DBFS);
        LOG("ABR", "%.0f dB → %.1f dBFS%s", a, g_level_db,
            g_level_db < a - DB_AT_0DBFS - 0.01f ? "  (dibatasi LEVEL_MAX_DBFS)" : "");
    } else if (!strcmp(cmd, "st")) {
        if      (strstr(line, "click")) g_stim_type = STIM_CLICK;
        else if (strstr(line, "burst")) g_stim_type = STIM_BURST;
        else { LOG("ERR", "pakai st click / st burst"); return; }
    } else if (!strcmp(cmd, "rate") && n >= 2) {
        if (a < 1.0f || a > 50.0f) { LOG("ERR", "rate 1..50 per detik"); return; }
        g_stim_rate = a;
    } else if (!strcmp(cmd, "pol")) {
        char pc = 0;
        sscanf(line, "%*s %c", &pc);
        if      (pc == 'a') g_polarity = POL_ALT;
        else if (pc == 'c') g_polarity = POL_COND;
        else if (pc == 'r') g_polarity = POL_RARE;
        else { LOG("ERR", "pakai pol a / pol c / pol r"); return; }
    } else if (!strcmp(cmd, "ads")) {
        if (strstr(line, "check")) { ads_check(); return; }
        if (strstr(line, "drdy"))  { ads_drdy_test(); return; }
        if (strstr(line, "pwdn"))  { int sec = 0; sscanf(line, "%*s %*s %d", &sec); ads_pwdn_cycle(sec); return; }
        if (strstr(line, "scope")) { int sec = 0; sscanf(line, "%*s %*s %d", &sec); ads_scope(sec); return; }
        if (!ads_present() && !ads_reprobe()) { ads_print_status(); return; }
        if      (strstr(line, "test on"))  ads_test_signal(true);
        else if (strstr(line, "test off")) ads_test_signal(false);
        ads_print_status();
        return;
    } else if (!strcmp(cmd, "b")) {
        enter_tone();
        float ms   = n >= 2 ? a : 2000.0f;
        float rate = n >= 3 ? b : 0.0f;
        if (ms < 0.0f || ms > 10000.0f || rate < 0.0f || rate > 100.0f) {
            LOG("ERR", "b [datar_ms 0..10000] [burst_per_detik 0..100]");
            return;
        }
        auto_mode       = AUTO_NONE;
        g_on            = false;
        g_burst_flat_ms = ms;
        g_burst_rate    = rate;
        g_burst_rep     = rate > 0.0f;
        g_burst_seq++;
        LOG("BURST", "%.0f Hz  %.1f dBFS  naik/turun %.2f ms  datar %.2f ms  %s",
            g_freq, g_level_db, 2000.0f / g_freq, ms,
            rate > 0.0f ? "berulang (off untuk berhenti)" : "sekali");
        if (rate > 0.0f) LOG("BURST", "  %.1f burst/detik", rate);
        return;
    } else if (!strcmp(cmd, "remote")) {
        if      (strstr(line, "off")) g_remote_ok = false;
        else if (strstr(line, "on"))  g_remote_ok = true;
        LOG("REMOTE", "perintah backend %s", g_remote_ok ? "diterima" : "diabaikan");
        return;
    } else if (!strcmp(cmd, "s")) {
        enter_tone();
        if (auto_mode == AUTO_STEP && n == 1) {
            auto_mode = AUTO_NONE;
            LOG("STEP", "dihentikan di %.1f dBFS", g_level_db);
            return;
        }
        float start = n >= 2 ? a : 0.0f;
        step_stop   = n >= 3 ? b : -60.0f;
        step_inc    = n >= 4 ? fabsf(c) : 10.0f;
        float sec   = n >= 5 ? d : 5.0f;
        if (step_inc < 0.1f || sec < 0.5f) { LOG("ERR", "langkah ≥0.1 dB, waktu ≥0.5 s"); return; }
        step_period_us = (int64_t)(sec * 1e6f);
        next_us   = esp_timer_get_time() + step_period_us;
        auto_mode = AUTO_STEP;
        g_on      = true;
        set_level(start);
        LOG("STEP", "%.1f → %.1f dBFS, langkah %.1f dB tiap %.1f s",
            g_level_db, step_stop, step_inc, sec);
    } else if (!strcmp(cmd, "p")) {
        enter_tone();
        sweep_idx      = 0;
        step_period_us = 3000000;
        next_us        = esp_timer_get_time() + step_period_us;
        auto_mode      = AUTO_SWEEP;
        g_on           = true;
        g_freq         = sweep_freqs[0];
        LOG("SWEEP", "f %.0f Hz  (%.1f dBFS)", g_freq, g_level_db);
        return;
    } else if (!strcmp(cmd, "i2s")) {
        print_i2s_diag();
        return;
    } else if (!strcmp(cmd, "bat")) {
        print_battery();
        return;
    } else if (!strcmp(cmd, "net")) {
        net_print_status();
        return;
    } else if (!strcmp(cmd, "wifi") && strstr(line, "reset")) {
        net_forget_wifi();
    } else if (!strcmp(cmd, "?")) {
        print_help();
        print_battery();
        net_print_status();
    } else {
        LOG("ERR", "perintah tidak dikenal: \"%s\"  (ketik ? untuk bantuan)", line);
        return;
    }
    print_status();
}

/* Perintah dari backend masuk antrian, dieksekusi di task konsol supaya
 * state mode otomatis hanya disentuh satu task. */
static QueueHandle_t remote_q;

static void on_remote_command(const char *cmd)
{
    char item[64];
    strlcpy(item, cmd, sizeof(item));
    xQueueSend(remote_q, item, 0);
}

static void send_status(void)
{
    static uint32_t seq;
    char js[512];
    int n = snprintf(js, sizeof(js),
        "{\"type\":\"audio_test\",\"device\":\"%s\",\"seq\":%lu,\"uptime_ms\":%lld,"
        "\"on\":%s,\"freq\":%.1f,\"level_dbfs\":%.1f,\"ch\":\"%s\","
        "\"mode\":\"%s\",\"stim\":\"%s\",\"rate\":%.1f,\"onsets\":%lu,\"ads\":%s,\"acq\":%s,\"debug\":%s",
        NET_DEVICE_ID, (unsigned long)seq++, esp_timer_get_time() / 1000,
        (g_mode == MODE_ABR ? g_abr_on : g_on) ? "true" : "false", g_freq, g_level_db, ch_name(g_channel),
        g_mode == MODE_ABR ? "abr" : "tone", g_stim_type == STIM_CLICK ? "click" : "burst",
        SAMPLE_RATE / (float)(stim_period_blocks() * FRAMES_PER_BUF), (unsigned long)g_onsets,
        ads_present() ? "true" : "false", ads_running() ? "true" : "false", net_debug ? "true" : "false");
    int mv, pct;
    if (battery_get(&mv, &pct))
        n += snprintf(js + n, sizeof(js) - n, ",\"bat_mv\":%d,\"bat_pct\":%d", mv, pct);
    n += snprintf(js + n, sizeof(js) - n, ",\"bat_critical\":%s", battery_critical() ? "true" : "false");
    n += snprintf(js + n, sizeof(js) - n, "}");
    net_ws_send(js, n);
}

static void console_task(void *arg)
{
    (void)arg;
    char line[64];
    int  len = 0;
    int64_t next_status = esp_timer_get_time() + STATUS_PERIOD_US;

    for (;;) {
        auto_tick();

        char remote[64];
        if (xQueueReceive(remote_q, remote, 0) == pdTRUE) {
            if (g_remote_ok) handle_line(remote);
            else LOG("REMOTE", "diabaikan: %s", remote);
        }

        if (esp_timer_get_time() >= next_status) {
            next_status += STATUS_PERIOD_US;
            send_status();
        }
        net_log_flush();
        battery_poll();
        static bool was_crit;
        bool crit = battery_critical();
        if (crit && !was_crit) {
            auto_mode   = AUTO_NONE;
            g_abr_on    = false;
            g_on        = false;
            g_burst_rep = false;
            ads_stop();
        }
        was_crit = crit;
        /* Cek ADS lengkap sekali saat WebSocket pertama tersambung, supaya hasilnya
         * terbaca di /api/v1/logs (log saat boot sering belum terkirim). */
        static bool checked;
        if (!checked && net_ws_connected()) {
            checked = true;
            vTaskDelay(pdMS_TO_TICKS(1000));
            ads_check();
            if (ads_present() && g_mode == MODE_TONE && !g_on && !battery_critical()) enter_abr();
        }
        if (ads_poll(g_onsets)) {
            if (g_mode == MODE_TONE && !g_on && !battery_critical()) enter_abr();
            else LOG("ADS", "ketik abr untuk mulai akuisisi");
        }

        int ch = fgetc(stdin);
        if (ch == EOF) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        if (ch == '\r' || ch == '\n') {
            if (len > 0) {
                line[len] = '\0';
                printf("\n");
                handle_line(line);
                len = 0;
            }
        } else if ((ch == '\b' || ch == 0x7f) && len > 0) {
            len--;
            printf("\b \b");
        } else if (len < (int)sizeof(line) - 1 && ch >= 0x20) {
            line[len++] = (char)ch;
            putchar(ch);   /* echo */
        }
        fflush(stdout);
    }
}

void app_main(void)
{
    setvbuf(stdin, NULL, _IONBF, 0);
    net_log_init();
    net_debug_load();
    printf("\n=== NeuroSound ESP32 (stimulus + ABR) ===\n");
    LOG("INFO", "pembagi 22k/(330∥1k) = %.1f dB, DAC full scale %.1f Vrms", DIVIDER_DB, DAC_FS_VRMS);

    remote_q = xQueueCreate(4, 64);

    i2s_init();
    battery_init();
    ads_init();
    bool have_ads = ads_present();
    xTaskCreatePinnedToCore(audio_task,   "audio",   4096, NULL, 10, NULL, 0);
    xTaskCreatePinnedToCore(console_task, "console", 4096, NULL, 2,  NULL, 1);

    /* Tanpa Board 1 tetap diam (driver bisa sudah di telinga); ketik on untuk tes audio. */
    if (have_ads) enter_abr();
    else          LOG("MODE", "tone, tanpa suara sampai diketik on");
    print_status();
    print_help();

    gpio_set_direction(PIN_BOOT, GPIO_MODE_INPUT);
    gpio_set_pull_mode(PIN_BOOT, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(50));
    if (gpio_get_level(PIN_BOOT) == 0) net_forget_wifi();

    net_start(on_remote_command);   /* blok s/d ~15 detik per percobaan */
}
