/* Driver ADS1299 + streaming sampel ke backend. Pin dan format paket: lihat ads1299.h.
 *
 * Alur data:
 *   DRDY (IO34, turun) → ISR → notifikasi ads_task (core 1, prioritas tertinggi)
 *   → baca 27 byte (status + 8 kanal) → ambil CH1/CH2 → isi paket 160 sampel
 *   → antrian → send_task (core 0) → WebSocket biner.
 * Kalau WebSocket putus atau antrian penuh, paket dibuang dan dihitung, akuisisi jalan terus.
 *
 * Penandaan stimulus: ISR I2S memanggil ads_mark_stim_isr() saat blok audio berisi onset
 * mulai diputar; sampel ADS yang dibaca sesudahnya diberi flag. Galat ≤ 1 sampel (62.5 µs)
 * ditambah latensi tetap filter digital PCM5102A (~0.5 ms), sama untuk tiap epoch.
 */

#include "ads1299.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "net.h"

#define PIN_MOSI   23
#define PIN_MISO   19
#define PIN_SCLK   18
#define PIN_CS     21
#define PIN_DRDY   34
#define PIN_START  25
#define PIN_RESET  26
#define PIN_PWDN   27

#define SPI_HOST_ID     SPI3_HOST
#define SPI_SLOW_HZ     1000000   /* register: jeda antar byte ≥ 4 tCLK (≈2 µs) */
#define SPI_FAST_HZ     4000000   /* baca data: 15 byte (ADS1299-4) ≈ 30 µs dari periode 62.5 µs */
#define FRAME_MAX       27        /* 3 status + 3 byte × kanal (4/6/8) */
#define POWERUP_MS      1000      /* tPOR + VCAP1 (C13 100 µF) > 1.1 V, sesuai spesifikasi board */

#define CMD_SDATAC  0x11
#define CMD_RDATAC  0x10
#define CMD_RREG    0x20
#define CMD_WREG    0x40

enum {
    REG_ID = 0x00, REG_CONFIG1, REG_CONFIG2, REG_CONFIG3, REG_LOFF,
    REG_CH1SET, REG_CH2SET, REG_CH3SET, REG_CH4SET, REG_CH5SET, REG_CH6SET, REG_CH7SET, REG_CH8SET,
    REG_BIAS_SENSP, REG_BIAS_SENSN, REG_LOFF_SENSP, REG_LOFF_SENSN, REG_LOFF_FLIP,
    REG_MISC1 = 0x15, REG_MISC2, REG_CONFIG4,
};

#define CONFIG1_16K      0x90   /* DR=000 → 16 kSPS, daisy off, CLK out off */
#define CONFIG2_NORMAL   0xC0
#define CONFIG2_TEST     0xD0   /* INT_CAL=1, 1×(VREFP−VREFN)/2400, fCLK/2^21 */
#define CONFIG3_REF      0xE0   /* buffer referensi internal ON */
#define CONFIG3_REF_BIAS 0xEC   /* + BIASREF internal + buffer BIAS ON */
#define CHSET_ON         0x60   /* gain 24, input normal, SRB2 off */
#define CHSET_TEST       0x65   /* gain 24, input = sinyal uji */
#define CHSET_OFF        0x81   /* power down, input dihubung-singkat */
#define BIAS_SENS_CH12   0x03   /* BIAS dari IN1/IN2 sisi P dan N */

#define PKT_HDR    16
#define PKT_BYTES  (PKT_HDR + ADS_PKT_SAMPLES * 7)
#define N_PKT      24           /* 240 ms cadangan saat TLS lambat */

typedef struct {
    uint16_t len;
    uint8_t  data[PKT_BYTES];
} pkt_t;

static spi_device_handle_t spi_slow, spi_fast;
static TaskHandle_t        ads_task_h;
static QueueHandle_t       free_q, full_q;
static pkt_t               pool[N_PKT];

static bool              s_present, s_test;
static volatile bool     s_running;
static volatile uint32_t s_stim_pending;
static uint8_t           s_id;
static int               s_nch = 4;               /* dari ID: Board 1 memakai ADS1299-4 */
static int               s_frame = 15;

/* Statistik, ditulis ads_task / send_task, dibaca konsol. */
static volatile uint32_t s_samples, s_missed, s_bad, s_dropped, s_timeouts, s_stims;
static volatile uint32_t s_sent, s_send_fail, s_offline;
static volatile int32_t  s_last[2];
static volatile uint32_t s_drdy_edges;   /* semua pulsa DRDY, untuk cek laju */
static volatile int32_t  s_min[2], s_max[2];   /* rentang per periode ringkasan, direset ads_poll */
static volatile bool     s_range_reset = true;

/* ------------------------------------------------------------------ */
/*  SPI                                                                */
/* ------------------------------------------------------------------ */
static void xfer(spi_device_handle_t dev, const uint8_t *tx, uint8_t *rx, size_t n)
{
    spi_transaction_t t = { .length = n * 8, .tx_buffer = tx, .rx_buffer = rx };
    gpio_set_level(PIN_CS, 0);
    spi_device_polling_transmit(dev, &t);
    esp_rom_delay_us(2);              /* tSCCS ≥ 4 tCLK sebelum CS naik */
    gpio_set_level(PIN_CS, 1);
}

static void cmd(uint8_t c)
{
    xfer(spi_slow, &c, NULL, 1);
    esp_rom_delay_us(5);
}

static uint8_t rreg(uint8_t reg)
{
    uint8_t tx[3] = { CMD_RREG | reg, 0x00, 0x00 }, rx[3] = {0};
    xfer(spi_slow, tx, rx, 3);
    return rx[2];
}

static void wreg(uint8_t reg, uint8_t val)
{
    uint8_t tx[3] = { CMD_WREG | reg, 0x00, val };
    xfer(spi_slow, tx, NULL, 3);
}

/* ------------------------------------------------------------------ */
/*  Akuisisi                                                           */
/* ------------------------------------------------------------------ */
static void IRAM_ATTR drdy_isr(void *arg)
{
    (void)arg;
    s_drdy_edges++;
    if (!ads_task_h) return;
    BaseType_t hp = pdFALSE;
    vTaskNotifyGiveFromISR(ads_task_h, &hp);
    if (hp) portYIELD_FROM_ISR();
}

void IRAM_ATTR ads_mark_stim_isr(void)
{
    s_stim_pending = 1;
}

static inline int32_t be24(const uint8_t *p)
{
    int32_t v = ((int32_t)p[0] << 16) | ((int32_t)p[1] << 8) | p[2];
    return (v << 8) >> 8;   /* perluas tanda 24 → 32 bit */
}

static pkt_t *cur;
static int    cur_n;

/* Kirim paket yang sedang diisi (boleh belum penuh). */
static void flush_pkt(void)
{
    if (!cur) return;
    if (cur_n == 0) {
        xQueueSend(free_q, &cur, 0);
    } else {
        uint16_t cnt = (uint16_t)cur_n;
        memcpy(cur->data + 2, &cnt, 2);
        cur->len = PKT_HDR + cur_n * 7;
        if (xQueueSend(full_q, &cur, 0) != pdTRUE) {
            s_dropped += cur_n;
            xQueueSend(free_q, &cur, 0);
        }
    }
    cur = NULL;
}

static void ads_task(void *arg)
{
    (void)arg;
    static const uint8_t tx[FRAME_MAX];
    static uint8_t       rx[FRAME_MAX];
    uint32_t seq = 0;

    for (;;) {
        uint32_t n = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(50));
        if (!s_running) {
            flush_pkt();
            continue;
        }
        if (n == 0) { s_timeouts++; continue; }
        if (n > 1) {
            /* Ada DRDY terlewat: tutup paket supaya waktu tiap sampel tetap benar. */
            flush_pkt();
            s_missed += n - 1;
            seq += n - 1;
        }

        int64_t t_us = esp_timer_get_time();
        xfer(spi_fast, tx, rx, s_frame);
        if ((rx[0] & 0xF0) != 0xC0) s_bad++;   /* byte status selalu 1100 xxxx */

        uint8_t flag = __atomic_exchange_n(&s_stim_pending, 0, __ATOMIC_SEQ_CST) ? 1 : 0;
        if (flag) s_stims++;
        s_last[0] = be24(rx + 3);
        s_last[1] = be24(rx + 6);
        if (s_range_reset) {
            s_range_reset = false;
            for (int c = 0; c < 2; c++) s_min[c] = s_max[c] = s_last[c];
        }
        for (int c = 0; c < 2; c++) {
            if (s_last[c] < s_min[c]) s_min[c] = s_last[c];
            if (s_last[c] > s_max[c]) s_max[c] = s_last[c];
        }
        s_samples++;

        if (!cur) {
            if (xQueueReceive(free_q, &cur, 0) != pdTRUE) {
                cur = NULL;
                s_dropped++;
                seq++;
                continue;
            }
            cur_n = 0;
            uint8_t *h = cur->data;
            h[0] = 0xEE;
            h[1] = 1;
            memcpy(h + 4, &seq, 4);
            memcpy(h + 8, &t_us, 8);
        }
        uint8_t *p = cur->data + PKT_HDR + cur_n * 7;
        p[0] = flag;
        memcpy(p + 1, rx + 3, 6);   /* CH1, CH2 apa adanya (i24 big-endian) */
        seq++;

        if (++cur_n == ADS_PKT_SAMPLES) flush_pkt();
    }
}

static void send_task(void *arg)
{
    (void)arg;
    pkt_t *p;
    for (;;) {
        xQueueReceive(full_q, &p, portMAX_DELAY);
        if (!net_ws_connected())                  s_offline++;
        else if (net_ws_send_bin(p->data, p->len)) s_sent++;
        else                                      s_send_fail++;
        xQueueSend(free_q, &p, 0);
    }
}

/* ------------------------------------------------------------------ */
/*  Konfigurasi                                                        */
/* ------------------------------------------------------------------ */
static bool write_config(bool verbose)
{
    static const struct { uint8_t reg, val; } base[] = {
        { REG_CONFIG1,    CONFIG1_16K },
        { REG_LOFF,       0x00 },
        { REG_CH3SET,     CHSET_OFF }, { REG_CH4SET, CHSET_OFF },
        { REG_BIAS_SENSP, BIAS_SENS_CH12 },
        { REG_BIAS_SENSN, BIAS_SENS_CH12 },
        { REG_LOFF_SENSP, 0x00 }, { REG_LOFF_SENSN, 0x00 }, { REG_LOFF_FLIP, 0x00 },
        { REG_MISC1,      0x00 },   /* SRB1 tersambung ke GND di Board 1: jangan diaktifkan */
        { REG_MISC2,      0x00 },
        { REG_CONFIG4,    0x00 },
        { REG_CONFIG3,    CONFIG3_REF_BIAS },
    };
    struct { uint8_t reg, val; } cfg[sizeof(base) / sizeof(base[0]) + 7];
    int n = 0;
    for (size_t i = 0; i < sizeof(base) / sizeof(base[0]); i++) {
        cfg[n].reg = base[i].reg;
        cfg[n].val = base[i].val;
        n++;
    }
    /* CH5–CH8 hanya ada di ADS1299-6/-8. */
    for (int c = 4; c < s_nch; c++) {
        cfg[n].reg = REG_CH1SET + c; cfg[n].val = CHSET_OFF; n++;
    }
    uint8_t ch = s_test ? CHSET_TEST : CHSET_ON;
    cfg[n].reg = REG_CONFIG2; cfg[n].val = s_test ? CONFIG2_TEST : CONFIG2_NORMAL; n++;
    cfg[n].reg = REG_CH1SET;  cfg[n].val = ch; n++;
    cfg[n].reg = REG_CH2SET;  cfg[n].val = ch; n++;

    for (int i = 0; i < n; i++) wreg(cfg[i].reg, cfg[i].val);

    int bad = 0;
    for (int i = 0; i < n; i++) {
        uint8_t got = rreg(cfg[i].reg);
        bool ok = got == cfg[i].val;
        if (!ok) bad++;
        if (verbose || !ok)
            LOG(verbose ? "CHECK" : "ADS", "  register 0x%02X  tulis 0x%02X  baca 0x%02X  %s",
                cfg[i].reg, cfg[i].val, got, ok ? "OK" : "BEDA");
    }
    if (verbose)
        LOG("CHECK", "  %d/%d register cocok%s", n - bad, n,
            bad ? "  → ID terbaca tapi tulis gagal: curigai MOSI IO23" : "");
    return bad == 0;
}

static void hw_init(void)
{
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << PIN_CS) | (1ULL << PIN_START) | (1ULL << PIN_RESET) | (1ULL << PIN_PWDN),
        .mode = GPIO_MODE_INPUT_OUTPUT,   /* bisa dibaca balik saat cek */
    };
    gpio_set_level(PIN_CS, 1);
    gpio_set_level(PIN_START, 0);
    gpio_config(&out);
    gpio_set_level(PIN_CS, 1);
    gpio_set_level(PIN_START, 0);
    gpio_set_level(PIN_PWDN, 1);
    gpio_set_level(PIN_RESET, 1);

    spi_bus_config_t bus = {
        .mosi_io_num = PIN_MOSI, .miso_io_num = PIN_MISO, .sclk_io_num = PIN_SCLK,
        .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = 32,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI_HOST_ID, &bus, SPI_DMA_DISABLED));
    spi_device_interface_config_t dev = {
        .mode = 1, .clock_speed_hz = SPI_SLOW_HZ, .spics_io_num = -1, .queue_size = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI_HOST_ID, &dev, &spi_slow));
    dev.clock_speed_hz = SPI_FAST_HZ;
    ESP_ERROR_CHECK(spi_bus_add_device(SPI_HOST_ID, &dev, &spi_fast));

    /* Pull-up lemah di MISO: DOUT ADS tri-state saat CS tinggi, jadi level diam
     * membedakan "tidak tersambung" (1) dari "tertarik ke GND / ADS tanpa daya" (0). */
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLUP_ONLY);

    gpio_config_t in = {
        .pin_bit_mask = 1ULL << PIN_DRDY,   /* IO34 input-only tanpa pull internal; DRDY push-pull dari ADS */
        .mode = GPIO_MODE_INPUT,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    gpio_config(&in);
    esp_err_t e = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
    if (e != ESP_OK && e != ESP_ERR_INVALID_STATE) ESP_ERROR_CHECK(e);
    gpio_isr_handler_add(PIN_DRDY, drdy_isr, NULL);
}

/* ID ADS1299: bit4 = 1, bit3:2 = 11 (ADS1299), bit1:0 = jumlah kanal 00/01/10 (4/6/8). */
static bool id_valid(uint8_t id)
{
    return (id & 0x1C) == 0x1C && (id & 0x03) != 0x03;
}

static void set_nch(uint8_t id)
{
    s_nch   = 4 + 2 * (id & 0x03);
    s_frame = 3 + 3 * s_nch;
}

/* Reset ADS lalu baca ID. true kalau ADS1299 (varian 4/6/8 kanal) menjawab.
 * wait_ms = tunggu power-on sebelum pulsa RESET (PWDN/RESET sudah HIGH sejak hw_init). */
static bool probe(int wait_ms)
{
    vTaskDelay(pdMS_TO_TICKS(wait_ms));
    gpio_set_level(PIN_RESET, 0);
    esp_rom_delay_us(20);
    gpio_set_level(PIN_RESET, 1);
    esp_rom_delay_us(100);
    cmd(CMD_SDATAC);
    s_id = rreg(REG_ID);
    if (!id_valid(s_id)) return false;
    set_nch(s_id);
    return true;
}

static void log_not_found(void)
{
    /* Baris log maks ~160 karakter (ring buffer net.c), jadi dipecah dua. */
    int idle = gpio_get_level(PIN_MISO);
    LOG("ADS", "PERINGATAN: ADS1299 tidak terdeteksi (ID 0x%02X, MISO diam=%d)", s_id, idle);
    if (s_id == 0xFF)
        LOG("ADS", "  MISO mengambang: Board 1 tidak tersambung, cek kabel stack SIGNAL");
    else if (idle == 0)
        LOG("ADS", "  MISO tertarik ke 0: Board 1 tanpa daya (LED 5V/3V3, stack POWER) atau IO19 short GND");
    else
        LOG("ADS", "  ADS tidak menjawab: cek CS IO21, SCLK IO18, MOSI IO23, RESET IO26, PWDN IO27");
}

static bool finish_init(void)
{
    if (s_present) return write_config(false);
    wreg(REG_CONFIG3, CONFIG3_REF);
    vTaskDelay(pdMS_TO_TICKS(150));   /* referensi internal stabil */

    bool ok = write_config(false);
    char dump[3 * 0x18 + 1];
    for (int r = 0; r < 0x18; r++) snprintf(dump + 3 * r, 4, "%02X ", rreg(r));
    DBG("ADS", "register 00..17: %s", dump);
    DBG("ADS", "pin MOSI %d MISO %d SCLK %d CS %d DRDY %d START %d RESET %d PWDN %d, SPI %d/%d kHz",
        PIN_MOSI, PIN_MISO, PIN_SCLK, PIN_CS, PIN_DRDY, PIN_START, PIN_RESET, PIN_PWDN,
        SPI_SLOW_HZ / 1000, SPI_FAST_HZ / 1000);
    LOG("ADS", "ADS1299 ID 0x%02X (ADS1299-%d), %d SPS, gain %d, CH1 Cz-A1 / CH2 Cz-A2  %s",
        s_id, s_nch, ADS_SPS, ADS_GAIN, ok ? "OK" : "ADA REGISTER GAGAL");

    free_q = xQueueCreate(N_PKT, sizeof(pkt_t *));
    full_q = xQueueCreate(N_PKT, sizeof(pkt_t *));
    for (int i = 0; i < N_PKT; i++) {
        pkt_t *p = &pool[i];
        xQueueSend(free_q, &p, 0);
    }
    xTaskCreatePinnedToCore(ads_task,  "ads",     4096, NULL, 20, &ads_task_h, 1);
    xTaskCreatePinnedToCore(send_task, "ads_tx",  4096, NULL, 5,  NULL,        0);

    s_present = true;
    return ok;
}

bool ads_init(void)
{
    hw_init();
    if (!probe(POWERUP_MS)) {
        log_not_found();
        return false;
    }
    return finish_init();
}

bool ads_reprobe(void)
{
    if (s_present) return true;
    if (!probe(150)) return false;
    LOG("ADS", "ADS1299 terdeteksi (Board 1 baru tersambung)");
    finish_init();
    return true;
}

bool ads_present(void) { return s_present; }
bool ads_running(void) { return s_running; }

void ads_start(void)
{
    if (!s_present || s_running) return;
    cmd(CMD_RDATAC);
    s_stim_pending = 0;
    s_running = true;
    gpio_set_level(PIN_START, 1);
    s_range_reset = true;
    LOG("ADS", "akuisisi mulai, streaming %d SPS ke backend", ADS_SPS);
}

void ads_stop(void)
{
    if (!s_present || !s_running) return;
    gpio_set_level(PIN_START, 0);
    s_running = false;
    vTaskDelay(pdMS_TO_TICKS(5));   /* biarkan ads_task menyelesaikan bacaan terakhir */
    cmd(CMD_SDATAC);
    LOG("ADS", "akuisisi berhenti");
}

void ads_test_signal(bool on)
{
    if (!s_present) { LOG("ADS", "ADS1299 tidak terdeteksi"); return; }
    bool was = s_running;
    ads_stop();
    s_test = on;
    bool ok = write_config(false);
    LOG("ADS", "input CH1/CH2: %s  %s", on ? "sinyal uji internal" : "elektroda", ok ? "OK" : "register gagal");
    if (was) ads_start();
}

void ads_print_status(void)
{
    if (!s_present) {
        log_not_found();
        return;
    }
    static uint32_t last_samples;
    static int64_t  last_us;
    int64_t  now = esp_timer_get_time();
    uint32_t smp = s_samples;
    float    sps = last_us ? (smp - last_samples) * 1e6f / (float)(now - last_us) : 0.0f;
    last_samples = smp;
    last_us      = now;

    const float uv_per_lsb = 4.5f / 8388608.0f / ADS_GAIN * 1e6f;
    LOG("ADS", "%s  input=%s  %.0f SPS (harus ~%d)  stimulus ditandai=%lu",
        s_running ? "JALAN" : "berhenti", s_test ? "uji" : "elektroda", sps, ADS_SPS,
        (unsigned long)s_stims);
    LOG("ADS", "  CH1 %.1f µV  CH2 %.1f µV  (sampel terakhir)",
        s_last[0] * uv_per_lsb, s_last[1] * uv_per_lsb);
    LOG("ADS", "  terlewat=%lu  status salah=%lu  timeout=%lu  dibuang=%lu",
        (unsigned long)s_missed, (unsigned long)s_bad, (unsigned long)s_timeouts, (unsigned long)s_dropped);
    LOG("ADS", "  paket terkirim=%lu  gagal=%lu  offline=%lu",
        (unsigned long)s_sent, (unsigned long)s_send_fail, (unsigned long)s_offline);
}

/* Ringkasan berkala (hanya saat debug) dan peringatan (selalu) ke log, ikut terkirim ke
 * backend /api/v1/logs. Panggil dari task konsol. */
#define POLL_US       10000000
#define RAIL_COUNTS   8000000   /* ~95% skala penuh: input saturasi / elektroda lepas */

#define REPROBE_US    5000000
#define MISSING_WARN_US 30000000

bool ads_poll(uint32_t onsets_played)
{
    static int64_t  next_us, last_us, next_probe_us, next_warn_us = MISSING_WARN_US;
    static uint32_t l_smp, l_miss, l_bad, l_drop, l_to, l_stim, l_sent, l_fail, l_off, l_onset;
    static bool     was_running;
    int64_t now = esp_timer_get_time();

    if (!s_present) {
        /* Board 1 bisa dicolok belakangan: coba deteksi ulang, peringatan diulang supaya
         * tetap terlihat di log backend walau baris saat boot sudah tergeser. */
        if (now >= next_probe_us) {
            next_probe_us = now + REPROBE_US;
            if (ads_reprobe()) return true;
        }
        if (now >= next_warn_us) {
            next_warn_us = now + MISSING_WARN_US;
            log_not_found();
        }
        return false;
    }

    if (s_running && !was_running) {   /* baru mulai: ringkasan pertama setelah 2 detik */
        next_us = now + 2000000;
        last_us = now;
        l_smp = s_samples; l_miss = s_missed; l_bad = s_bad; l_drop = s_dropped; l_to = s_timeouts;
        l_stim = s_stims; l_sent = s_sent; l_fail = s_send_fail; l_off = s_offline; l_onset = onsets_played;
    }
    was_running = s_running;
    if (!s_running || now < next_us) return false;
    next_us = now + POLL_US;

    uint32_t smp = s_samples - l_smp,   miss = s_missed - l_miss,    bad = s_bad - l_bad;
    uint32_t drop = s_dropped - l_drop, to = s_timeouts - l_to,      stim = s_stims - l_stim;
    uint32_t sent = s_sent - l_sent,    fail = s_send_fail - l_fail, off = s_offline - l_off;
    uint32_t onset = onsets_played - l_onset;
    float    sps = smp * 1e6f / (float)(now - last_us);
    l_smp = s_samples; l_miss = s_missed; l_bad = s_bad; l_drop = s_dropped; l_to = s_timeouts;
    l_stim = s_stims; l_sent = s_sent; l_fail = s_send_fail; l_off = s_offline; l_onset = onsets_played;
    last_us = now;

    const float uv = 4.5f / 8388608.0f / ADS_GAIN * 1e6f;
    int32_t mn[2] = { s_min[0], s_min[1] }, mx[2] = { s_max[0], s_max[1] };
    s_range_reset = true;

    DBG("ADS", "%.0f SPS  CH1 %.0f..%.0f µV  CH2 %.0f..%.0f µV  onset %lu/%lu  paket %lu",
        sps, mn[0] * uv, mx[0] * uv, mn[1] * uv, mx[1] * uv,
        (unsigned long)stim, (unsigned long)onset, (unsigned long)sent);

    if (smp == 0)
        LOG("ADS", "PERINGATAN: tidak ada DRDY (IO34). Cek START IO25, PWDN IO27, kabel stack SIGNAL");
    else if (sps < ADS_SPS * 0.98f)
        LOG("ADS", "PERINGATAN: laju %.0f SPS di bawah %d", sps, ADS_SPS);
    if (miss || to)
        LOG("ADS", "PERINGATAN: %lu sampel terlewat, %lu timeout (task ADS telat)", (unsigned long)miss, (unsigned long)to);
    if (bad)
        LOG("ADS", "PERINGATAN: %lu frame status salah (SPI MISO/SCLK, IO19/IO18)", (unsigned long)bad);
    if (drop)
        LOG("ADS", "PERINGATAN: %lu sampel dibuang (antrian paket penuh)", (unsigned long)drop);
    if (fail || off)
        LOG("ADS", "PERINGATAN: %lu paket gagal kirim, %lu paket dibuang karena WebSocket putus",
            (unsigned long)fail, (unsigned long)off);
    if (stim != onset)
        LOG("ADS", "PERINGATAN: onset diputar %lu tapi ditandai %lu", (unsigned long)onset, (unsigned long)stim);
    for (int c = 0; c < 2; c++) {
        if (mx[c] > RAIL_COUNTS || mn[c] < -RAIL_COUNTS)
            LOG("ADS", "PERINGATAN: CH%d saturasi (%s), cek elektroda %s dan BIAS", c + 1,
                mx[c] > RAIL_COUNTS ? "+" : "−", c == 0 ? "Cz/A1" : "Cz/A2");
    }
    return false;
}

/* ------------------------------------------------------------------ */
/*  Bring-up checker (perintah "ads check", otomatis saat WebSocket     */
/*  pertama kali tersambung). Pola sama dengan archive/ads-only.        */
/* ------------------------------------------------------------------ */
static const char *pull_verdict(int pu, int pd)
{
    if (pu == 1 && pd == 0) return "mengambang/tri-state (normal saat CS mati)";
    if (pu == 0 && pd == 0) return "tertarik ke GND: ADS tanpa daya (DVDD) atau short ke GND";
    if (pu == 1 && pd == 1) return "tertarik ke 3V3 / di-drive HIGH";
    return "aneh (pull-up 0, pull-down 1)";
}

void ads_check(void)
{
    bool was_running = s_running, was_test = s_test;
    int  fails = 0;
    if (s_present) ads_stop();
    const float uv = 4.5f / 8388608.0f / ADS_GAIN * 1e6f;

    LOG("CHECK", "==== ADS1299 bring-up (Board 1 lewat stack SIGNAL/POWER) ====");

    LOG("CHECK", "1/7 GPIO  MOSI %d  MISO %d  SCLK %d  CS %d  DRDY %d  START %d  RESET %d  PWDN %d",
        PIN_MOSI, PIN_MISO, PIN_SCLK, PIN_CS, PIN_DRDY, PIN_START, PIN_RESET, PIN_PWDN);
    gpio_set_level(PIN_CS, 1);
    gpio_set_level(PIN_START, 0);
    gpio_set_level(PIN_PWDN, 1);
    gpio_set_level(PIN_RESET, 1);
    LOG("CHECK", "  baca balik CS=%d START=%d RESET=%d PWDN=%d (harap 1 0 1 1)",
        gpio_get_level(PIN_CS), gpio_get_level(PIN_START), gpio_get_level(PIN_RESET), gpio_get_level(PIN_PWDN));
    LOG("CHECK", "  di Board 1 (pull-down R13/R14/R15, pull-up R16) ukur header SIGNAL ke GND:");
    LOG("CHECK", "  pin 5 CS ~3.3 V, pin 10 START ~0 V, pin 11 RESET ~3.3 V, pin 12 PWDN ~3.3 V");

    LOG("CHECK", "2/7 JALUR (CS mati)");
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(10));
    int pu = gpio_get_level(PIN_MISO);
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLDOWN_ONLY);
    vTaskDelay(pdMS_TO_TICKS(10));
    int pd = gpio_get_level(PIN_MISO);
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLUP_ONLY);
    LOG("CHECK", "  MISO IO%d pull-up=%d pull-down=%d → %s", PIN_MISO, pu, pd, pull_verdict(pu, pd));
    int drdy = gpio_get_level(PIN_DRDY);
    LOG("CHECK", "  DRDY IO%d = %d %s", PIN_DRDY, drdy,
        drdy ? "(HIGH, wajar saat diam)" : "(LOW: ADS tanpa daya, jalur DRDY putus, atau mengambang)");

    LOG("CHECK", "3/7 POWER-UP  PWDN HIGH, tunggu %d ms (tPOR + VCAP1), pulsa RESET, SDATAC", POWERUP_MS);
    vTaskDelay(pdMS_TO_TICKS(POWERUP_MS));
    gpio_set_level(PIN_RESET, 0);
    esp_rom_delay_us(20);
    gpio_set_level(PIN_RESET, 1);
    vTaskDelay(pdMS_TO_TICKS(5));
    cmd(CMD_SDATAC);
    drdy = gpio_get_level(PIN_DRDY);
    LOG("CHECK", "  DRDY setelah reset = %d %s", drdy, drdy ? "OK (di-drive HIGH)" : "CURIGA: chip tidak men-drive DRDY");
    if (!drdy) fails++;

    LOG("CHECK", "4/7 ID");
    uint8_t ids[3];
    for (int i = 0; i < 3; i++) ids[i] = rreg(REG_ID);
    s_id = ids[0];
    bool same = ids[0] == ids[1] && ids[1] == ids[2];
    LOG("CHECK", "  ID dibaca 3x: 0x%02X 0x%02X 0x%02X %s", ids[0], ids[1], ids[2], same ? "" : "(BERUBAH-UBAH)");
    if (!id_valid(ids[0]) || !same) {
        if (ids[0] == 0x00)
            LOG("CHECK", "  0x00 → DOUT ditarik LOW: ADS tanpa daya, atau CS IO%d / SCLK IO%d tidak sampai", PIN_CS, PIN_SCLK);
        else if (ids[0] == 0xFF)
            LOG("CHECK", "  0xFF → DOUT tidak di-drive (tertahan pull-up): Board 1 tidak tersambung / CS IO%d putus", PIN_CS);
        else
            LOG("CHECK", "  nilai salah/acak → sambungan goyang, MOSI IO%d salah, atau clock ADS mati", PIN_MOSI);
        /* Tetap coba START: kalau DRDY berdetak, clock dan jalur DRDY hidup dan masalahnya
         * di SPI (SCLK/MOSI/DOUT). Kalau diam, chip tidak berkonversi atau DRDY putus. */
        s_drdy_edges = 0;
        gpio_set_level(PIN_START, 1);
        vTaskDelay(pdMS_TO_TICKS(1000));
        int drdy_hi = gpio_get_level(PIN_DRDY);
        gpio_set_level(PIN_START, 0);
        uint32_t edges = s_drdy_edges;
        LOG("CHECK", "  tes START HIGH 1 s: DRDY %lu pulsa (harap ~%d dari reset = 250 SPS), level %d",
            (unsigned long)edges, 250, drdy_hi);
        if (edges > 100)
            LOG("CHECK", "  → clock + DRDY hidup: masalah di SPI. Cek SIGNAL pin 6 SCLK, 7 MOSI, 9 MISO, R10-R12");
        else
            LOG("CHECK", "  → DRDY diam: clock ADS mati (CLKSEL pin 52 harus HIGH) / DRDY pin 47 → SIGNAL pin 8 putus");
        LOG("CHECK", "  cek daya Board 1 di header POWER: pin 2/3 ~5 V (AVDD), pin 10/11 ~3.3 V (DVDD)");
        LOG("CHECK", "  lalu header SIGNAL (lihat langkah 1), VCAP1 (C13) > 1.1 V, orientasi chip/adapter");
        LOG("CHECK", "==== BERHENTI di langkah 4: ADS1299 tidak menjawab ====");
        return;
    }
    set_nch(ids[0]);
    LOG("CHECK", "  ADS1299-%d, revisi %d, frame %d byte  OK", s_nch, (ids[0] >> 5) & 0x07, s_frame);

    LOG("CHECK", "5/7 CONFIG  16 kSPS, gain 24, CH1/CH2 aktif, CH3-%d mati, BIAS internal, SRB1 off", s_nch);
    if (!s_present) finish_init();
    wreg(REG_CONFIG3, CONFIG3_REF);
    vTaskDelay(pdMS_TO_TICKS(150));
    s_test = false;
    if (!write_config(true)) fails++;

    LOG("CHECK", "6/7 RATE  START HIGH, hitung DRDY selama 1 detik");
    s_drdy_edges = 0;
    gpio_set_level(PIN_START, 1);
    vTaskDelay(pdMS_TO_TICKS(1000));
    gpio_set_level(PIN_START, 0);
    uint32_t sps = s_drdy_edges;
    bool rate_ok = sps > ADS_SPS * 0.95f && sps < ADS_SPS * 1.05f;
    LOG("CHECK", "  DRDY %lu pulsa/detik (harap ~%d)  %s", (unsigned long)sps, ADS_SPS, rate_ok ? "OK" : "GAGAL");
    if (sps == 0) LOG("CHECK", "  0 pulsa → cek START IO%d (kaki 38), DRDY IO%d (kaki 47), CLKSEL pull-up", PIN_START, PIN_DRDY);
    if (!rate_ok) fails++;

    LOG("CHECK", "7/7 DATA  sinyal uji internal 2 detik (kotak ~1 Hz, harap min/max ≈ −1875 / +1875 µV)");
    s_test = true;
    write_config(false);
    uint32_t smp0 = s_samples, bad0 = s_bad, miss0 = s_missed;
    ads_start();
    vTaskDelay(pdMS_TO_TICKS(2000));
    int32_t mn[2] = { s_min[0], s_min[1] }, mx[2] = { s_max[0], s_max[1] };
    uint32_t smp = s_samples - smp0, bad = s_bad - bad0, miss = s_missed - miss0;
    ads_stop();
    LOG("CHECK", "  %lu sampel (%.0f/s), status salah %lu, terlewat %lu",
        (unsigned long)smp, smp / 2.0f, (unsigned long)bad, (unsigned long)miss);
    for (int c = 0; c < 2; c++) {
        float lo = mn[c] * uv, hi = mx[c] * uv;
        bool ok = lo < -1500 && lo > -2300 && hi > 1500 && hi < 2300;
        LOG("CHECK", "  CH%d  min %.0f µV  max %.0f µV  %s", c + 1, lo, hi, ok ? "OK" : "BEDA");
        if (!ok) fails++;
    }
    if (bad) { LOG("CHECK", "  status salah → SPI MISO IO%d / SCLK IO%d tidak bersih", PIN_MISO, PIN_SCLK); fails++; }

    s_test = was_test;
    write_config(false);
    if (fails) LOG("CHECK", "==== SELESAI: %d pemeriksaan GAGAL, lihat baris di atas ====", fails);
    else       LOG("CHECK", "==== SELESAI: SEMUA OK, ADS1299 siap ====");
    if (was_running) ads_start();
}
