#ifndef EEG_CONFIG_H
#define EEG_CONFIG_H

/** @file eeg_config.h
 *  @brief Central compile-time configuration for the ESP32-WROOM-32U ADS1299 EEG system.
 */

#include <stdint.h>

/** @brief ESP32 GPIO connected to ADS1299 SPI SCLK. */
#define EEG_PIN_SPI_SCLK            18
/** @brief ESP32 GPIO connected to ADS1299 SPI MISO / DOUT. */
#define EEG_PIN_SPI_MISO            27
/** @brief ESP32 GPIO connected to ADS1299 SPI MOSI / DIN. */
#define EEG_PIN_SPI_MOSI            23
/** @brief ESP32 GPIO connected to ADS1299 chip select. */
#define EEG_PIN_ADS1299_CS          5
/** @brief ESP32 input-only GPIO connected to ADS1299 DRDY (falling edge ISR). */
#define EEG_PIN_ADS1299_DRDY        34
/** @brief ESP32 GPIO connected to ADS1299 RESET (active-low). */
#define EEG_PIN_ADS1299_RESET       32
/** @brief ESP32 GPIO connected to ADS1299 PWDN (active-low). */
#define EEG_PIN_ADS1299_PWDN        33
/** @brief ESP32 GPIO connected to ADS1299 START. */
#define EEG_PIN_ADS1299_START       21
/* CLKSEL (ADS1299 pin 52) di-strap ke GND via 10kΩ di hardware = internal oscillator 2.048 MHz */

/** @brief ESP32 GPIO connected to PCM5102A I2S BCLK. */
#define EEG_PIN_I2S_BCLK            26
/** @brief ESP32 GPIO connected to PCM5102A I2S LRC / word select. */
#define EEG_PIN_I2S_LRC             25
/** @brief ESP32 GPIO connected to PCM5102A I2S DIN. */
#define EEG_PIN_I2S_DOUT            22

/** @brief ADS1299 output sample rate in samples per second. */
#define EEG_SAMPLE_RATE_HZ          250U
/** @brief Number of ADS1299 channels used by this design. */
#define EEG_NUM_CHANNELS            8U
/** @brief ADS1299 programmable gain selected in CHnSET registers. */
#define EEG_ADS1299_GAIN            24.0f
/** @brief ADS1299 internal reference voltage used for microvolt conversion with CONFIG3 VREF_4V set. */
#define EEG_ADS1299_VREF_VOLTS      4.5f
/** @brief ADS1299 least-significant bit size in microvolts for VREF / gain / 2^23. */
#define EEG_ADS1299_LSB_UV          ((EEG_ADS1299_VREF_VOLTS * 1000000.0f) / (EEG_ADS1299_GAIN * 8388608.0f))

/** @brief Biquad coefficient count: b0, b1, b2, a1, a2 with a0 normalized to 1. */
#define EEG_BIQUAD_COEFF_COUNT      5U

/** @brief DC-blocking 0.5 Hz high-pass biquad at fs=250 Hz.
 *
 *  Coefficients were calculated with the RBJ audio EQ cookbook high-pass formula:
 *  omega = 2*pi*f0/fs, alpha = sin(omega)/(2*Q), Q = 1/sqrt(2), normalized by a0.
 */
static const float EEG_BIQUAD_HP_0P5HZ[EEG_BIQUAD_COEFF_COUNT] = {
    0.9911535951f, -1.9823071902f, 0.9911535951f, -1.9822289298f, 0.9823854506f
};

/** @brief 50 Hz notch biquad at fs=250 Hz and Q=30.
 *
 *  Coefficients were calculated with the RBJ notch formula:
 *  omega = 2*pi*f0/fs, alpha = sin(omega)/(2*Q), b = [1, -2*cos(omega), 1], normalized by a0.
 */
static const float EEG_BIQUAD_NOTCH_50HZ[EEG_BIQUAD_COEFF_COUNT] = {
    0.9843963900f, -0.6083904274f, 0.9843963900f, -0.6083904274f, 0.9687927800f
};

/** @brief 60 Hz notch biquad at fs=250 Hz and Q=30.
 *
 *  Coefficients were calculated with the RBJ notch formula:
 *  omega = 2*pi*f0/fs, alpha = sin(omega)/(2*Q), b = [1, -2*cos(omega), 1], normalized by a0.
 */
static const float EEG_BIQUAD_NOTCH_60HZ[EEG_BIQUAD_COEFF_COUNT] = {
    0.9836383768f, -0.1235263294f, 0.9836383768f, -0.1235263294f, 0.9672767536f
};

/** @brief WebSocket backend host name or IPv4 address; override in build_flags for deployment. */
#ifndef EEG_WS_HOST
#define EEG_WS_HOST                 "192.168.1.100"
#endif
/** @brief WebSocket backend TCP port. */
#define EEG_WS_PORT                 8080U
/** @brief Stable device identifier appended to the WebSocket path. */
#define EEG_DEVICE_ID               "esp32-eeg-001"
/** @brief WebSocket backend path including the device identifier query parameter. */
#define EEG_WS_PATH                 "/ws?id=" EEG_DEVICE_ID

/** @brief StaticJsonDocument capacity for one EEG JSON sample. */
#define EEG_JSON_DOC_BYTES          512U
/** @brief Static output buffer size for serialized JSON frames. */
#define EEG_JSON_TX_BYTES           384U

/** @brief EEG acquisition task stack size in bytes. */
#define EEG_TASK_STACK_BYTES        4096U
/** @brief EEG acquisition task priority; high priority keeps DRDY servicing deterministic. */
#define EEG_TASK_PRIORITY           24U
/** @brief EEG acquisition task core. */
#define EEG_TASK_CORE               1U
/** @brief WebSocket streaming task stack size in bytes. */
#define EEG_STREAM_TASK_STACK_BYTES 6144U
/** @brief WebSocket streaming task priority. */
#define EEG_STREAM_TASK_PRIORITY    5U
/** @brief WebSocket streaming task core. */
#define EEG_STREAM_TASK_CORE        0U

/** @brief Static ring-buffer capacity; must be a power of two for mask-based wrapping. */
#define EEG_RING_BUFFER_SIZE        256U
/** @brief Ring-buffer index mask derived from the power-of-two capacity. */
#define EEG_RING_BUFFER_MASK        (EEG_RING_BUFFER_SIZE - 1U)

#if ((EEG_RING_BUFFER_SIZE & EEG_RING_BUFFER_MASK) != 0)
#error "EEG_RING_BUFFER_SIZE must be a power of two"
#endif

#endif
