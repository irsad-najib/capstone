/* ADS1299 bring-up — peta pin Cerelog ESP-EEG v1, dengan log per langkah.
 *
 * Urutan:
 *   1. GPIO     : set level awal semua pin kontrol
 *   2. DRDY     : cek jalur DRDY (GPIO27 punya pull internal, jadi jujur)
 *   3. POWER-UP : PWDN HIGH, tunggu tPOR, reset chip
 *   4. ID       : baca register ID. Gagal → ulangi terus tiap 2 detik
 *   5. CONFIG   : tulis register, baca balik, laporkan yang tidak cocok
 *   6. RATE     : START HIGH, ukur laju DRDY (harap ~250 SPS)
 *   7. STREAM   : RDATAC, baca sampel, log ringkasan per detik
 *
 * Channel dipasang ke sinyal uji internal (square wave ~1 Hz, ±1.875 mV)
 * supaya data bisa diverifikasi tanpa elektroda.
 *
 * Akuisisi jalan di task sendiri, Core 1, prioritas tinggi (sesuai CLAUDE.md).
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "ads1299.h"

#define SPI_HZ          1000000   /* jauh di bawah batas ADS1299 */
#define SAMPLE_RATE     250       /* CONFIG1 = 0x96 */
#define LSB_UV          (4.5e6 / 8388607.0)   /* VREF 4.5 V, gain 1 */

#define LOG(tag, fmt, ...) \
    printf("[%7lld ms] [%-6s] " fmt "\n", esp_timer_get_time() / 1000, tag, ##__VA_ARGS__)

static spi_device_handle_t spi;
static TaskHandle_t        ads_task_handle;
static volatile uint32_t   drdy_edges;
static volatile bool       notify_on_drdy;

/* ------------------------------------------------------------------ */
/*  DRDY interrupt                                                     */
/* ------------------------------------------------------------------ */
static void IRAM_ATTR drdy_isr(void *arg)
{
    (void)arg;
    drdy_edges++;
    if (notify_on_drdy) {
        BaseType_t woken = pdFALSE;
        vTaskNotifyGiveFromISR(ads_task_handle, &woken);
        portYIELD_FROM_ISR(woken);
    }
}

/* ------------------------------------------------------------------ */
/*  SPI                                                                */
/* ------------------------------------------------------------------ */
/* CS dikendalikan manual supaya satu frame multi-byte tidak terputus. */
static void spi_xfer(const uint8_t *tx, uint8_t *rx, size_t n)
{
    spi_transaction_t t = {
        .length    = n * 8,
        .tx_buffer = tx,
        .rx_buffer = rx,
    };
    gpio_set_level(ADS_PIN_CS, 0);
    esp_rom_delay_us(10);
    spi_device_polling_transmit(spi, &t);
    esp_rom_delay_us(10);
    gpio_set_level(ADS_PIN_CS, 1);
    esp_rom_delay_us(10);
}

static void ads_cmd(uint8_t op)
{
    uint8_t tx = op, rx = 0;
    spi_xfer(&tx, &rx, 1);
}

static void ads_wreg(uint8_t reg, uint8_t val)
{
    uint8_t tx[3] = { 0x40 | reg, 0x00, val }, rx[3];
    spi_xfer(tx, rx, 3);
}

static uint8_t ads_rreg(uint8_t reg)
{
    uint8_t tx[3] = { 0x20 | reg, 0x00, 0x00 }, rx[3] = { 0 };
    spi_xfer(tx, rx, 3);
    return rx[2];
}

/* ------------------------------------------------------------------ */
/*  Langkah-langkah bring-up                                           */
/* ------------------------------------------------------------------ */
static void step_gpio(void)
{
    LOG("GPIO", "DIN=%d RESET=%d START=%d CS=%d SCLK=%d DOUT=%d DRDY=%d",
        ADS_PIN_MOSI, ADS_PIN_RESET, ADS_PIN_START,
        ADS_PIN_CS, ADS_PIN_SCLK, ADS_PIN_MISO, ADS_PIN_DRDY);

    /* Level output diset sebelum pin jadi output, supaya tidak ada glitch. */
    gpio_set_level(ADS_PIN_CS, 1);
    gpio_set_level(ADS_PIN_START, 0);
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << ADS_PIN_CS) | (1ULL << ADS_PIN_START),
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&out);
    LOG("GPIO", "CS=HIGH  START=LOW");
    LOG("GPIO", "PWDN tidak tersambung ke ESP32 di board ini (ditahan HIGH oleh R12)");

#if ADS_USE_HW_RESET
    gpio_set_level(ADS_PIN_RESET, 1);
    gpio_set_direction(ADS_PIN_RESET, GPIO_MODE_OUTPUT);
    LOG("GPIO", "RESET lewat pin GPIO%d, idle HIGH", ADS_PIN_RESET);
#else
    gpio_reset_pin(ADS_PIN_RESET);
    gpio_set_direction(ADS_PIN_RESET, GPIO_MODE_INPUT);
    gpio_set_pull_mode(ADS_PIN_RESET, GPIO_FLOATING);
    LOG("GPIO", "GPIO%d dibiarkan Hi-Z, RESET lewat perintah SPI 0x06", ADS_PIN_RESET);
    LOG("GPIO", "  (ubah ADS_USE_HW_RESET ke 1 hanya kalau kaki 36 tidak diikat ke 3V3)");
#endif

    spi_bus_config_t bus = {
        .mosi_io_num = ADS_PIN_MOSI,
        .miso_io_num = ADS_PIN_MISO,
        .sclk_io_num = ADS_PIN_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    esp_err_t e1 = spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_DISABLED);
    spi_device_interface_config_t dev = {
        .clock_speed_hz = SPI_HZ,
        .mode = 1,                /* CPOL=0 CPHA=1 */
        .spics_io_num = -1,       /* CS manual */
        .queue_size = 1,
    };
    esp_err_t e2 = spi_bus_add_device(SPI3_HOST, &dev, &spi);

    /* Pull-down internal di MISO: kalau chip tidak men-drive DOUT, jalur
     * terbaca 0x00 konsisten, bukan berganti-ganti 0xFF/0x00 karena noise. */
    gpio_set_pull_mode(ADS_PIN_MISO, GPIO_PULLDOWN_ONLY);
    LOG("GPIO", "SPI3 mode 1 @ %d Hz: bus=%s device=%s",
        SPI_HZ, esp_err_to_name(e1), esp_err_to_name(e2));
}

static void step_drdy_check(void)
{
    gpio_reset_pin(ADS_PIN_DRDY);
    gpio_set_direction(ADS_PIN_DRDY, GPIO_MODE_INPUT);

    gpio_set_pull_mode(ADS_PIN_DRDY, GPIO_PULLUP_ONLY);
    vTaskDelay(pdMS_TO_TICKS(20));
    int pu = gpio_get_level(ADS_PIN_DRDY);
    gpio_set_pull_mode(ADS_PIN_DRDY, GPIO_PULLDOWN_ONLY);
    vTaskDelay(pdMS_TO_TICKS(20));
    int pd = gpio_get_level(ADS_PIN_DRDY);
    gpio_set_pull_mode(ADS_PIN_DRDY, GPIO_PULLUP_ONLY);

    /* Chip masih power-down di tahap ini, jadi DRDY belum tentu di-drive.
     * Yang dicatat di sini adalah kondisi awal; dicek lagi setelah power-up. */
    LOG("DRDY", "sebelum power-up: pull-up=%d pull-down=%d", pu, pd);

    gpio_set_intr_type(ADS_PIN_DRDY, GPIO_INTR_NEGEDGE);
    gpio_install_isr_service(0);
    gpio_isr_handler_add(ADS_PIN_DRDY, drdy_isr, NULL);
}

static void step_power_up(void)
{
    LOG("POWER", "tunggu 1000 ms (tPOR + supply settle)");
    vTaskDelay(pdMS_TO_TICKS(1000));

#if ADS_USE_HW_RESET
    gpio_set_level(ADS_PIN_RESET, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(ADS_PIN_RESET, 1);
    LOG("POWER", "RESET pulse lewat GPIO%d", ADS_PIN_RESET);
#else
    ads_cmd(ADS_CMD_RESET);
    LOG("POWER", "RESET lewat perintah SPI 0x06");
#endif
    vTaskDelay(pdMS_TO_TICKS(50));

    /* Setelah reset chip otomatis masuk RDATAC; register tidak bisa
     * diakses sebelum SDATAC. */
    ads_cmd(ADS_CMD_SDATAC);
    vTaskDelay(pdMS_TO_TICKS(10));
    LOG("POWER", "SDATAC terkirim");

    gpio_set_pull_mode(ADS_PIN_DRDY, GPIO_PULLDOWN_ONLY);
    vTaskDelay(pdMS_TO_TICKS(20));
    int drdy = gpio_get_level(ADS_PIN_DRDY);
    gpio_set_pull_mode(ADS_PIN_DRDY, GPIO_PULLUP_ONLY);
    if (drdy == 1)
        LOG("POWER", "DRDY=HIGH walau diberi pull-down → chip men-drive DRDY  OK");
    else {
        LOG("POWER", "DRDY=LOW dengan pull-down → chip TIDAK men-drive DRDY  CURIGA");
        LOG("POWER", "  cek: AVSS (kaki 20,23,32,57,58) sudah disolder ke GND?");
        LOG("POWER", "  cek: kabel DRDY dari kaki 47 ke GPIO%d", ADS_PIN_DRDY);
    }
}

/* Return jumlah channel (4/6/8). Tidak kembali sampai ID valid. */
static int step_read_id(void)
{
    for (int attempt = 1; ; attempt++) {
        uint8_t id = ads_rreg(ADS_REG_ID);
        bool family_ok = (id & 0x1C) == 0x1C;   /* bit[4:2] = 111 → ADS1299 */
        int nch = (id & 0x03) == 0 ? 4 : (id & 0x03) == 1 ? 6 : (id & 0x03) == 2 ? 8 : 0;

        if (family_ok && nch) {
            LOG("ID", "ID=0x%02X → ADS1299 %d channel, revisi %d  OK",
                id, nch, (id >> 5) & 0x07);
            return nch;
        }

        LOG("ID", "percobaan %d: ID=0x%02X  GAGAL (harap 0x3C untuk -4, 0x3E untuk 8ch)",
            attempt, id);
        if (id == 0x00)
            LOG("ID", "  0x00 → DOUT tidak di-drive: cek CS (GPIO%d), SCLK (GPIO%d), DOUT (GPIO%d), GND",
                ADS_PIN_CS, ADS_PIN_SCLK, ADS_PIN_MISO);
        else if (id == 0xFF)
            LOG("ID", "  0xFF → DOUT ditahan HIGH: cek kabel DOUT dan apakah chip dapat DVDD");
        else
            LOG("ID", "  nilai acak → sambungan goyang atau DIN (GPIO%d) salah", ADS_PIN_MOSI);

        vTaskDelay(pdMS_TO_TICKS(2000));
        /* Coba lagi dari reset, siapa tahu kabel baru dibetulkan. */
        ads_cmd(ADS_CMD_RESET);
        vTaskDelay(pdMS_TO_TICKS(50));
        ads_cmd(ADS_CMD_SDATAC);
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

static int step_configure(int nch)
{
    typedef struct { uint8_t reg, val; const char *name; } reg_t;
    reg_t cfg[16];
    int n = 0;

    /* CONFIG3 dulu: nyalakan buffer referensi internal, lalu beri waktu. */
    ads_wreg(ADS_REG_CONFIG3, 0xE0);
    LOG("CONFIG", "CONFIG3=0xE0 (VREF internal ON, bias OFF), tunggu 150 ms");
    vTaskDelay(pdMS_TO_TICKS(150));

    cfg[n++] = (reg_t){ ADS_REG_CONFIG1, 0x96, "CONFIG1" };   /* 250 SPS */
    cfg[n++] = (reg_t){ ADS_REG_CONFIG2, 0xD0, "CONFIG2" };   /* sinyal uji internal */
    cfg[n++] = (reg_t){ ADS_REG_CONFIG3, 0xE0, "CONFIG3" };
    cfg[n++] = (reg_t){ ADS_REG_LOFF,    0x00, "LOFF   " };
    static const char *chn[] = {"CH1SET ","CH2SET ","CH3SET ","CH4SET ",
                                "CH5SET ","CH6SET ","CH7SET ","CH8SET "};
    for (int ch = 0; ch < 8; ch++) {
        if (ch >= nch && ch >= 4) break;                    /* register tidak ada */
        uint8_t v = ch < nch ? 0x65 : 0x81;                 /* uji gain 1 / mati */
        cfg[n++] = (reg_t){ ADS_REG_CH1SET + ch, v, chn[ch] };
    }
    cfg[n++] = (reg_t){ ADS_REG_BIAS_SENSP, 0x00, "BIAS_SP" };
    cfg[n++] = (reg_t){ ADS_REG_BIAS_SENSN, 0x00, "BIAS_SN" };
    cfg[n++] = (reg_t){ ADS_REG_MISC1,      0x00, "MISC1  " };
    cfg[n++] = (reg_t){ ADS_REG_CONFIG4,    0x00, "CONFIG4" };

    for (int i = 0; i < n; i++) ads_wreg(cfg[i].reg, cfg[i].val);

    int ok = 0;
    for (int i = 0; i < n; i++) {
        uint8_t got = ads_rreg(cfg[i].reg);
        bool m = got == cfg[i].val;
        ok += m;
        LOG("CONFIG", "%s 0x%02X  tulis 0x%02X  baca 0x%02X  %s",
            cfg[i].name, cfg[i].reg, cfg[i].val, got, m ? "OK" : "BEDA");
    }
    LOG("CONFIG", "%d/%d register cocok  %s", ok, n, ok == n ? "OK" : "ADA YANG GAGAL");
    if (ok != n)
        LOG("CONFIG", "  baca ID berhasil tapi tulis gagal → curigai DIN (GPIO%d)", ADS_PIN_MOSI);
    return ok == n;
}

static int step_measure_rate(void)
{
    gpio_set_level(ADS_PIN_START, 1);
    vTaskDelay(pdMS_TO_TICKS(50));
    drdy_edges = 0;
    vTaskDelay(pdMS_TO_TICKS(1000));
    int sps = (int)drdy_edges;
    LOG("RATE", "START=HIGH, DRDY = %d pulsa/detik (harap ~%d)  %s",
        sps, SAMPLE_RATE, (sps > SAMPLE_RATE * 9 / 10 && sps < SAMPLE_RATE * 11 / 10) ? "OK" : "GAGAL");
    if (sps == 0)
        LOG("RATE", "  0 pulsa → kabel START kaki 38 sudah dipindah ke GPIO%d?",
            ADS_PIN_START);
    return sps;
}

static void step_stream(int nch)
{
    size_t frame = 3 + 3 * (size_t)nch;
    uint8_t tx[27] = { 0 }, rx[27];

    ads_cmd(ADS_CMD_RDATAC);
    notify_on_drdy = true;
    LOG("STREAM", "RDATAC, %d channel, frame %u byte. Ringkasan tiap 1 detik.", nch, (unsigned)frame);
    LOG("STREAM", "Sinyal uji: square wave ~1 Hz, min/max harap sekitar -1875 / +1875 uV");

    uint32_t samples = 0, bad_status = 0, timeouts = 0;
    int32_t last[8] = { 0 }, mn[8], mx[8];
    for (int c = 0; c < 8; c++) { mn[c] = INT32_MAX; mx[c] = INT32_MIN; }
    int64_t t_report = esp_timer_get_time();

    while (1) {
        if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(100)) == 0) {
            timeouts++;
            if (timeouts % 10 == 1)
                LOG("STREAM", "DRDY tidak datang dalam 100 ms (total %lu kali)",
                    (unsigned long)timeouts);
            continue;
        }

        spi_xfer(tx, rx, frame);
        samples++;
        if ((rx[0] & 0xF0) != 0xC0) bad_status++;

        for (int c = 0; c < nch; c++) {
            const uint8_t *p = &rx[3 + 3 * c];
            int32_t v = ((int32_t)p[0] << 16) | ((int32_t)p[1] << 8) | p[2];
            if (v & 0x800000) v |= (int32_t)0xFF000000;
            last[c] = v;
            if (v < mn[c]) mn[c] = v;
            if (v > mx[c]) mx[c] = v;
        }

        int64_t now = esp_timer_get_time();
        if (now - t_report >= 1000000) {
            LOG("STREAM", "%lu sampel/detik, status header salah: %lu",
                (unsigned long)samples, (unsigned long)bad_status);
            for (int c = 0; c < nch; c++)
                LOG("STREAM", "  CH%d  now %8.0f uV   min %8.0f   max %8.0f",
                    c + 1, last[c] * LSB_UV, mn[c] * LSB_UV, mx[c] * LSB_UV);
            samples = 0; bad_status = 0;
            for (int c = 0; c < 8; c++) { mn[c] = INT32_MAX; mx[c] = INT32_MIN; }
            t_report = now;
        }
    }
}

/* ------------------------------------------------------------------ */
static void ads_task(void *arg)
{
    (void)arg;
    printf("\n==================== ADS1299 bring-up ====================\n");

    LOG("STEP", "1/7 GPIO");          step_gpio();
    LOG("STEP", "2/7 DRDY");          step_drdy_check();
    LOG("STEP", "3/7 POWER-UP");      step_power_up();
    LOG("STEP", "4/7 ID");            int nch = step_read_id();
    LOG("STEP", "5/7 CONFIG");        step_configure(nch);
    LOG("STEP", "6/7 RATE");          step_measure_rate();
    LOG("STEP", "7/7 STREAM");        step_stream(nch);
}

void app_main(void)
{
    vTaskDelay(pdMS_TO_TICKS(2000));   /* beri waktu serial monitor tersambung */
    xTaskCreatePinnedToCore(ads_task, "ads", 8192, NULL,
                            configMAX_PRIORITIES - 2, &ads_task_handle, 1);
}
