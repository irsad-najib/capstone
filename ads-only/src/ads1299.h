#pragma once
#include <stdint.h>

#define ADS_CMD_SDATAC  0x11
#define ADS_CMD_RDATAC  0x10
#define ADS_CMD_START   0x08

#define ADS_REG_ID      0x00
#define ADS_REG_CONFIG1 0x01
#define ADS_REG_CONFIG2 0x02
#define ADS_REG_CONFIG3 0x03

/* ESP32 GPIO → ADS1299 TQFP-64 PAG physical pin (datasheet SBAS499)
 *   GPIO23 → pin 34  DIN
 *   GPIO19 → pin 43  DOUT
 *   GPIO18 → pin 40  SCLK
 *   GPIO33 → pin 39  CS
 *   GPIO4  → pin 47  DRDY
 *   GPIO27 → pin 36  RESET
 *   GPIO14 → pin 38  START
 *   GPIO16 → pin 35  PWDN
 */
#define ADS_PIN_MOSI  23   /* → ADS pin 34 DIN   */
#define ADS_PIN_MISO  34   /* → ADS pin 43 DOUT  (GPIO scan v6 confirmed GPIO34) */
#define ADS_PIN_SCLK  18   /* → ADS pin 40 SCLK  */
#define ADS_PIN_CS    33   /* → ADS pin 39 CS    */
#define ADS_PIN_DRDY   4   /* → ADS pin 47 DRDY  */
#define ADS_PIN_RESET 27   /* → ADS pin 36 RESET */
#define ADS_PIN_START 14   /* → ADS pin 38 START */
#define ADS_PIN_PWDN  16   /* → ADS pin 35 PWDN  */

void    ads_check_pins(void);
void    ads_init(void);
uint8_t ads_read_id(void);
void    ads_start(void);
void    ads_read_data(int32_t *ch_out);
