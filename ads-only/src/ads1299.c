#include "ads1299.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include <stdio.h>

static spi_device_handle_t spi;

/* ------------------------------------------------------------------ */
/*  DOUT connectivity check — RC decay + loopback                      */
/* ------------------------------------------------------------------ */

/* Measure how many tight-loop iterations it takes GPIO19 to decay from
 * one rail to the other when released with the opposite internal pull.
 * More capacitance (trace + chip pad) = more iterations = "connected". */
static int dout_decay_cycles(int drive_high)
{
    gpio_reset_pin(ADS_PIN_MISO);
    gpio_set_direction(ADS_PIN_MISO, GPIO_MODE_OUTPUT);
    gpio_set_level(ADS_PIN_MISO, drive_high);
    esp_rom_delay_us(20);

    gpio_set_direction(ADS_PIN_MISO, GPIO_MODE_INPUT);
    if (drive_high) {
        gpio_pullup_dis(ADS_PIN_MISO);
        gpio_pulldown_en(ADS_PIN_MISO);   /* drain HIGH → 0 */
    } else {
        gpio_pulldown_dis(ADS_PIN_MISO);
        gpio_pullup_en(ADS_PIN_MISO);     /* charge LOW → 1 */
    }

    const int target = drive_high ? 0 : 1;
    int cycles = 0;
    while (cycles < 300 && gpio_get_level(ADS_PIN_MISO) != target)
        cycles++;

    gpio_pullup_dis(ADS_PIN_MISO);
    gpio_pulldown_dis(ADS_PIN_MISO);
    return cycles;
}

/* RC decay test (probabilistic — calibrate thresholds on your board).
 * Theory: connected trace + chip pad ~10-30 pF vs ESP32 pad-only ~1-3 pF.
 * tau = 45kΩ × 20pF ≈ 0.9 µs (connected) vs 45kΩ × 2pF ≈ 0.09 µs (not).
 *
 * Returns: 1=likely connected, 0=likely disconnected, -1=uncertain. */
static int dout_rc_test(void)
{
    const int N = 16;
    /* warmup */
    dout_decay_cycles(1);
    dout_decay_cycles(0);

    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += dout_decay_cycles(i & 1);   /* alternate HIGH/LOW */

    gpio_reset_pin(ADS_PIN_MISO);
    float avg = (float)sum / N;

    printf("[DOUT RC]  avg decay cycles = %.1f  (disconn<6, conn>10, uncert 6-10)\n", avg);
    /* Calibrate: run once with wire removed → get disconnected baseline.
     * Run once with wire attached to chip → get connected baseline.
     * Threshold = midpoint. Defaults below work for ~20cm jumper + TQFP-64. */
    if (avg > 10.0f) {
        printf("[DOUT RC]  → Likely CONNECTED (capacitance detected)\n");
        return 1;
    } else if (avg < 6.0f) {
        printf("[DOUT RC]  → Likely DISCONNECTED (no extra capacitance)\n");
        return 0;
    }
    printf("[DOUT RC]  → Uncertain — calibrate thresholds or use loopback test\n");
    return -1;
}

/* Loopback test: uses GPIO26 (isolated, already used in self-test) as a
 * controlled driver.  Temporarily tie GPIO26 → GPIO19 with a jumper wire,
 * run this test, then remove the jumper.
 *
 * Returns: 1=loopback OK (GPIO19 sees GPIO26), 0=fail, -1=skipped. */
static int dout_loopback_test(void)
{
    #define LOOPBACK_DRIVER_GPIO 26

    printf("[DOUT LB]  Driver: GPIO%d  Receiver: GPIO%d\n",
           LOOPBACK_DRIVER_GPIO, ADS_PIN_MISO);
    vTaskDelay(pdMS_TO_TICKS(500));   /* short settle */

    gpio_reset_pin(LOOPBACK_DRIVER_GPIO);
    gpio_set_direction(LOOPBACK_DRIVER_GPIO, GPIO_MODE_OUTPUT);
    gpio_reset_pin(ADS_PIN_MISO);
    gpio_set_direction(ADS_PIN_MISO, GPIO_MODE_INPUT);
    gpio_pullup_dis(ADS_PIN_MISO);
    gpio_pulldown_en(ADS_PIN_MISO);   /* weak pull-down so idle = 0 */

    int errors = 0;
    for (int v = 0; v < 20; v++) {
        int drive = v & 1;
        gpio_set_level(LOOPBACK_DRIVER_GPIO, drive);
        esp_rom_delay_us(50);
        int read = gpio_get_level(ADS_PIN_MISO);
        if (read != drive) errors++;
    }

    gpio_pulldown_dis(ADS_PIN_MISO);
    gpio_reset_pin(LOOPBACK_DRIVER_GPIO);
    gpio_reset_pin(ADS_PIN_MISO);

    printf("[DOUT LB]  Remove loopback wire now.\n");
    vTaskDelay(pdMS_TO_TICKS(3000));

    printf("[DOUT LB]  Errors: %d/20 → %s\n", errors,
           errors == 0 ? "PASS — GPIO19 wire is intact end-to-end" :
           errors < 5  ? "PARTIAL — intermittent connection (cold solder?)" :
                         "FAIL — wire not detected on GPIO19");
    return (errors == 0) ? 1 : (errors < 5 ? -1 : 0);
}

/* ------------------------------------------------------------------ */
/*  Pin diagnostics — run BEFORE ads_init(), no SPI needed             */
/* ------------------------------------------------------------------ */
void ads_check_pins(void)
{
    printf("\n[PIN CHECK] ========================================\n");

    /* ---- 0. Isolated GPIO self-test (GPIO26 — nothing connected) ----
       NOTE: must use GPIO_MODE_INPUT_OUTPUT so input buffer stays enabled
       and gpio_get_level() can read back the driven value. */
    #define ISOLATED_TEST_GPIO 26
    gpio_reset_pin(ISOLATED_TEST_GPIO);
    gpio_set_direction(ISOLATED_TEST_GPIO, GPIO_MODE_INPUT_OUTPUT);
    gpio_set_level(ISOLATED_TEST_GPIO, 1);
    vTaskDelay(pdMS_TO_TICKS(2));
    int iso_hi = gpio_get_level(ISOLATED_TEST_GPIO);
    gpio_set_level(ISOLATED_TEST_GPIO, 0);
    vTaskDelay(pdMS_TO_TICKS(2));
    int iso_lo = gpio_get_level(ISOLATED_TEST_GPIO);
    printf("[PIN] Isolated GPIO%d self-test: HIGH=%d LOW=%d  %s\n",
           ISOLATED_TEST_GPIO, iso_hi, iso_lo,
           (iso_hi == 1 && iso_lo == 0) ? "OK — ESP32 GPIO output works"
                                        : "FAIL — GPIO broken or pin is connected to something");

    /* --- Configure all ADS pins as plain GPIO for measurement ---
       Use INPUT_OUTPUT so gpio_get_level() can read back the driven level.
       Pure OUTPUT disables the input buffer → readback always returns 0. */
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << ADS_PIN_MOSI)
                      | (1ULL << ADS_PIN_SCLK)
                      | (1ULL << ADS_PIN_CS)
                      | (1ULL << ADS_PIN_RESET)
                      | (1ULL << ADS_PIN_START),
        .mode = GPIO_MODE_INPUT_OUTPUT,   /* INPUT_OUTPUT enables readback */
    };
    gpio_config(&out);

    /* MISO: pull-up so it reads 1 when chip tristate (CS=HIGH).
       Without pull-up, floating MISO can show capacitive coupling from MOSI. */
    gpio_config_t in = {
        .pin_bit_mask = (1ULL << ADS_PIN_MISO)
                      | (1ULL << ADS_PIN_DRDY),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,    /* pull-up: MISO=1 when chip tristate */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    gpio_config(&in);

    /* Set outputs to idle state */
    gpio_set_level(ADS_PIN_CS,    1);   /* CS idle HIGH (deselected) */
    gpio_set_level(ADS_PIN_SCLK,  0);   /* SCLK idle LOW (Mode 1) */
    gpio_set_level(ADS_PIN_RESET, 1);   /* RESET inactive HIGH */
    gpio_set_level(ADS_PIN_START, 0);   /* START LOW (no conversion) */
    gpio_set_level(ADS_PIN_MOSI,  0);
    vTaskDelay(pdMS_TO_TICKS(10));

    /* ---- 1. Read inputs at idle ---- */
    int drdy_idle = gpio_get_level(ADS_PIN_DRDY);
    int miso_idle = gpio_get_level(ADS_PIN_MISO);

    printf("[PIN] DRDY  (GPIO%2d) idle = %d  %s\n",
           ADS_PIN_DRDY, drdy_idle,
           drdy_idle == 1 ? "OK (HIGH before conversion)" : "WARN: LOW at idle");
    printf("[PIN] MISO  (GPIO%2d) idle = %d  %s\n",
           ADS_PIN_MISO, miso_idle,
           miso_idle == 1 ? "OK (chip driving MISO high)" :
                            "WARN: LOW — chip mungkin power-down / PWDN tidak ke AVDD");

    /* ---- 2. CS toggle — verify CS reaches chip (visual check point) ---- */
    printf("[PIN] CS    (GPIO%2d) drive HIGH → %d  (expect 1)\n",
           ADS_PIN_CS, gpio_get_level(ADS_PIN_CS));
    gpio_set_level(ADS_PIN_CS, 0);
    vTaskDelay(pdMS_TO_TICKS(1));
    printf("[PIN] CS    (GPIO%2d) drive LOW  → %d  (expect 0)\n",
           ADS_PIN_CS, gpio_get_level(ADS_PIN_CS));
    gpio_set_level(ADS_PIN_CS, 1);

    /* ---- 3. MOSI–MISO short check ---- */
    /* Drive MOSI LOW, see if MISO follows */
    gpio_set_level(ADS_PIN_MOSI, 0);
    vTaskDelay(pdMS_TO_TICKS(2));
    int miso_when_mosi_low = gpio_get_level(ADS_PIN_MISO);

    /* Drive MOSI HIGH, see if MISO follows */
    gpio_set_level(ADS_PIN_MOSI, 1);
    vTaskDelay(pdMS_TO_TICKS(2));
    int miso_when_mosi_high = gpio_get_level(ADS_PIN_MISO);
    gpio_set_level(ADS_PIN_MOSI, 0);

    printf("[PIN] MOSI→LOW  : MISO=%d | MOSI→HIGH : MISO=%d  ",
           miso_when_mosi_low, miso_when_mosi_high);
    if (miso_when_mosi_low == 0 && miso_when_mosi_high == 1)
        printf("WARN: MISO mengikuti MOSI → kemungkinan SHORT / pin salah konek!\n");
    else if (miso_when_mosi_low == miso_when_mosi_high)
        printf("OK (MISO tidak mengikuti MOSI)\n");
    else
        printf("(tidak konsisten — cek noise)\n");

    /* ---- 4. RESET toggle ---- */
    printf("[PIN] RESET (GPIO%2d) drive HIGH → %d  (expect 1)\n",
           ADS_PIN_RESET, gpio_get_level(ADS_PIN_RESET));
    gpio_set_level(ADS_PIN_RESET, 0);
    vTaskDelay(pdMS_TO_TICKS(1));
    printf("[PIN] RESET (GPIO%2d) drive LOW  → %d  (expect 0)\n",
           ADS_PIN_RESET, gpio_get_level(ADS_PIN_RESET));
    gpio_set_level(ADS_PIN_RESET, 1);
    vTaskDelay(pdMS_TO_TICKS(5));

    /* ---- 5. DRDY after RESET released ---- */
    int drdy_post_rst = gpio_get_level(ADS_PIN_DRDY);
    printf("[PIN] DRDY post-reset = %d  %s\n",
           drdy_post_rst,
           drdy_post_rst == 1 ? "OK" : "WARN: DRDY still LOW after reset");

    /* ---- 6. CS readback with extended wait ----
       If CS reads 0, hold for 100ms — if it rises after delay, there is a
       capacitor on the CS line (RC filter on module). If still 0, it is a
       hard pull-down or short. */
    int cs_hi_immediate = gpio_get_level(ADS_PIN_CS);
    vTaskDelay(pdMS_TO_TICKS(100));
    int cs_hi_delayed = gpio_get_level(ADS_PIN_CS);
    printf("[PIN] CS    (GPIO%2d) HIGH immediate=%d  after 100ms=%d  ",
           ADS_PIN_CS, cs_hi_immediate, cs_hi_delayed);
    if (cs_hi_immediate == 1)
        printf("OK\n");
    else if (cs_hi_delayed == 1)
        printf("WARN: CS naik lambat → ada kapasitor di CS line (RC filter)\n");
    else
        printf("FAIL: CS stuck LOW → short ke GND atau pull-down kuat di modul ADS\n");

    /* ---- 7. CS readback information ---- */
    if (cs_hi_immediate == 0 && cs_hi_delayed == 0) {
        printf("[PIN] DIAGNOSIS CS: GPIO%d bisa drive HIGH tapi line stuck LOW.\n", ADS_PIN_CS);
        printf("[PIN]   Cek: apakah kabel CS terhubung ke GND breadboard?\n");
        printf("[PIN]   Cek: apakah modul ADS punya pull-down di CS pin?\n");
        printf("[PIN]   → Coba cabut kabel CS dari ADS1299, apakah GPIO%d baca 1?\n", ADS_PIN_CS);
    }

    /* ---- DOUT connectivity — loopback + RC test ---- */
    printf("\n[DOUT CHECK] Testing MISO/DOUT pin (GPIO%d)...\n", ADS_PIN_MISO);

    /* Reset GPIO26 (isolated test pin) to INPUT so it doesn't drive GPIO19 LOW
       if a loopback wire is connected between them. */
    gpio_reset_pin(ISOLATED_TEST_GPIO);
    gpio_set_direction(ISOLATED_TEST_GPIO, GPIO_MODE_INPUT);

    /* RC decay test — probabilistic, ~85% accurate.
       NOTE: if GPIO26 loopback wire is attached it will slightly affect reading,
       but since GPIO26 is now INPUT (Hi-Z) it won't pull the line. */
    printf("[DOUT CHECK] NOTE: DOUT Hi-Z when CS=HIGH, so RC test is heuristic only.\n");
    int dout_rc  = dout_rc_test();
    printf("[DOUT CHECK] RC result: %s\n",
           dout_rc == 1 ? "connected" : dout_rc == 0 ? "DISCONNECTED" : "uncertain");

    /* Loopback test — definitive. GPIO26 acts as controlled driver.
       Connect jumper: GPIO26 (pin) → GPIO19 (MISO) before booting.
       If jumper not installed the test will still run and report FAIL,
       which is OK — just reconnect and reboot. */
    printf("[DOUT CHECK] Loopback test (GPIO26 → GPIO19)...\n");
    printf("[DOUT CHECK]   Connect wire: GPIO26 → GPIO19, then wait 3 sec\n");
    vTaskDelay(pdMS_TO_TICKS(3000));
    int dout_lb = dout_loopback_test();
    printf("[DOUT CHECK] Loopback result: %s\n",
           dout_lb ==  1 ? "PASS — GPIO19 wire intact" :
           dout_lb ==  0 ? "FAIL — wire broken or not connected" :
                           "PARTIAL — intermittent (cold solder?)");

    /* ---- Summary ---- */
    printf("[PIN CHECK] ========================================\n");
    int cs_ok = (cs_hi_immediate == 1 || cs_hi_delayed == 1);
    int all_ok = (drdy_idle == 1) && (miso_idle == 1) && cs_ok
              && !(miso_when_mosi_low == 0 && miso_when_mosi_high == 1)
              && (iso_hi == 1 && iso_lo == 0);
    if (all_ok)
        printf("[PIN CHECK] PASS — lanjut ke ads_init()\n");
    else {
        printf("[PIN CHECK] MASALAH DITEMUKAN:\n");
        if (iso_hi != 1 || iso_lo != 0)
            printf("  * ESP32 GPIO output error — cek board\n");
        if (miso_idle == 0)
            printf("  * MISO=0 saat idle → cek PWDN pin ke AVDD (3.3V)\n");
        if (drdy_idle == 0)
            printf("  * DRDY=0 saat idle → chip mungkin sudah mulai konversi\n");
        if (!cs_ok)
            printf("  * CS stuck LOW → SHORT atau pull-down di modul/breadboard\n");
        if (miso_when_mosi_low == 0 && miso_when_mosi_high == 1)
            printf("  * MOSI-MISO short → swap pin atau cek PCB\n");
    }
    printf("[PIN CHECK] ========================================\n\n");
}

/* Software CS helpers — more reliable than hardware CS for debugging.
   tCSS (CS setup to first SCLK): ADS1299 requires ≥6 tCLK @ 2.048 MHz = ~2.93 µs.
   Use 10 µs to give comfortable margin over the minimum spec.
   tCSH (CS hold after last SCLK): similarly ≥6 tCLK; 5 µs satisfies this. */
static inline void cs_low(void)  { gpio_set_level(ADS_PIN_CS, 0); esp_rom_delay_us(10); }
static inline void cs_high(void) { esp_rom_delay_us(5); gpio_set_level(ADS_PIN_CS, 1); esp_rom_delay_us(5); }

static void spi_send_cmd(uint8_t cmd)
{
    uint8_t tx = cmd;
    spi_transaction_t t = { .length = 8, .tx_buffer = &tx };
    printf("[SPI] CMD  → 0x%02X\n", cmd);
    cs_low();
    esp_err_t err = spi_device_polling_transmit(spi, &t);
    cs_high();
    if (err != ESP_OK) printf("[SPI] CMD error: %d\n", err);
    esp_rom_delay_us(10);   /* tSDECODE: ≥4 tCLK @2.048MHz ≈ 2µs, give 10µs margin */
}

static void spi_wreg(uint8_t reg, uint8_t val)
{
    uint8_t buf[3] = { 0x40 | reg, 0x00, val };
    spi_transaction_t t = { .length = 24, .tx_buffer = buf };
    printf("[SPI] WREG reg=0x%02X val=0x%02X\n", reg, val);
    cs_low();
    esp_err_t err = spi_device_polling_transmit(spi, &t);
    cs_high();
    if (err != ESP_OK) printf("[SPI] WREG error: %d\n", err);
    esp_rom_delay_us(10);
}

static uint8_t spi_rreg(uint8_t reg)
{
    /* RREG format: [001r rrrr] [000n nnnn] [n+1 dummy bytes]
       For n=1: tx = {0x20|reg, 0x00, 0x00}, data returned in rx[2] */
    uint8_t tx[3] = { 0x20 | reg, 0x00, 0x00 };
    uint8_t rx[3] = { 0 };
    spi_transaction_t t = { .length = 24, .tx_buffer = tx, .rx_buffer = rx };
    printf("[SPI] RREG reg=0x%02X ...", reg);
    cs_low();
    esp_err_t err = spi_device_polling_transmit(spi, &t);
    cs_high();
    if (err != ESP_OK) {
        printf(" SPI error: %d\n", err);
        return 0xFF;
    }
    printf(" rx=[0x%02X 0x%02X 0x%02X] → val=0x%02X\n",
           rx[0], rx[1], rx[2], rx[2]);
    esp_rom_delay_us(10);
    return rx[2];
}

void ads_init(void)
{
    printf("[ADS] --- ads_init start ---\n");

    gpio_config_t out_cfg = {
        .pin_bit_mask = (1ULL << ADS_PIN_RESET) | (1ULL << ADS_PIN_START),
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&out_cfg);
    printf("[ADS] Output GPIOs configured (RESET=%d, START=%d)\n",
           ADS_PIN_RESET, ADS_PIN_START);

    gpio_config_t in_cfg = {
        .pin_bit_mask = (1ULL << ADS_PIN_DRDY),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&in_cfg);
    printf("[ADS] Input GPIO configured (DRDY=%d)\n", ADS_PIN_DRDY);

    /* Drive PWDN HIGH explicitly — prevents power-down if pin is floating */
    gpio_config_t pwdn_cfg = {
        .pin_bit_mask = (1ULL << ADS_PIN_PWDN),
        .mode         = GPIO_MODE_OUTPUT,
    };
    gpio_config(&pwdn_cfg);
    gpio_set_level(ADS_PIN_PWDN, 1);
    printf("[ADS] PWDN GPIO%d = HIGH (chip out of power-down)\n", ADS_PIN_PWDN);
    vTaskDelay(pdMS_TO_TICKS(20));   /* wait for internal oscillator to stabilize */

    /* CS as plain GPIO (software-controlled) — more reliable for debugging.
       IMPORTANT: set output register HIGH *before* gpio_config() so the pin
       never glitches LOW when the output driver is first enabled.
       ESP32 output register defaults to 0; if gpio_config() runs first,
       there is a brief LOW pulse that can erroneously select the ADS1299. */
    gpio_set_level(ADS_PIN_CS, 1);   /* pre-load output register HIGH */
    gpio_config_t cs_cfg = {
        .pin_bit_mask = (1ULL << ADS_PIN_CS),
        .mode         = GPIO_MODE_OUTPUT,
        /* pull_up_en has no effect in OUTPUT mode on ESP32 — omit to avoid
           misleading readers into thinking it provides a bus pull-up. */
    };
    gpio_config(&cs_cfg);
    printf("[ADS] CS GPIO%d set HIGH (software CS, glitch-free init)\n", ADS_PIN_CS);

    gpio_set_level(ADS_PIN_START, 0);
    gpio_set_level(ADS_PIN_RESET, 1);
    printf("[ADS] START=LOW, RESET=HIGH\n");

    spi_bus_config_t bus = {
        .mosi_io_num   = ADS_PIN_MOSI,
        .miso_io_num   = ADS_PIN_MISO,
        .sclk_io_num   = ADS_PIN_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    /* Read MISO level before SPI init to check if it's stuck */
    gpio_config_t miso_probe = {
        .pin_bit_mask = (1ULL << ADS_PIN_MISO),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    gpio_config(&miso_probe);
    printf("[ADS] MISO level before SPI init = %d (expect 1 if chip drives idle HIGH)\n",
           gpio_get_level(ADS_PIN_MISO));

    printf("[ADS] SPI bus init (MOSI=%d MISO=%d SCLK=%d CS=%d) host=SPI3...\n",
           ADS_PIN_MOSI, ADS_PIN_MISO, ADS_PIN_SCLK, ADS_PIN_CS);
    /* SPI3_HOST = VSPI: native IOMUX pins are MOSI=23 MISO=19 SCLK=18 CS=5.
       Using SPI3 here bypasses the GPIO matrix for direct hardware routing. */
    esp_err_t err = spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_DISABLED);
    printf("[ADS] spi_bus_initialize: %s (%d)\n", esp_err_to_name(err), err);

    spi_device_interface_config_t dev = {
        .clock_speed_hz = 500 * 1000,   /* 500 kHz — safe margin under 1.024 MHz ADS limit */
        .mode           = 1,            /* CPOL=0, CPHA=1 per ADS1299 datasheet */
        .spics_io_num   = -1,           /* software CS: we toggle GPIO manually */
        .queue_size     = 1,
    };
    err = spi_bus_add_device(SPI3_HOST, &dev, &spi);
    printf("[ADS] spi_bus_add_device: %s (%d)\n", esp_err_to_name(err), err);

    /* Enable internal pull-up on MISO so the line reads HIGH when chip
       tristate (CS deasserted). Without this, floating MISO shows false
       coupling from nearby MOSI wire on a breadboard. */
    gpio_set_pull_mode(ADS_PIN_MISO, GPIO_PULLUP_ONLY);
    printf("[ADS] MISO pull-up enabled\n");

    /* Power-on settling */
    printf("[ADS] Power-on settling 500ms...\n");
    vTaskDelay(pdMS_TO_TICKS(500));

    /* Hardware reset pulse */
    printf("[ADS] RESET pulse...\n");
    gpio_set_level(ADS_PIN_RESET, 0);
    vTaskDelay(pdMS_TO_TICKS(100));
    gpio_set_level(ADS_PIN_RESET, 1);
    /* tPOR = 2^18 / 2.048 MHz = 128 ms minimum after RESET release.
     * 150 ms gives ~17% margin. */
    vTaskDelay(pdMS_TO_TICKS(150));
    printf("[ADS] DRDY after reset = %d (expect 1 until conversion starts)\n",
           gpio_get_level(ADS_PIN_DRDY));
    printf("[ADS] MISO after reset  = %d\n", gpio_get_level(ADS_PIN_MISO));

    /* Stop continuous data read mode so register access works.
       ADS1299 default after reset is SDATAC, but send it explicitly anyway. */
    spi_send_cmd(ADS_CMD_SDATAC);
    vTaskDelay(pdMS_TO_TICKS(10));

    /* CONFIG3 POR = 0x60 (reference buffer powered down).
     * 0xE0 = PD_REFBUF=1 (enable internal reference) + hardcoded-1 bit6.
     * Bias amplifier (PD_BIAS, BIASREF_INT) stays off — correct for bringup
     * without a wired BIASOUT electrode. Enable bias separately in production. */
    printf("[ADS] CONFIG3 = 0xE0 (enable internal VREF, bias off)...\n");
    spi_wreg(ADS_REG_CONFIG3, 0xE0);
    vTaskDelay(pdMS_TO_TICKS(150));

    /* CONFIG1: daisy-chain disabled, 250 SPS */
    spi_wreg(ADS_REG_CONFIG1, 0x96);
    /* CONFIG2: default test signal settings */
    spi_wreg(ADS_REG_CONFIG2, 0xC0);

    /* Read back to verify writes landed */
    printf("[ADS] Verify register reads:\n");
    printf("[ADS]   CONFIG1 = 0x%02X (expect 0x96)\n", spi_rreg(ADS_REG_CONFIG1));
    printf("[ADS]   CONFIG2 = 0x%02X (expect 0xC0)\n", spi_rreg(ADS_REG_CONFIG2));
    printf("[ADS]   CONFIG3 = 0x%02X (expect 0xE0)\n", spi_rreg(ADS_REG_CONFIG3));

    printf("[ADS] --- ads_init done ---\n");
}

uint8_t ads_read_id(void)
{
    printf("[ADS] Reading ID register...\n");
    uint8_t id = spi_rreg(ADS_REG_ID);
    printf("[ADS] ID = 0x%02X\n", id);
    printf("[ADS]   device type bits [4:2] = 0x%X\n", (id >> 2) & 0x7);
    printf("[ADS]   channel count bits [1:0] = 0x%X (%d ch)\n",
           id & 0x3, (id & 0x3) == 0x3 ? 8 : (id & 0x3) == 0x2 ? 6 : 4);
    return id;
}

void ads_start(void)
{
    printf("[ADS] Starting continuous conversion...\n");
    /* Ensure clean LOW→HIGH edge regardless of prior state. */
    gpio_set_level(ADS_PIN_START, 0);
    esp_rom_delay_us(10);
    gpio_set_level(ADS_PIN_START, 1);

    /* Wait for first conversion to complete before RDATAC.
     * At 250 SPS one period = 4 ms; 1ms polling tick is fine. */
    {
        int64_t t0 = esp_timer_get_time();
        while (gpio_get_level(ADS_PIN_DRDY) == 1) {
            vTaskDelay(1);
            if (esp_timer_get_time() - t0 > 20000) {   /* 20 ms timeout */
                printf("[ADS] WARN: DRDY did not pulse within 20ms after START\n");
                break;
            }
        }
    }
    spi_send_cmd(ADS_CMD_RDATAC);
    printf("[ADS] RDATAC sent, DRDY = %d\n", gpio_get_level(ADS_PIN_DRDY));

    /* --- DRDY pulse test ---
       After START+RDATAC, a live chip pulses DRDY LOW at 250 SPS (every 4ms).
       Count pulses for 200ms. 0 pulses = chip not receiving CS or not started. */
    printf("[ADS] DRDY pulse test (200ms)...\n");
    int pulses = 0;
    int last = gpio_get_level(ADS_PIN_DRDY);
    uint32_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(200);
    while (xTaskGetTickCount() < deadline) {
        int now = gpio_get_level(ADS_PIN_DRDY);
        if (last == 1 && now == 0) pulses++;   /* falling edge = new sample */
        last = now;
        vTaskDelay(1);
    }
    printf("[ADS] DRDY pulses in 200ms: %d  ", pulses);
    if (pulses >= 40)
        printf("OK — chip converting (~%d SPS)\n", pulses * 5);
    else if (pulses > 0)
        printf("WARN — beberapa pulsa, tapi kurang dari expected (~50 SPS, expect 50)\n");
    else {
        printf("FAIL — 0 pulsa!\n");
        printf("[ADS]   → Cek fisik: CS wire dari GPIO%d ke pin ~CS ADS1299\n", ADS_PIN_CS);
        printf("[ADS]   → Cek fisik: START wire dari GPIO%d ke pin START ADS1299\n", ADS_PIN_START);
        printf("[ADS]   → Cek fisik: SCLK wire dari GPIO%d ke pin SCLK ADS1299\n", ADS_PIN_SCLK);
    }
}

void ads_read_data(int32_t *ch_out)
{
    /* In RDATAC mode reading while DRDY=HIGH returns stale data and risks a
     * torn frame if DRDY falls mid-transfer. Caller is responsible for gating
     * on DRDY, but add a defensive poll here to catch accidental early calls. */
    if (gpio_get_level(ADS_PIN_DRDY) == 1) {
        printf("[ADS] WARN: ads_read_data called while DRDY HIGH — stale data\n");
    }

    uint8_t tx[27] = { 0 };
    uint8_t rx[27] = { 0 };
    spi_transaction_t t = {
        .length    = 27 * 8,
        .tx_buffer = tx,
        .rx_buffer = rx,
    };
    cs_low();
    spi_device_polling_transmit(spi, &t);
    cs_high();

    for (int i = 0; i < 8; i++) {
        int     offset = 3 + i * 3;
        int32_t val    = ((int32_t)rx[offset]   << 16)
                       | ((int32_t)rx[offset+1] <<  8)
                       |  (int32_t)rx[offset+2];
        if (val & 0x800000) val |= 0xFF000000;
        ch_out[i] = val;
    }
}
