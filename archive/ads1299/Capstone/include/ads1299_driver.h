#ifndef ADS1299_DRIVER_H
#define ADS1299_DRIVER_H

/** @file ads1299_driver.h
 *  @brief ADS1299 SPI driver API for ESP32 Arduino.
 */

#include <stdint.h>
#include <stdbool.h>

/** @brief Initialize GPIO, SPI, ADS1299 registers, and start continuous conversion.
 *  @return true when the initialization sequence completed.
 */
bool ads1299_init(void);

/** @brief Pulse the ADS1299 RESET pin and issue the RESET command.
 *  @return true when the reset sequence completed.
 */
bool ads1299_reset(void);

/** @brief Put the ADS1299 into power-down/standby state. */
void ads1299_powerdown(void);

/** @brief Wake the ADS1299 from power-down/standby state. */
void ads1299_wakeup(void);

/** @brief Write one ADS1299 register.
 *  @param reg Register address.
 *  @param val Register value.
 */
void ads1299_write_reg(uint8_t reg, uint8_t val);

/** @brief Read one ADS1299 register.
 *  @param reg Register address.
 *  @return Register value read from the device.
 */
uint8_t ads1299_read_reg(uint8_t reg);

/** @brief Send a single-byte ADS1299 SPI command.
 *  @param cmd Command byte.
 */
void ads1299_send_command(uint8_t cmd);

/** @brief Start conversions and enable read-data-continuous mode. */
void ads1299_start_stream(void);

/** @brief Stop conversions and disable read-data-continuous mode. */
void ads1299_stop_stream(void);

/** @brief Read one 27-byte ADS1299 frame and convert eight 24-bit samples to int32_t.
 *  @param samples Caller-provided array receiving eight sign-extended samples.
 *  @return true when a full frame was read.
 */
bool ads1299_read_data(int32_t samples[8]);

#endif
