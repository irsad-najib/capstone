/* Driver ADS1256 + streaming sampel ke backend. Pin dan format paket: lihat ads1256.h.
 * Urutan perintah dan jeda diambil dari EEG_2ch_Acquire.ino yang sudah jalan di board ini.
 *
 * Alur data:
 *   DRDY (IO34, turun) → ISR → notifikasi ads_task (core 1, prioritas tertinggi)
 *   → RDATA, baca 3 byte kanal aktif → isi paket 150 sampel
 *   → antrian → send_task (core 0) → WebSocket biner.
 * Kalau WebSocket putus atau antrian penuh, paket dibuang dan dihitung, akuisisi jalan terus.
 *
 * ADS1256 berkonversi terus selama tidak STANDBY, jadi DRDY berdetak walau tidak streaming.
 * Interrupt DRDY hanya dinyalakan saat streaming (dan saat cek laju di ads_check) supaya
 * ads_task tidak bangun 15000×/detik tanpa guna.
 *
 * Penandaan stimulus: ISR I2S memanggil ads_mark_stim_isr() saat blok audio berisi onset
 * mulai diputar; sampel ADS yang dibaca sesudahnya diberi flag. Galat ≤ 1 sampel (66.7 µs)
 * ditambah latensi tetap filter digital PCM5102A (~0.5 ms) dan filter sinc ADS1256, sama
 * untuk tiap epoch.
 */

#include "ads1256.h"

#include <math.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "soc/gpio_reg.h"
#include "soc/soc.h"
#include "net.h"

#define PIN_MOSI   23
#define PIN_MISO   19
#define PIN_SCLK   18
#define PIN_CS     21
#define PIN_DRDY   34
#define PIN_RESET  26
#define PIN_PDWN   27

#define SPI_HOST_ID     SPI3_HOST
#define SPI_SLOW_HZ     1000000   /* register, sama dengan .ino */
#define SPI_FAST_HZ     1700000   /* baca data; maks fCLKIN/4 = 1.92 MHz. RDATA ≈ 30 µs dari 66.7 µs */
#define T6_US           7         /* jeda DIN→DOUT setelah RDATA/RREG: 50 τCLKIN = 6.5 µs */

#define CMD_WAKEUP  0x00
#define CMD_RDATA   0x01
#define CMD_RREG    0x10
#define CMD_WREG    0x50
#define CMD_SELFCAL 0xF0
#define CMD_SYNC    0xFC
#define CMD_RESET   0xFE

#define REG_STATUS  0x00
#define REG_MUX     0x01
#define REG_ADCON   0x02
#define REG_DRATE   0x03

#define STATUS_BUFEN 0x02
#define DRATE_15K    0xE0
#define MUX_CH1      0x01   /* AIN0 − AIN1: AD620 #1, Cz-A1 */
#define MUX_CH2      0x23   /* AIN2 − AIN3: AD620 #2, Cz-A2 */
#define MUX_SHORT    0x00   /* AIN0 − AIN0 */
#define MUX_AINCOM   0x08   /* NSEL = AINCOM, PSEL di bit 7:4 */

#define PKT_HDR    24
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

static bool              s_present, s_short, s_buffer = true;
static int               s_ch = 1, s_pga = ADS_PGA_DEFAULT;
static volatile bool     s_running;
static volatile uint32_t s_stim_pending;
static uint8_t           s_status;

/* Statistik, ditulis ads_task / send_task, dibaca konsol. */
static volatile uint32_t s_samples, s_missed, s_dropped, s_timeouts, s_stims;
static volatile uint32_t s_sent, s_send_fail, s_offline;
static volatile int32_t  s_last;
static volatile uint32_t s_drdy_edges;   /* pulsa DRDY saat interrupt nyala, untuk cek laju */
static volatile uint32_t s_glitches;     /* tepi turun palsu di DRDY yang ditolak ISR */
static volatile int64_t  s_last_edge;
static volatile uint32_t s_rd_max_us;    /* waktu RDATA terlama per periode ringkasan */
static volatile int32_t  s_min, s_max;   /* rentang per periode ringkasan, direset ads_poll */
static volatile int64_t  s_sum;
static volatile uint32_t s_sum_n;
static volatile bool     s_range_reset = true;

/* Volt per LSB di input ADC: skala penuh ±2·VREF/PGA. */
static float v_per_lsb(int pga) { return 2.0f * ADS_VREF / pga / 8388608.0f; }
/* µV per LSB di elektroda. */
static float uv_per_lsb(void)   { return v_per_lsb(s_pga) * 1e6f / ADS_AMP_GAIN; }

static uint8_t cur_mux(void)
{
    return s_short ? MUX_SHORT : s_ch == 2 ? MUX_CH2 : MUX_CH1;
}

static const char *ch_label(void)
{
    return s_short ? "input pendek" : s_ch == 2 ? "CH2 Cz-A2 (kanan)" : "CH1 Cz-A1 (kiri)";
}

/* ------------------------------------------------------------------ */
/*  SPI (CS manual supaya jeda t6 bisa disisipkan di tengah transaksi)  */
/* ------------------------------------------------------------------ */
static void spi_io(spi_device_handle_t dev, const uint8_t *tx, uint8_t *rx, size_t n)
{
    spi_transaction_t t = { .length = n * 8, .tx_buffer = tx, .rx_buffer = rx };
    spi_device_polling_transmit(dev, &t);
}

static void cmd(uint8_t c)
{
    gpio_set_level(PIN_CS, 0);
    esp_rom_delay_us(1);
    spi_io(spi_slow, &c, NULL, 1);
    esp_rom_delay_us(2);
    gpio_set_level(PIN_CS, 1);
    esp_rom_delay_us(4);   /* SYNC → WAKEUP ≥ 24 τCLKIN (3.1 µs) */
}

static uint8_t rreg(uint8_t reg)
{
    uint8_t tx[2] = { CMD_RREG | reg, 0x00 }, ff = 0xFF, v = 0;
    gpio_set_level(PIN_CS, 0);
    esp_rom_delay_us(1);
    spi_io(spi_slow, tx, NULL, 2);
    esp_rom_delay_us(T6_US + 3);
    spi_io(spi_slow, &ff, &v, 1);
    esp_rom_delay_us(2);
    gpio_set_level(PIN_CS, 1);
    esp_rom_delay_us(4);
    return v;
}

static void wreg(uint8_t reg, uint8_t val)
{
    uint8_t tx[3] = { CMD_WREG | reg, 0x00, val };
    gpio_set_level(PIN_CS, 0);
    esp_rom_delay_us(1);
    spi_io(spi_slow, tx, NULL, 3);
    esp_rom_delay_us(2);
    gpio_set_level(PIN_CS, 1);
    esp_rom_delay_us(4);
}

static inline int32_t be24(const uint8_t *p)
{
    int32_t v = ((int32_t)p[0] << 16) | ((int32_t)p[1] << 8) | p[2];
    return (v << 8) >> 8;   /* perluas tanda 24 → 32 bit */
}

/* RDATA: hasil konversi terakhir, 3 byte big-endian. raw boleh NULL. */
static int32_t rdata(uint8_t raw[3])
{
    static const uint8_t c = CMD_RDATA, ff[3] = { 0xFF, 0xFF, 0xFF };
    uint8_t rx[3];
    gpio_set_level(PIN_CS, 0);
    spi_io(spi_fast, &c, NULL, 1);
    esp_rom_delay_us(T6_US);
    spi_io(spi_fast, ff, rx, 3);
    gpio_set_level(PIN_CS, 1);
    if (raw) memcpy(raw, rx, 3);
    return be24(rx);
}

static bool wait_low(int64_t to_us)
{
    int64_t t0 = esp_timer_get_time();
    while (gpio_get_level(PIN_DRDY))
        if (esp_timer_get_time() - t0 > to_us) return false;
    return true;
}

/* Tepi turun DRDY. LOW harus bertahan ≥ 1 µs: derau sesaat dari SCLK/CS di kabel DRDY
 * jangan dianggap data baru (membaca saat data diperbarui = sampel rusak). */
static bool wait_fall(int64_t to_us)
{
    int64_t t0 = esp_timer_get_time();
    while (!gpio_get_level(PIN_DRDY))
        if (esp_timer_get_time() - t0 > to_us) return false;
    for (;;) {
        if (!gpio_get_level(PIN_DRDY)) {
            esp_rom_delay_us(1);
            if (!gpio_get_level(PIN_DRDY)) return true;
        }
        if (esp_timer_get_time() - t0 > to_us) return false;
    }
}

/* ------------------------------------------------------------------ */
/*  Akuisisi                                                           */
/* ------------------------------------------------------------------ */
/* IO34 ada di GPIO_IN1 (bit 34-32). Dibaca langsung karena gpio_get_level tidak di IRAM. */
#define DRDY_IS_LOW()  ((REG_READ(GPIO_IN1_REG) & (1u << (PIN_DRDY - 32))) == 0)
#define MIN_EDGE_US    40   /* periode 66.7 µs; tepi yang lebih rapat = derau, bukan data baru */

static void IRAM_ATTR drdy_isr(void *arg)
{
    (void)arg;
    /* Saat SPI aktif, SCLK/CS bisa menginduksi tepi turun palsu di kabel DRDY. Tepi asli
     * membuat DRDY tetap LOW sampai data dibaca; tepi palsu sudah HIGH lagi saat ISR jalan. */
    int64_t now = esp_timer_get_time();
    if (!DRDY_IS_LOW() || now - s_last_edge < MIN_EDGE_US) {
        s_glitches++;
        return;
    }
    s_last_edge = now;
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
    uint32_t seq = 0;
    bool     held = false;   /* bus SPI dikunci selama streaming: transaksi polling lebih cepat */

    for (;;) {
        uint32_t n = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(50));
        if (!s_running) {
            if (held) { spi_device_release_bus(spi_fast); held = false; }
            flush_pkt();
            continue;
        }
        if (!held) { spi_device_acquire_bus(spi_fast, portMAX_DELAY); held = true; }
        if (n == 0) { s_timeouts++; continue; }
        if (n > 1) {
            /* Ada DRDY terlewat: tutup paket supaya waktu tiap sampel tetap benar. */
            flush_pkt();
            s_missed += n - 1;
            seq += n - 1;
        }

        int64_t t_us = esp_timer_get_time();
        uint8_t raw[3];
        int32_t v = rdata(raw);
        uint32_t rd_us = (uint32_t)(esp_timer_get_time() - t_us);
        if (rd_us > s_rd_max_us) s_rd_max_us = rd_us;

        uint8_t flag = __atomic_exchange_n(&s_stim_pending, 0, __ATOMIC_SEQ_CST) ? 1 : 0;
        if (flag) s_stims++;
        s_last = v;
        if (s_range_reset) {
            s_range_reset = false;
            s_min = s_max = v;
            s_sum = 0;
            s_sum_n = 0;
        }
        if (v < s_min) s_min = v;
        if (v > s_max) s_max = v;
        s_sum += v;
        s_sum_n++;
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
            uint16_t fs  = ADS_SPS;
            float    uv  = uv_per_lsb();
            h[0] = 0xEE;
            h[1] = 2;
            memcpy(h + 4, &seq, 4);
            memcpy(h + 8, &t_us, 8);
            memcpy(h + 16, &fs, 2);
            h[18] = s_short ? 0 : (uint8_t)s_ch;
            h[19] = (uint8_t)s_pga;
            memcpy(h + 20, &uv, 4);
        }
        uint8_t *p = cur->data + PKT_HDR + cur_n * 7;
        p[0] = flag;
        memcpy(p + 1, raw, 3);   /* kanal aktif apa adanya (i24 big-endian) */
        memset(p + 4, 0, 3);     /* CH2 tidak dipakai */
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
static uint8_t pga_code(int pga)
{
    uint8_t c = 0;
    while (c < 6 && (1 << c) < pga) c++;
    return c;
}

/* Tulis STATUS/ADCON/DRATE/MUX, baca balik, self-cal, lalu SYNC + WAKEUP.
 * Akuisisi harus sudah berhenti (SPI dipakai task ini). */
static bool write_config(bool verbose)
{
    const struct { uint8_t reg, val, mask; } cfg[] = {
        { REG_STATUS, s_buffer ? STATUS_BUFEN : 0x00, 0x0E },   /* bit 7:4 ID, bit 0 DRDY: abaikan */
        { REG_ADCON,  pga_code(s_pga),               0xFF },    /* CLKOUT off, sensor detect off */
        { REG_DRATE,  DRATE_15K,                     0xFF },
        { REG_MUX,    cur_mux(),                     0xFF },
    };
    const int n = sizeof(cfg) / sizeof(cfg[0]);

    wait_low(200000);
    for (int i = 0; i < n; i++) wreg(cfg[i].reg, cfg[i].val);

    int bad = 0;
    for (int i = 0; i < n; i++) {
        uint8_t got = rreg(cfg[i].reg);
        bool ok = (got & cfg[i].mask) == (cfg[i].val & cfg[i].mask);
        if (!ok) bad++;
        if (verbose || !ok)
            LOG(verbose ? "CHECK" : "ADS", "  register 0x%02X  tulis 0x%02X  baca 0x%02X  %s",
                cfg[i].reg, cfg[i].val, got, ok ? "OK" : "BEDA");
    }
    if (verbose)
        LOG("CHECK", "  %d/%d register cocok%s", n - bad, n,
            bad ? "  → ID terbaca tapi tulis gagal: curigai MOSI IO23" : "");

    wait_low(200000);
    cmd(CMD_SELFCAL);
    vTaskDelay(pdMS_TO_TICKS(5));
    if (!wait_fall(1000000)) {
        LOG("ADS", "PERINGATAN: self-cal tidak selesai (DRDY tidak turun)");
        bad++;
    }
    cmd(CMD_SYNC);
    cmd(CMD_WAKEUP);
    return bad == 0;
}

/* Hentikan streaming sementara, tulis ulang register, lalu lanjutkan. */
static void reconfigure(void)
{
    if (!s_present) return;
    bool was = s_running;
    ads_stop();
    bool ok = write_config(false);
    LOG("ADS", "%s, PGA %d, buffer %s  %s", ch_label(), s_pga, s_buffer ? "ON" : "OFF",
        ok ? "OK" : "register gagal");
    if (was) ads_start();
}

static void isr_install_task(void *arg)
{
    esp_err_t e = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
    if (e != ESP_OK && e != ESP_ERR_INVALID_STATE) ESP_ERROR_CHECK(e);
    gpio_isr_handler_add(PIN_DRDY, drdy_isr, NULL);
    gpio_intr_disable(PIN_DRDY);
    xTaskNotifyGive((TaskHandle_t)arg);
    vTaskDelete(NULL);
}

static void hw_init(void)
{
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << PIN_CS) | (1ULL << PIN_RESET) | (1ULL << PIN_PDWN),
        .mode = GPIO_MODE_INPUT_OUTPUT,   /* bisa dibaca balik saat cek */
    };
    gpio_set_level(PIN_CS, 1);
    gpio_config(&out);
    gpio_set_level(PIN_CS, 1);
    gpio_set_level(PIN_PDWN, 1);
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
    /* Interrupt dialokasikan di core pemanggil, jadi pasang dari task di core 1:
     * satu core dengan ads_task, jauh dari WiFi di core 0 (periode sampel 66.7 µs). */
    xTaskCreatePinnedToCore(isr_install_task, "drdy_isr", 3072, xTaskGetCurrentTaskHandle(), 10, NULL, 1);
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
}

/* Pulsa RESET, tunggu kristal + DRDY, perintah RESET, baca STATUS.
 * true kalau ID (STATUS bit 7:4) = 3. */
static bool probe(int wait_ms)
{
    vTaskDelay(pdMS_TO_TICKS(wait_ms));
    gpio_set_level(PIN_RESET, 0);
    esp_rom_delay_us(1000);
    gpio_set_level(PIN_RESET, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
    wait_low(500000);
    cmd(CMD_RESET);
    vTaskDelay(pdMS_TO_TICKS(5));
    wait_low(500000);
    s_status = rreg(REG_STATUS);
    return (s_status >> 4) == 3;
}

static void log_not_found(void)
{
    /* Baris log maks ~160 karakter (ring buffer net.c), jadi dipecah dua. */
    int idle = gpio_get_level(PIN_MISO);
    LOG("ADS", "PERINGATAN: ADS1256 tidak terdeteksi (STATUS 0x%02X, MISO diam=%d)", s_status, idle);
    if (s_status == 0xFF)
        LOG("ADS", "  MISO mengambang: modul ADS1256 tidak tersambung, cek DOUT → IO19 dan CS IO21");
    else if (s_status == 0x00)
        LOG("ADS", "  STATUS 0x00: modul tanpa daya / belum siap. Nyalakan 5 V ADS1256 dulu, dicoba ulang tiap 5 s");
    else
        LOG("ADS", "  ADS tidak menjawab benar: cek SCLK IO18, MOSI IO23, RST IO26, PDWN IO27, GND bersama");
}

static bool finish_init(void)
{
    if (s_present) return write_config(false);

    bool ok = write_config(false);
    DBG("ADS", "register STATUS %02X MUX %02X ADCON %02X DRATE %02X",
        rreg(REG_STATUS), rreg(REG_MUX), rreg(REG_ADCON), rreg(REG_DRATE));
    DBG("ADS", "pin MOSI %d MISO %d SCLK %d CS %d DRDY %d RESET %d PDWN %d, SPI %d/%d kHz",
        PIN_MOSI, PIN_MISO, PIN_SCLK, PIN_CS, PIN_DRDY, PIN_RESET, PIN_PDWN,
        SPI_SLOW_HZ / 1000, SPI_FAST_HZ / 1000);
    LOG("ADS", "ADS1256 STATUS 0x%02X, %d SPS, PGA %d, AD620 ×%.0f, %s  %s",
        s_status, ADS_SPS, s_pga, ADS_AMP_GAIN, ch_label(), ok ? "OK" : "ADA REGISTER GAGAL");

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
    if (!probe(300)) {
        log_not_found();
        return false;
    }
    return finish_init();
}

bool ads_reprobe(void)
{
    if (s_present) return true;
    if (!probe(10)) return false;
    LOG("ADS", "ADS1256 terdeteksi (modul baru menyala)");
    finish_init();
    return true;
}

bool ads_present(void) { return s_present; }
bool ads_running(void) { return s_running; }
int  ads_channel(void) { return s_ch; }

void ads_start(void)
{
    if (!s_present || s_running) return;
    s_stim_pending = 0;
    s_range_reset = true;
    xTaskNotifyStateClear(ads_task_h);
    ulTaskNotifyValueClear(ads_task_h, UINT32_MAX);
    s_running = true;
    gpio_intr_enable(PIN_DRDY);
    LOG("ADS", "akuisisi mulai, %s, streaming %d SPS ke backend", ch_label(), ADS_SPS);
}

void ads_stop(void)
{
    if (!s_present || !s_running) return;
    gpio_intr_disable(PIN_DRDY);
    s_running = false;
    xTaskNotifyGive(ads_task_h);    /* bangunkan task supaya paket terakhir dikirim */
    vTaskDelay(pdMS_TO_TICKS(5));   /* biarkan ads_task menyelesaikan bacaan terakhir */
    LOG("ADS", "akuisisi berhenti");
}

void ads_select(int ch)
{
    if (ch != 1 && ch != 2) { LOG("ERR", "ads ch 1 (Cz-A1) / ads ch 2 (Cz-A2)"); return; }
    if (ch == s_ch && !s_short) return;
    s_ch = ch;
    s_short = false;
    if (s_present) reconfigure();
    else LOG("ADS", "kanal disetel ke %s (dipakai saat ADS1256 terdeteksi)", ch_label());
}

void ads_set_pga(int pga)
{
    if (pga < 1 || pga > 64 || (pga & (pga - 1))) { LOG("ERR", "PGA 1/2/4/8/16/32/64"); return; }
    s_pga = pga;
    reconfigure();
}

void ads_set_buffer(bool on)
{
    s_buffer = on;
    reconfigure();
}

void ads_short(bool on)
{
    if (!s_present) { LOG("ADS", "ADS1256 tidak terdeteksi"); return; }
    s_short = on;
    reconfigure();
}

/* Rentang DC aman di input ADC: buffer ON 0..AVDD−2 V, OFF 0..AVDD (diberi margin). */
static bool dc_ok(float v)
{
    return s_buffer ? (v > 0.3f && v < 2.7f) : (v > 0.1f && v < 4.9f);
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

    LOG("ADS", "%s  %s  PGA %d  buffer %s  %.0f SPS (harus ~%d)  stimulus ditandai=%lu",
        s_running ? "JALAN" : "berhenti", ch_label(), s_pga, s_buffer ? "ON" : "OFF", sps, ADS_SPS,
        (unsigned long)s_stims);
    LOG("ADS", "  sampel terakhir %.1f µV di elektroda, %.4f V di input ADC",
        s_last * uv_per_lsb(), s_last * v_per_lsb(s_pga));
    LOG("ADS", "  terlewat=%lu  timeout=%lu  dibuang=%lu",
        (unsigned long)s_missed, (unsigned long)s_timeouts, (unsigned long)s_dropped);
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
    static uint32_t l_smp, l_miss, l_drop, l_to, l_stim, l_sent, l_fail, l_off, l_onset, l_gl;
    static bool     was_running;
    int64_t now = esp_timer_get_time();

    if (!s_present) {
        /* Modul bisa dinyalakan belakangan: coba deteksi ulang, peringatan diulang supaya
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
        l_smp = s_samples; l_miss = s_missed; l_drop = s_dropped; l_to = s_timeouts;
        l_stim = s_stims; l_sent = s_sent; l_fail = s_send_fail; l_off = s_offline; l_onset = onsets_played;
        l_gl = s_glitches; s_rd_max_us = 0;
    }
    was_running = s_running;
    if (!s_running || now < next_us) return false;
    next_us = now + POLL_US;

    uint32_t smp = s_samples - l_smp,   miss = s_missed - l_miss,    to = s_timeouts - l_to;
    uint32_t drop = s_dropped - l_drop, stim = s_stims - l_stim;
    uint32_t sent = s_sent - l_sent,    fail = s_send_fail - l_fail, off = s_offline - l_off;
    uint32_t onset = onsets_played - l_onset, gl = s_glitches - l_gl, rd_max = s_rd_max_us;
    float    sps = smp * 1e6f / (float)(now - last_us);
    l_smp = s_samples; l_miss = s_missed; l_drop = s_dropped; l_to = s_timeouts;
    l_stim = s_stims; l_sent = s_sent; l_fail = s_send_fail; l_off = s_offline; l_onset = onsets_played;
    l_gl = s_glitches; s_rd_max_us = 0;
    last_us = now;

    const float uv = uv_per_lsb();
    int32_t mn = s_min, mx = s_max;
    float   dc = s_sum_n ? (float)((double)s_sum / s_sum_n) * v_per_lsb(s_pga) : 0.0f;
    s_range_reset = true;

    DBG("ADS", "%.0f SPS  %s %.0f..%.0f µV  DC %.3f V  onset %lu/%lu  paket %lu  RDATA maks %lu µs  derau DRDY %lu",
        sps, ch_label(), mn * uv, mx * uv, dc,
        (unsigned long)stim, (unsigned long)onset, (unsigned long)sent,
        (unsigned long)rd_max, (unsigned long)gl);

    if (smp == 0)
        LOG("ADS", "PERINGATAN: tidak ada DRDY (IO34). Cek catu modul, PDWN IO27, kabel DRDY");
    else if (sps < ADS_SPS * 0.98f)
        LOG("ADS", "PERINGATAN: laju %.0f SPS di bawah %d", sps, ADS_SPS);
    if (miss || to)
        LOG("ADS", "PERINGATAN: %lu sampel terlewat, %lu timeout (task ADS telat)", (unsigned long)miss, (unsigned long)to);
    if (drop)
        LOG("ADS", "PERINGATAN: %lu sampel dibuang (antrian paket penuh)", (unsigned long)drop);
    if (fail || off)
        LOG("ADS", "PERINGATAN: %lu paket gagal kirim, %lu paket dibuang karena WebSocket putus",
            (unsigned long)fail, (unsigned long)off);
    if (stim != onset)
        LOG("ADS", "PERINGATAN: onset diputar %lu tapi ditandai %lu", (unsigned long)onset, (unsigned long)stim);
    if (mx > RAIL_COUNTS || mn < -RAIL_COUNTS)
        LOG("ADS", "PERINGATAN: %s saturasi (%s), turunkan PGA atau cek elektroda", ch_label(),
            mx > RAIL_COUNTS ? "+" : "−");
    if (smp && !s_short && !dc_ok(dc))
        LOG("ADS", "PERINGATAN: level DC %.3f V di luar rentang input (buffer %s), atur trimpot nol AD620",
            dc, s_buffer ? "ON 0.3..2.7 V" : "OFF 0.1..4.9 V");
    return false;
}

/* ------------------------------------------------------------------ */
/*  Baca sinkron (tanpa task) untuk ads check / ads scan               */
/* ------------------------------------------------------------------ */
typedef struct {
    int     n;
    double  mean, sd;
    int32_t mn, mx;
} blk_t;

/* Buang 2 sampel pertama (filter sinc belum penuh), lalu baca n sampel. */
static bool read_block(int n, blk_t *b)
{
    double s = 0, s2 = 0;
    memset(b, 0, sizeof(*b));
    for (int i = -2; i < n; i++) {
        if (!wait_fall(20000)) return false;
        int32_t v = rdata(NULL);
        if (i < 0) continue;
        if (b->n == 0) b->mn = b->mx = v;
        if (v < b->mn) b->mn = v;
        if (v > b->mx) b->mx = v;
        s += v;
        s2 += (double)v * v;
        b->n++;
    }
    b->mean = s / b->n;
    double var = s2 / b->n - b->mean * b->mean;
    b->sd = var > 0 ? sqrt(var) : 0;
    return true;
}

static bool read_mux(uint8_t mux, int n, blk_t *b)
{
    wait_low(20000);
    wreg(REG_MUX, mux);
    cmd(CMD_SYNC);
    cmd(CMD_WAKEUP);
    return read_block(n, b);
}

/* ------------------------------------------------------------------ */
/*  Bring-up checker (perintah "ads check", otomatis saat WebSocket     */
/*  pertama kali tersambung).                                          */
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
    bool was_running = s_running, was_short = s_short;
    int  fails = 0;
    if (s_present) ads_stop();

    LOG("CHECK", "==== ADS1256 bring-up (modul + AD620) ====");

    LOG("CHECK", "1/7 GPIO  MOSI %d  MISO %d  SCLK %d  CS %d  DRDY %d  RESET %d  PDWN %d",
        PIN_MOSI, PIN_MISO, PIN_SCLK, PIN_CS, PIN_DRDY, PIN_RESET, PIN_PDWN);
    gpio_set_level(PIN_CS, 1);
    gpio_set_level(PIN_PDWN, 1);
    gpio_set_level(PIN_RESET, 1);
    LOG("CHECK", "  baca balik CS=%d RESET=%d PDWN=%d (harap 1 1 1)",
        gpio_get_level(PIN_CS), gpio_get_level(PIN_RESET), gpio_get_level(PIN_PDWN));

    LOG("CHECK", "2/7 JALUR (CS mati)");
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(10));
    int pu = gpio_get_level(PIN_MISO);
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLDOWN_ONLY);
    vTaskDelay(pdMS_TO_TICKS(10));
    int pd = gpio_get_level(PIN_MISO);
    gpio_set_pull_mode(PIN_MISO, GPIO_PULLUP_ONLY);
    LOG("CHECK", "  MISO IO%d pull-up=%d pull-down=%d → %s", PIN_MISO, pu, pd, pull_verdict(pu, pd));
    bool ticking = wait_fall(10000);
    LOG("CHECK", "  DRDY IO%d %s", PIN_DRDY,
        ticking ? "berdetak (chip berkonversi)" : "tidak berdetak: modul tanpa daya, kristal mati, atau DRDY putus");

    LOG("CHECK", "3/7 ID  pulsa RESET, perintah RESET, baca STATUS 3x");
    bool found = probe(0);
    uint8_t ids[3] = { s_status, rreg(REG_STATUS), rreg(REG_STATUS) };
    bool same = (ids[0] >> 4) == (ids[1] >> 4) && (ids[1] >> 4) == (ids[2] >> 4);
    LOG("CHECK", "  STATUS 0x%02X 0x%02X 0x%02X → ID %u %s", ids[0], ids[1], ids[2], ids[0] >> 4,
        same ? "" : "(BERUBAH-UBAH)");
    if (!found || !same) {
        if (ids[0] == 0x00)
            LOG("CHECK", "  0x00 → DOUT LOW: modul tanpa daya / belum siap, atau CS IO%d / SCLK IO%d tidak sampai", PIN_CS, PIN_SCLK);
        else if (ids[0] == 0xFF)
            LOG("CHECK", "  0xFF → DOUT tidak di-drive: modul tidak tersambung / CS IO%d putus", PIN_CS);
        else
            LOG("CHECK", "  nilai salah/acak → sambungan goyang, MOSI IO%d salah, atau GND tidak bersama", PIN_MOSI);
        LOG("CHECK", "  cek 5 V di modul (AVDD ≥ 4.75 V, bukan 4.6 V dari USB) dan nyalakan sebelum ESP32");
        LOG("CHECK", "==== BERHENTI di langkah 3: ADS1256 tidak menjawab ====");
        return;
    }
    LOG("CHECK", "  ADS1256 ID 3  OK");

    LOG("CHECK", "4/7 CONFIG  %d SPS, PGA %d, buffer %s, self-cal", ADS_SPS, s_pga, s_buffer ? "ON" : "OFF");
    s_short = false;
    if (!s_present) finish_init();
    if (!write_config(true)) fails++;

    LOG("CHECK", "5/7 RATE  hitung DRDY selama 1 detik");
    s_drdy_edges = 0;
    gpio_intr_enable(PIN_DRDY);
    vTaskDelay(pdMS_TO_TICKS(1000));
    gpio_intr_disable(PIN_DRDY);
    uint32_t sps = s_drdy_edges;
    bool rate_ok = sps > ADS_SPS * 0.95f && sps < ADS_SPS * 1.05f;
    LOG("CHECK", "  DRDY %lu pulsa/detik (harap ~%d)  %s", (unsigned long)sps, ADS_SPS, rate_ok ? "OK" : "GAGAL");
    if (sps == 0) LOG("CHECK", "  0 pulsa → kristal 7.68 MHz / PDWN IO%d / DRDY IO%d", PIN_PDWN, PIN_DRDY);
    if (!rate_ok) fails++;

    LOG("CHECK", "6/7 NOISE  input pendek (AIN0−AIN0), 3000 sampel");
    blk_t b;
    const float vl = v_per_lsb(s_pga);
    if (!read_mux(MUX_SHORT, 3000, &b)) {
        LOG("CHECK", "  DRDY timeout saat membaca");
        fails++;
    } else {
        float sd = b.sd * vl * 1e6f, pp = (b.mx - b.mn) * vl * 1e6f;
        bool ok = pp < 200.0f;
        LOG("CHECK", "  di input ADC: rata-rata %.1f µV, noise %.2f µVrms, p-p %.1f µV  %s",
            b.mean * vl * 1e6f, sd, pp, ok ? "OK" : "BESAR");
        LOG("CHECK", "  setara di elektroda (÷%.0f): %.3f µVrms", ADS_AMP_GAIN, sd / ADS_AMP_GAIN);
        if (!ok) fails++;
    }

    LOG("CHECK", "7/7 AD620  level DC CH1 / CH2 (harus di dalam rentang input, idealnya ~1.5 V)");
    for (int c = 1; c <= 2; c++) {
        if (!read_mux(c == 1 ? MUX_CH1 : MUX_CH2, 1000, &b)) { LOG("CHECK", "  DRDY timeout"); fails++; break; }
        float v = b.mean * vl;
        bool ok = dc_ok(v);
        LOG("CHECK", "  CH%d %s: %.3f V, noise %.1f µVrms di elektroda  %s", c, c == 1 ? "Cz-A1" : "Cz-A2",
            v, b.sd * vl * 1e6f / ADS_AMP_GAIN, ok ? "OK" : "DI LUAR RENTANG: atur trimpot nol AD620 / cek resistor 10k");
        if (!ok) fails++;
    }

    s_short = was_short;
    write_config(false);
    if (fails) LOG("CHECK", "==== SELESAI: %d pemeriksaan GAGAL, lihat baris di atas ====", fails);
    else       LOG("CHECK", "==== SELESAI: SEMUA OK, ADS1256 siap ====");
    if (was_running) ads_start();
}

/* ------------------------------------------------------------------ */
/*  Scan kanal (perintah "ads scan"), sama dengan ADS1256_Channel_Scan  */
/* ------------------------------------------------------------------ */
void ads_scan(void)
{
    if (!s_present) { LOG("ADS", "ADS1256 tidak terdeteksi"); return; }
    bool was_running = s_running;
    ads_stop();
    const float vl = v_per_lsb(1);
    blk_t b;

    LOG("SCAN", "==== scan kanal ADS1256, PGA 1, volt di input ADC ====");
    for (int buf = 1; buf >= 0; buf--) {
        wait_low(200000);
        wreg(REG_STATUS, buf ? STATUS_BUFEN : 0x00);
        wreg(REG_ADCON, 0x00);
        cmd(CMD_SELFCAL);
        vTaskDelay(pdMS_TO_TICKS(5));
        wait_fall(1000000);
        LOG("SCAN", "buffer %s (STATUS 0x%02X)", buf ? "ON " : "OFF", rreg(REG_STATUS));
        for (int i = 0; i < 8; i++) {
            uint8_t mux = (uint8_t)(i << 4) | MUX_AINCOM;
            if (!read_mux(mux, 32, &b)) { LOG("SCAN", "  DRDY timeout"); break; }
            LOG("SCAN", "  AIN%d - AINCOM : %8.4f V   (MUX baca 0x%02X)", i, b.mean * vl, rreg(REG_MUX));
        }
        const uint8_t pairs[2] = { MUX_CH1, MUX_CH2 };
        for (int i = 0; i < 2; i++) {
            if (!read_mux(pairs[i], 32, &b)) { LOG("SCAN", "  DRDY timeout"); break; }
            LOG("SCAN", "  AIN%d - AIN%d   : %8.4f V   (MUX baca 0x%02X)", 2 * i, 2 * i + 1, b.mean * vl, rreg(REG_MUX));
        }
    }
    LOG("SCAN", "==== selesai ====");

    write_config(false);
    if (was_running) ads_start();
}
