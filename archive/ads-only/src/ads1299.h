#pragma once
#include <stdint.h>

/* ==================================================================
 * PIN MAP — dari schematic board ini sendiri (prototype_1.kicad_sch)
 * ==================================================================
 * Sumber: PDF "proto1" yang berisi U1 ADS1299-4PAGR + U2 ESP32-DEVKITC.
 * Ini schematic yang benar-benar dipakai, bukan WIRING_FINAL.md dan bukan
 * Cerelog. Peta pin sebelumnya (13/12/14/27) salah semua.
 *
 *   ADS kaki | Sinyal | Net schematic | ESP32
 *   ---------+--------+---------------+---------------------------
 *      34    | DIN    | MOSI          | GPIO23
 *      35    | *PWDN  | -             | TIDAK tersambung ke ESP32
 *      36    | *RESET | GPIO22        | GPIO22 (dipindah dari GPIO2)
 *      38    | START  | GPIO3         | MENGGANTUNG di schematic
 *      39    | *CS    | CS            | GPIO5
 *      40    | SCLK   | SCK           | GPIO18
 *      43    | DOUT   | MISO          | GPIO19
 *      47    | *DRDY  | GPIO4         | GPIO4
 *
 * Supply (supply tunggal):
 *   AVDD 19,21,22,56,59 + AVDD1 54  → EXT_5V dari ESP32 (terukur 4.7 V)
 *   AVSS 20,23,32,57,58 + AVSS1 53  → GND
 *   DVDD 48,50                      → 3.3 V
 *   CLKSEL 52 → R7 10k → 3.3 V      (internal oscillator)
 *   PWDN 35   → R12 10k → 3.3 V     (selalu aktif, tidak perlu di-drive)
 *   DAISY_IN 41, BIASREF 60, DGND 33/49/51 → GND
 *   CLK 37 → NC
 */
#define ADS_PIN_MOSI  23   /* ADS 34  DIN    */
#define ADS_PIN_RESET 22   /* ADS 36  *RESET */
#define ADS_PIN_CS     5   /* ADS 39  *CS    */
#define ADS_PIN_SCLK  18   /* ADS 40  SCLK   */
#define ADS_PIN_MISO  19   /* ADS 43  DOUT   */
#define ADS_PIN_DRDY   4   /* ADS 47  *DRDY  */

/* START (kaki 38) diberi label net GPIO3 di schematic, tapi di sisi ESP32
 * tidak ada pin yang memakai label itu, jadi jalurnya menggantung. IO3
 * adalah RXD0 dan tidak boleh dipakai karena mengganggu log serial.
 *
 * Solusinya: pindahkan kabel START ke GPIO21 (kosong dan aman).
 * Tanpa START, chip tidak pernah mulai konversi dan DRDY diam selamanya. */
#define ADS_PIN_START 21   /* ADS 38  START — perlu satu kabel baru */

/* PWDN tidak tersambung ke ESP32 di board ini; R12 menahannya HIGH terus,
 * jadi chip selalu aktif dan firmware tidak perlu (dan tidak boleh)
 * men-drive pin mana pun untuk ini. */

/* RESET lewat pin (1) atau lewat perintah SPI 0x06 (0).
 * Dipindah dari GPIO2 ke GPIO22: GPIO2 adalah strapping pin, dan dengan
 * jalur ADS menempel di sana ESP32 gagal masuk bootloader saat flashing
 * ("chip stopped responding"). GPIO22 bebas dari masalah itu. */
#define ADS_USE_HW_RESET 1

/* --- Commands --- */
#define ADS_CMD_WAKEUP  0x02
#define ADS_CMD_STANDBY 0x04
#define ADS_CMD_RESET   0x06
#define ADS_CMD_START   0x08
#define ADS_CMD_STOP    0x0A
#define ADS_CMD_RDATAC  0x10
#define ADS_CMD_SDATAC  0x11
#define ADS_CMD_RDATA   0x12

/* --- Registers --- */
#define ADS_REG_ID         0x00
#define ADS_REG_CONFIG1    0x01
#define ADS_REG_CONFIG2    0x02
#define ADS_REG_CONFIG3    0x03
#define ADS_REG_LOFF       0x04
#define ADS_REG_CH1SET     0x05   /* CH1..CH8 = 0x05..0x0C */
#define ADS_REG_BIAS_SENSP 0x0D
#define ADS_REG_BIAS_SENSN 0x0E
#define ADS_REG_MISC1      0x15
#define ADS_REG_CONFIG4    0x17
