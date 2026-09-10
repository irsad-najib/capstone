/* ADS1299 diagnostic v7 — RREG ID + WREG verify dengan GPIO34 sebagai MISO.
 *
 * GPIO scan v6 menemukan: DOUT ada di GPIO34.
 * v7 ini baca ID register langsung pakai GPIO34 sebagai MISO,
 * dan verifikasi WREG dengan fix timing START.
 */

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "ads1299.h"

static void bb_init(void)
{
    gpio_set_direction(ADS_PIN_MOSI,  GPIO_MODE_OUTPUT);
    gpio_set_direction(ADS_PIN_SCLK,  GPIO_MODE_OUTPUT);
    gpio_set_direction(ADS_PIN_CS,    GPIO_MODE_OUTPUT);
    gpio_set_direction(ADS_PIN_RESET, GPIO_MODE_OUTPUT);
    gpio_set_direction(ADS_PIN_START, GPIO_MODE_OUTPUT);
    gpio_set_direction(ADS_PIN_PWDN,  GPIO_MODE_OUTPUT);
    gpio_set_direction(ADS_PIN_DRDY,  GPIO_MODE_INPUT);
    gpio_set_pull_mode(ADS_PIN_DRDY,  GPIO_PULLUP_ONLY);

    /* GPIO34 = input only, no internal pull-up — just set direction */
    gpio_set_direction(ADS_PIN_MISO,  GPIO_MODE_INPUT);

    gpio_set_level(ADS_PIN_SCLK,  0);
    gpio_set_level(ADS_PIN_CS,    1);
    gpio_set_level(ADS_PIN_MOSI,  0);
    gpio_set_level(ADS_PIN_RESET, 1);
    gpio_set_level(ADS_PIN_START, 0);
    gpio_set_level(ADS_PIN_PWDN,  1);
}

/* SPI Mode 1, 5ms/half-bit, returns received byte from MISO */
static uint8_t bb_transfer_byte(uint8_t tx)
{
    uint8_t rx = 0;
    for (int bit = 7; bit >= 0; bit--) {
        gpio_set_level(ADS_PIN_SCLK, 0);
        gpio_set_level(ADS_PIN_MOSI, (tx >> bit) & 1);
        vTaskDelay(pdMS_TO_TICKS(5));
        gpio_set_level(ADS_PIN_SCLK, 1);
        vTaskDelay(pdMS_TO_TICKS(5));
        /* Sample MISO after rising edge — DOUT stable here (Mode 1) */
        rx = (rx << 1) | gpio_get_level(ADS_PIN_MISO);
    }
    gpio_set_level(ADS_PIN_SCLK, 0);
    return rx;
}

static void bb_cmd(uint8_t op)
{
    gpio_set_level(ADS_PIN_CS, 0); vTaskDelay(pdMS_TO_TICKS(2));
    bb_transfer_byte(op);
    vTaskDelay(pdMS_TO_TICKS(2));
    gpio_set_level(ADS_PIN_CS, 1);
    vTaskDelay(pdMS_TO_TICKS(10));
}

static int count_drdy(int ms)
{
    int cnt = 0, last = gpio_get_level(ADS_PIN_DRDY);
    int64_t end = esp_timer_get_time() + (int64_t)ms * 1000;
    while (esp_timer_get_time() < end) {
        int now = gpio_get_level(ADS_PIN_DRDY);
        if (last == 1 && now == 0) cnt++;
        last = now;
    }
    return cnt;
}

void app_main(void)
{
    vTaskDelay(pdMS_TO_TICKS(4000));
    bb_init();

    printf("\n=============================================================\n");
    printf(" ADS1299 v7 — RREG ID via GPIO34 + WREG verify\n");
    printf("=============================================================\n\n");

    printf("[INFO] ADS_PIN_MISO = GPIO%d (scan v6 result)\n\n", ADS_PIN_MISO);

    /* ---- DRDY baseline ---- */
    gpio_set_level(ADS_PIN_START, 1);
    int baseline = count_drdy(2000);
    gpio_set_level(ADS_PIN_START, 0);
    printf("[BASE] DRDY baseline = %d/2s → ~%d SPS\n\n", baseline, baseline / 2);

    /* ================================================================
     * PHASE 1 — RREG ID (primary test: can we read ADS1299 ID?)
     * Expected: 0x3E (ADS1299 8-ch) or 0x1E / 0x3E depending on revision
     * ================================================================ */
    printf("[RREG] === PHASE 1: Read ID register ===\n");

    /* Reset bersih */
    gpio_set_level(ADS_PIN_RESET, 0); vTaskDelay(pdMS_TO_TICKS(100));
    gpio_set_level(ADS_PIN_RESET, 1); vTaskDelay(pdMS_TO_TICKS(500));

    /* SDATAC dulu agar bisa baca register */
    printf("[RREG] Sending SDATAC...\n");
    bb_cmd(0x11);
    vTaskDelay(pdMS_TO_TICKS(20));

    /* RREG register 0 (ID): cmd=0x20, count=0x00, dummy=0x00 */
    printf("[RREG] Sending RREG 0x20 0x00 (read ID reg)...\n");
    gpio_set_level(ADS_PIN_CS, 0);
    vTaskDelay(pdMS_TO_TICKS(2));

    uint8_t r0 = bb_transfer_byte(0x20);  /* RREG command */
    uint8_t r1 = bb_transfer_byte(0x00);  /* count = 1 reg */
    uint8_t id = bb_transfer_byte(0x00);  /* dummy → ID data comes here */

    vTaskDelay(pdMS_TO_TICKS(2));
    gpio_set_level(ADS_PIN_CS, 1);

    printf("[RREG] Byte0 (cmd echo): 0x%02X\n", r0);
    printf("[RREG] Byte1 (cnt echo): 0x%02X\n", r1);
    printf("[RREG] Byte2 (ID data) : 0x%02X = ", id);
    for (int b = 7; b >= 0; b--) printf("%d", (id >> b) & 1);
    printf("\n\n");

    if (id == 0xFF) {
        printf("[RREG] FAIL — ID=0xFF, DOUT tidak driven\n");
        printf("[RREG] GPIO34 tidak terhubung ke DOUT, atau SCLK/CS cold joint\n\n");
    } else if (id == 0x00) {
        printf("[RREG] FAIL — ID=0x00, GPIO34 stuck LOW / short ke GND\n\n");
    } else if ((id & 0xE0) == 0xC0) {
        printf("[RREG] *** PASS *** ID valid! Upper nibble = 0x%X (ADS129x family)\n", (id >> 5) & 0x7);
        printf("[RREG] Device = ADS%d\n", (id & 0x1C) == 0x0C ? 1299 : 1298);
        printf("[RREG] Revision = %d\n", id & 0x03);
        printf("[RREG] GPIO34 = DOUT CONFIRMED! SPI BERJALAN!\n\n");
    } else {
        printf("[RREG] ID = 0x%02X — tidak dikenal, tapi bukan 0xFF/0x00\n", id);
        printf("[RREG] Kemungkinan: data nyasar, edge timing off, atau Mode salah\n\n");
    }

    /* ================================================================
     * PHASE 2 — WREG verify (ubah data rate 250→500 SPS)
     * Setelah SDATAC: WREG CONFIG1=0x95, lalu START pulse, ukur DRDY
     * ================================================================ */
    printf("[WREG] === PHASE 2: WREG verify (CONFIG1 = 0x95 = 500 SPS) ===\n");

    /* SDATAC ulang untuk pastikan state bersih */
    bb_cmd(0x11);
    vTaskDelay(pdMS_TO_TICKS(20));

    /* WREG CONFIG1 = 0x95 */
    printf("[WREG] Writing CONFIG1 = 0x95...\n");
    gpio_set_level(ADS_PIN_CS, 0); vTaskDelay(pdMS_TO_TICKS(2));
    bb_transfer_byte(0x41);   /* WREG reg 0x01 */
    bb_transfer_byte(0x00);   /* write 1 register */
    bb_transfer_byte(0x95);   /* 500 SPS */
    vTaskDelay(pdMS_TO_TICKS(2));
    gpio_set_level(ADS_PIN_CS, 1);
    vTaskDelay(pdMS_TO_TICKS(50));

    /* START pulse: LOW → HIGH untuk trigger konversi baru */
    gpio_set_level(ADS_PIN_START, 0); vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(ADS_PIN_START, 1);
    int after_wreg = count_drdy(2000);
    gpio_set_level(ADS_PIN_START, 0);
    int sps_after = after_wreg / 2;
    printf("[WREG] DRDY setelah WREG = %d/2s → ~%d SPS\n", after_wreg, sps_after);

    if (sps_after > 400) {
        printf("[WREG] *** PASS *** DRDY berubah %d→%d SPS!\n", baseline / 2, sps_after);
        printf("[WREG] MOSI + CS + SCLK semua BERFUNGSI sampai ke chip.\n\n");
    } else if (sps_after > 50) {
        printf("[WREG] SPS ada tapi tidak 500 → partial/noisy connection\n\n");
    } else {
        printf("[WREG] FAIL — rate tidak berubah (%d SPS)\n\n", sps_after);
    }

    /* ================================================================
     * PHASE 3 — Baca beberapa register lagi untuk konfirmasi
     * ================================================================ */
    printf("[RREG] === PHASE 3: Read CONFIG1, CONFIG2, CONFIG3 ===\n");

    /* Reset + SDATAC ulang */
    gpio_set_level(ADS_PIN_RESET, 0); vTaskDelay(pdMS_TO_TICKS(100));
    gpio_set_level(ADS_PIN_RESET, 1); vTaskDelay(pdMS_TO_TICKS(500));
    bb_cmd(0x11);
    vTaskDelay(pdMS_TO_TICKS(20));

    /* RREG 4 registers mulai dari reg 0 (ID, CONFIG1, CONFIG2, CONFIG3) */
    gpio_set_level(ADS_PIN_CS, 0); vTaskDelay(pdMS_TO_TICKS(2));
    bb_transfer_byte(0x20);   /* RREG dari reg 0 */
    bb_transfer_byte(0x03);   /* baca 4 registers */
    uint8_t regs[4];
    for (int i = 0; i < 4; i++) regs[i] = bb_transfer_byte(0x00);
    vTaskDelay(pdMS_TO_TICKS(2));
    gpio_set_level(ADS_PIN_CS, 1);

    const char *names[] = {"ID      ", "CONFIG1 ", "CONFIG2 ", "CONFIG3 "};
    uint8_t defaults[]  = {0x3E, 0x96, 0xC4, 0xEC};
    printf("[RREG] Reg  Expected  Got   Match?\n");
    for (int i = 0; i < 4; i++) {
        printf("[RREG] %s  0x%02X      0x%02X  %s\n",
               names[i], defaults[i], regs[i],
               regs[i] == defaults[i] ? "YES ✓" :
               (regs[i] != 0xFF && regs[i] != 0x00) ? "CLOSE (partial)" : "NO ✗");
    }

    printf("\n=============================================================\n");
    printf(" KESIMPULAN:\n");
    if (id != 0xFF && id != 0x00) {
        printf(" GPIO34 = DOUT TERKONFIRMASI\n");
        printf(" Update kabel MISO ke GPIO34 (sudah di ads1299.h)\n");
        if (sps_after > 400) printf(" WREG juga bekerja — SPI fully functional!\n");
    } else {
        printf(" GPIO34 tidak terbukti = DOUT\n");
        printf(" Kemungkinan: cold joint IC pin 43 (DOUT) atau 40 (SCLK)\n");
        printf(" Coba reflow solder di kedua pin tersebut\n");
    }
    printf("=============================================================\n");

    while (1) vTaskDelay(pdMS_TO_TICKS(5000));
}
