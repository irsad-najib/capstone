/* Pembacaan baterai lewat pembagi tegangan di IO35.
 *
 *   V_pin = VBAT × R9 / (R8 + R9) = VBAT × 100k / 320k
 *
 * Asumsi: Li-ion 1 sel (3.0–4.2 V). Persentase dari tabel kurva discharge
 * (tegangan saat beban ringan), bukan linear, supaya angka di tengah lebih jujur.
 * Untuk paket 2 sel ubah BAT_CELLS ke 2.
 */

#include "battery.h"

#include <stdio.h>
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_timer.h"
#include "net.h"   /* LOG() */

#define PIN_BAT_SENSE   35
#define R_TOP_K         220.0f    /* R8 */
#define R_BOTTOM_K      100.0f    /* R9 */
#define BAT_CELLS       1
#define SAMPLES         16
#define POLL_US         1000000
#define EMA_ALPHA       0.2f      /* penghalusan antar pembacaan */
#define MIN_PRESENT_MV  2500      /* di bawah ini per sel: anggap tidak terpasang */
#define LOW_PCT         15
#define CRIT_MV         3300      /* per sel: di bawah ini (≥ CRIT_POLLS kali) stimulus + akuisisi berhenti */
#define CRIT_CLEAR_MV   3600      /* per sel: perintah diizinkan lagi di atas ini */
#define CRIT_POLLS      3         /* ~3 detik berturut-turut */

/* Kalibrasi dua titik: VBAT_benar = VBAT_terbaca × GAIN + OFFSET.
 * Ukur baterai dengan multimeter di ~4.1 V dan ~3.6 V, bandingkan dengan perintah "bat". */
#define BAT_CAL_GAIN      1.000f
#define BAT_CAL_OFFSET_MV 0.0f

/* mV per sel → persen, urut menurun. */
static const struct { int mv; int pct; } CURVE[] = {
    { 4200, 100 }, { 4150, 95 }, { 4110, 90 }, { 4080, 85 }, { 4020, 80 },
    { 3980,  75 }, { 3950, 70 }, { 3910, 65 }, { 3870, 60 }, { 3850, 55 },
    { 3840,  50 }, { 3820, 45 }, { 3800, 40 }, { 3790, 35 }, { 3770, 30 },
    { 3750,  25 }, { 3730, 20 }, { 3710, 15 }, { 3690, 10 }, { 3610,  5 },
    { 3270,   0 },
};
#define CURVE_N (sizeof(CURVE) / sizeof(CURVE[0]))

static adc_oneshot_unit_handle_t adc;
static adc_cali_handle_t         cali;
static adc_channel_t             chan;
static bool                      ready, present, warned_low, critical;
static int                       crit_count;
static float                     vbat_mv;   /* hasil EMA */
static int64_t                   next_us;

static int pct_from_cell_mv(int mv)
{
    if (mv >= CURVE[0].mv) return 100;
    for (size_t i = 1; i < CURVE_N; i++) {
        if (mv >= CURVE[i].mv) {
            int dv = CURVE[i - 1].mv - CURVE[i].mv;
            int dp = CURVE[i - 1].pct - CURVE[i].pct;
            return CURVE[i].pct + (mv - CURVE[i].mv) * dp / dv;
        }
    }
    return 0;
}

void battery_init(void)
{
    adc_unit_t unit;
    if (adc_oneshot_io_to_channel(PIN_BAT_SENSE, &unit, &chan) != ESP_OK) {
        LOG("BAT", "IO%d bukan pin ADC", PIN_BAT_SENSE);
        return;
    }
    adc_oneshot_unit_init_cfg_t ucfg = { .unit_id = unit };
    if (adc_oneshot_new_unit(&ucfg, &adc) != ESP_OK) {
        LOG("BAT", "ADC%d gagal diinisialisasi", unit + 1);
        return;
    }
    adc_oneshot_chan_cfg_t ccfg = { .atten = ADC_ATTEN_DB_6, .bitwidth = ADC_BITWIDTH_DEFAULT };
    adc_oneshot_config_channel(adc, chan, &ccfg);

    adc_cali_line_fitting_config_t lcfg = {
        .unit_id = unit, .atten = ADC_ATTEN_DB_6, .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    if (adc_cali_create_scheme_line_fitting(&lcfg, &cali) != ESP_OK) {
        cali = NULL;
        LOG("BAT", "kalibrasi ADC tidak ada di eFuse, pakai perkiraan kasar");
    }
    ready = true;
    next_us = 0;
    battery_poll();
}

static int read_pin_mv(void)
{
    int sum = 0;
    for (int i = 0; i < SAMPLES; i++) {
        int raw = 0;
        adc_oneshot_read(adc, chan, &raw);
        sum += raw;
    }
    int raw = sum / SAMPLES;
    int mv;
    if (cali && adc_cali_raw_to_voltage(cali, raw, &mv) == ESP_OK) return mv;
    return raw * 1750 / 4095;   /* atenuasi 6 dB ≈ 0–1.75 V (pin maks 4.2 V × 100k/320k = 1.31 V) */
}

void battery_poll(void)
{
    if (!ready) return;
    int64_t now = esp_timer_get_time();
    if (now < next_us) return;
    next_us = now + POLL_US;

    float mv = read_pin_mv() * (R_TOP_K + R_BOTTOM_K) / R_BOTTOM_K * BAT_CAL_GAIN + BAT_CAL_OFFSET_MV;
    bool was_present = present;
    present = mv >= MIN_PRESENT_MV * BAT_CELLS;
    if (!present) {
        if (was_present) LOG("BAT", "baterai tidak terdeteksi");
        crit_count = 0;
        critical   = false;
        return;
    }
    vbat_mv = was_present ? vbat_mv + (mv - vbat_mv) * EMA_ALPHA : mv;

    int cell = (int)(vbat_mv / BAT_CELLS);
    if (cell < CRIT_MV) {
        if (!critical && ++crit_count >= CRIT_POLLS) {
            critical = true;
            LOG("BAT", "KRITIS: %.2f V < %.1f V, stimulus dan akuisisi dihentikan, isi ulang baterai",
                vbat_mv / 1000.0f, CRIT_MV * BAT_CELLS / 1000.0f);
        }
    } else {
        crit_count = 0;
        if (critical && cell > CRIT_CLEAR_MV) {
            critical = false;
            LOG("BAT", "baterai %.2f V, perintah stimulus diizinkan lagi", vbat_mv / 1000.0f);
        }
    }

    int pct;
    battery_get(NULL, &pct);
    if (pct <= LOW_PCT && !warned_low) {
        warned_low = true;
        LOG("BAT", "baterai lemah: %d%% (%.2f V), segera isi ulang", pct, vbat_mv / 1000.0f);
    } else if (pct > LOW_PCT + 5) {
        warned_low = false;
    }
}

bool battery_get(int *mv, int *pct)
{
    if (!ready || !present) return false;
    if (mv)  *mv  = (int)vbat_mv;
    if (pct) *pct = pct_from_cell_mv((int)(vbat_mv / BAT_CELLS));
    return true;
}

bool battery_critical(void) { return critical; }
