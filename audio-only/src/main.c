/* PCM5102A audio test — tone generator untuk ukur level (dB) output headphone.
 *
 * Peta pin sesuai skematik Board 2 (ESP32-DevKitC → GY-PCM5102):
 *   IO32 → BCK, IO33 → LRCK, IO14 → DIN. SCK modul tidak dipakai
 *   (PCM5102A pakai PLL internal dari BCK).
 *
 * Rantai analog: DAC (2.1 Vrms @ 0 dBFS) → R 22k / R 330 (≈ -36.6 dB)
 *   → trimpot RV1/RV3 → TDA1308 → jack PJ-320.
 *
 * Level diatur dalam dBFS (0 dBFS = sinus full scale). Gain digeser pelan
 * (ramp ~10 ms) supaya tidak ada klik saat level/frekuensi diganti.
 *
 * Perintah via serial monitor (115200), ketik lalu Enter:
 *   f <Hz>            frekuensi (20..20000), mis. "f 1000"
 *   l <dBFS>          level (0..-120), mis. "l -20"
 *   +  / -            naik / turun 1 dB  (++ / -- = 10 dB)
 *   c L|R|B           channel kiri / kanan / dua-duanya
 *   on / off          nyalakan / matikan tone (off juga menghentikan burst berulang)
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

#define PIN_BCK         32
#define PIN_LRCK        33
#define PIN_DIN         14

#define SAMPLE_RATE     48000
#define FRAMES_PER_BUF  240        /* 5 ms per blok */
#define DAC_FS_VRMS     2.1f       /* PCM5102A, sinus 0 dBFS */
#define DIVIDER_DB      (20.0f * log10f(330.0f / (22000.0f + 330.0f)))
#define RAMP_COEF       0.0021f    /* one-pole, τ ≈ 10 ms @ 48 kHz */
#define TWO_PI          6.283185307179586
#define PIN_BOOT        0
/* Batas atas level. Turunkan setelah level maksimum aman diketahui (lab/SLM),
 * sebelum driver dipasang ke telinga orang. */
#define LEVEL_MAX_DBFS  0.0f
#define STATUS_PERIOD_US 5000000


enum { CH_L = 1, CH_R = 2, CH_B = 3 };

/* Ditulis task konsol, dibaca task audio. Float/int 32-bit → aman tanpa lock. */
static volatile float g_freq     = 1000.0f;
static volatile float g_level_db = -40.0f;
static volatile int   g_channel  = CH_B;
static volatile bool  g_on       = true;

/* Burst: task konsol mengisi parameter lalu menaikkan g_burst_seq. Task audio
 * memainkannya dengan selubung sendiri (naik/turun 2 siklus, sin²) dan TANPA
 * ramp gain, jadi bagian datarnya tepat 10^(l/20) seperti tone kontinu. */
static volatile uint32_t g_burst_seq;
static volatile float    g_burst_flat_ms;
static volatile float    g_burst_rate;    /* burst per detik, 0 = sekali */
static volatile bool     g_burst_rep;     /* false → pengulangan berhenti */

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

    for (;;) {
        float amp    = powf(10.0f, g_level_db / 20.0f);
        float target = g_on ? amp : 0.0f;
        double step  = TWO_PI * g_freq / SAMPLE_RATE;
        int    ch    = g_channel;

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
            if (s > peak) peak = s;
            buf[2 * i]     = (ch & CH_L) ? s : 0;
            buf[2 * i + 1] = (ch & CH_R) ? s : 0;
            phase += step;
            if (phase >= TWO_PI) phase -= TWO_PI;
        }

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

static void print_status(void)
{
    float dac_vrms = DAC_FS_VRMS * powf(10.0f, g_level_db / 20.0f);
    LOG("STATUS", "%s  f=%.0f Hz  level=%.1f dBFS  ch=%s",
        g_on ? "ON " : "OFF", g_freq, g_level_db, ch_name(g_channel));
    LOG("STATUS", "  DAC out  ≈ %.2f mVrms (%.1f dBV)",
        dac_vrms * 1000.0f, 20.0f * log10f(dac_vrms));
    LOG("STATUS", "  setelah 22k/330 ≈ %.3f mVrms (%.1f dBV, pot maksimum)",
        dac_vrms * powf(10.0f, DIVIDER_DB / 20.0f) * 1000.0f,
        20.0f * log10f(dac_vrms) + DIVIDER_DB);
}

static void print_help(void)
{
    printf("\n  f <Hz> | l <dBFS> | + - ++ -- | c L/R/B | on | off\n"
           "  s [mulai akhir langkah detik]  (default s 0 -60 10 5)\n"
           "  b [datar_ms] [per_detik]  (default b 2000 sekali) | remote on/off\n"
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

static void handle_line(char *line)
{
    LOG("CMD", "%s", line);
    char  cmd[8] = {0};
    float a = 0, b = 0, c = 0, d = 0;
    int   n = sscanf(line, "%7s %f %f %f %f", cmd, &a, &b, &c, &d);
    if (n < 1) return;

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
    } else if (!strcmp(cmd, "on"))  { g_on = true; g_burst_rep = false;
    } else if (!strcmp(cmd, "off")) { g_on = false; g_burst_rep = false;
    } else if (!strcmp(cmd, "b")) {
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
    char js[320];
    int n = snprintf(js, sizeof(js),
        "{\"type\":\"audio_test\",\"device\":\"%s\",\"seq\":%lu,\"uptime_ms\":%lld,"
        "\"on\":%s,\"freq\":%.1f,\"level_dbfs\":%.1f,\"ch\":\"%s\"",
        NET_DEVICE_ID, (unsigned long)seq++, esp_timer_get_time() / 1000,
        g_on ? "true" : "false", g_freq, g_level_db, ch_name(g_channel));
    int mv, pct;
    if (battery_get(&mv, &pct))
        n += snprintf(js + n, sizeof(js) - n, ",\"bat_mv\":%d,\"bat_pct\":%d", mv, pct);
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
    printf("\n=== PCM5102A audio test ===\n");
    LOG("INFO", "pembagi 22k/330 = %.1f dB, DAC full scale %.1f Vrms", DIVIDER_DB, DAC_FS_VRMS);

    remote_q = xQueueCreate(4, 64);

    i2s_init();
    battery_init();
    xTaskCreatePinnedToCore(audio_task,   "audio",   4096, NULL, 10, NULL, 0);
    xTaskCreatePinnedToCore(console_task, "console", 4096, NULL, 2,  NULL, 1);

    print_status();
    print_help();

    gpio_set_direction(PIN_BOOT, GPIO_MODE_INPUT);
    gpio_set_pull_mode(PIN_BOOT, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(50));
    if (gpio_get_level(PIN_BOOT) == 0) net_forget_wifi();

    net_start(on_remote_command);   /* blok s/d ~15 detik per percobaan */
}
