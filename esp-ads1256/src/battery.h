#pragma once
#include <stdbool.h>

/* Battery sense (skematik Board 2): VBAT_RAW → R8 220k → BAT_SENSE (IO35) → R9 100k → GND.
 * IO35 ada di ADC1, jadi aman dipakai bersamaan dengan WiFi. */

void battery_init(void);

/* Panggil berkala dari satu task; membaca ADC tiap ~1 detik. */
void battery_poll(void);

/* false kalau baterai tidak terpasang / ADC gagal. mv = tegangan baterai, pct = 0..100. */
bool battery_get(int *mv, int *pct);

/* true kalau baterai < 3.3 V/sel selama ~3 detik; kembali false di atas 3.6 V/sel.
 * Selama true, stimulus dan akuisisi dihentikan dan perintah stimulus ditolak. */
bool battery_critical(void);
