#ifndef ADS1299_DEFS_H
#define ADS1299_DEFS_H

#include <stdint.h>

/** @file ads1299_defs.h
 *  @brief Register, command, field, and status definitions for the TI ADS1299.
 */

/** @brief ADS1299 device ID register address. */
#define ADS1299_REG_ID              0x00U
/** @brief Expected ID register value for ADS1299 (8-channel, single device). */
#define ADS1299_ID_EXPECTED         0x3EU
/** @brief Configuration register 1 address: data rate and clock settings. */
#define ADS1299_REG_CONFIG1         0x01U
/** @brief Configuration register 2 address: test signal generation. */
#define ADS1299_REG_CONFIG2         0x02U
/** @brief Configuration register 3 address: reference buffer and bias amplifier. */
#define ADS1299_REG_CONFIG3         0x03U
/** @brief Lead-off control register address. */
#define ADS1299_REG_LOFF            0x04U
/** @brief Channel 1 settings register address. */
#define ADS1299_REG_CH1SET          0x05U
/** @brief Channel 2 settings register address. */
#define ADS1299_REG_CH2SET          0x06U
/** @brief Channel 3 settings register address. */
#define ADS1299_REG_CH3SET          0x07U
/** @brief Channel 4 settings register address. */
#define ADS1299_REG_CH4SET          0x08U
/** @brief Channel 5 settings register address. */
#define ADS1299_REG_CH5SET          0x09U
/** @brief Channel 6 settings register address. */
#define ADS1299_REG_CH6SET          0x0AU
/** @brief Channel 7 settings register address. */
#define ADS1299_REG_CH7SET          0x0BU
/** @brief Channel 8 settings register address. */
#define ADS1299_REG_CH8SET          0x0CU
/** @brief Bias positive-sense selection register address. */
#define ADS1299_REG_BIAS_SENSP      0x0DU
/** @brief Bias negative-sense selection register address. */
#define ADS1299_REG_BIAS_SENSN      0x0EU
/** @brief Positive lead-off sense selection register address. */
#define ADS1299_REG_LOFF_SENSP      0x0FU
/** @brief Negative lead-off sense selection register address. */
#define ADS1299_REG_LOFF_SENSN      0x10U
/** @brief Lead-off current direction flip register address. */
#define ADS1299_REG_LOFF_FLIP       0x11U
/** @brief Positive lead-off status register address. */
#define ADS1299_REG_LOFF_STATP      0x12U
/** @brief Negative lead-off status register address. */
#define ADS1299_REG_LOFF_STATN      0x13U
/** @brief General-purpose I/O control register address. */
#define ADS1299_REG_GPIO            0x14U
/** @brief Miscellaneous control register 1 address. */
#define ADS1299_REG_MISC1           0x15U
/** @brief Miscellaneous control register 2 address. */
#define ADS1299_REG_MISC2           0x16U
/** @brief Configuration register 4 address: continuous conversion mode options. */
#define ADS1299_REG_CONFIG4         0x17U
/** @brief ADS1299 register count from ID through CONFIG4. */
#define ADS1299_REG_COUNT           0x18U

/** @brief Configuration register 5 address on ADS1299-compatible layouts; reserved on ADS1299. */
#define ADS1299_REG_CONFIG5         0x18U
/** @brief Configuration register 6 address on ADS1299-compatible layouts; reserved on ADS1299. */
#define ADS1299_REG_CONFIG6         0x19U

/** @brief Wake the device from standby mode command. */
#define ADS1299_CMD_WAKEUP          0x02U
/** @brief Enter standby mode command. */
#define ADS1299_CMD_STANDBY         0x04U
/** @brief Reset device registers to defaults command. */
#define ADS1299_CMD_RESET           0x06U
/** @brief Start/restart conversions command. */
#define ADS1299_CMD_START           0x08U
/** @brief Stop conversions command. */
#define ADS1299_CMD_STOP            0x0AU
/** @brief Enable read-data-continuous mode command. */
#define ADS1299_CMD_RDATAC          0x10U
/** @brief Stop read-data-continuous mode command. */
#define ADS1299_CMD_SDATAC          0x11U
/** @brief Read a single conversion frame command. */
#define ADS1299_CMD_RDATA           0x12U
/** @brief Read register command base; OR with the 5-bit register address. */
#define ADS1299_CMD_RREG            0x20U
/** @brief Write register command base; OR with the 5-bit register address. */
#define ADS1299_CMD_WREG            0x40U

/** @brief CONFIG1 high-resolution mode bit. */
#define ADS1299_CONFIG1_HR          0x80U
/** @brief CONFIG1 daisy-chain mode bit; 0 selects daisy-chain, 1 selects multiple readback. */
#define ADS1299_CONFIG1_DAISY_EN    0x40U
/** @brief CONFIG1 clock output enable bit. */
#define ADS1299_CONFIG1_CLK_EN      0x20U
/** @brief CONFIG1 reserved bit that must be written as 1 on ADS1299. */
#define ADS1299_CONFIG1_RESERVED    0x10U
/** @brief CONFIG1 data-rate field mask. */
#define ADS1299_CONFIG1_DR_MASK     0x07U
/** @brief CONFIG1 data rate code for 16 kSPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_16KSPS   0x00U
/** @brief CONFIG1 data rate code for 8 kSPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_8KSPS    0x01U
/** @brief CONFIG1 data rate code for 4 kSPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_4KSPS    0x02U
/** @brief CONFIG1 data rate code for 2 kSPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_2KSPS    0x03U
/** @brief CONFIG1 data rate code for 1 kSPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_1KSPS    0x04U
/** @brief CONFIG1 data rate code for 500 SPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_500SPS   0x05U
/** @brief CONFIG1 data rate code for 250 SPS in high-resolution mode. */
#define ADS1299_CONFIG1_DR_250SPS   0x06U

/** @brief CONFIG2 internal test source enable bit. */
#define ADS1299_CONFIG2_INT_CAL     0x10U
/** @brief CONFIG2 test signal amplitude field mask. */
#define ADS1299_CONFIG2_CAL_AMP_MASK 0x04U
/** @brief CONFIG2 test signal frequency field mask. */
#define ADS1299_CONFIG2_CAL_FREQ_MASK 0x03U

/** @brief CONFIG3 power-down reference buffer bit; 1 powers the internal reference buffer. */
#define ADS1299_CONFIG3_PD_REFBUF   0x80U
/** @brief CONFIG3 reserved bit that must be written as 1 on ADS1299. */
#define ADS1299_CONFIG3_RESERVED    0x40U
/** @brief CONFIG3 internal reference selection bit; 1 selects the 4.5 V reference on 5 V analog supply. */
#define ADS1299_CONFIG3_VREF_4V     0x20U
/** @brief CONFIG3 bias measurement enable bit. */
#define ADS1299_CONFIG3_BIAS_MEAS   0x10U
/** @brief CONFIG3 bias reference selection bit; 1 uses mid-supply bias reference. */
#define ADS1299_CONFIG3_BIASREF_INT 0x08U
/** @brief CONFIG3 bias buffer power bit; 1 enables the bias amplifier. */
#define ADS1299_CONFIG3_PD_BIAS     0x04U
/** @brief CONFIG3 bias lead-off sense enable bit. */
#define ADS1299_CONFIG3_BIAS_LOFF_SENS 0x02U
/** @brief CONFIG3 bias status bit mask. */
#define ADS1299_CONFIG3_BIAS_STAT   0x01U

/** @brief LOFF comparator threshold field mask. */
#define ADS1299_LOFF_COMP_TH_MASK   0xE0U
/** @brief LOFF current magnitude field mask. */
#define ADS1299_LOFF_ILEAD_OFF_MASK 0x0CU
/** @brief LOFF frequency field mask. */
#define ADS1299_LOFF_FLEAD_OFF_MASK 0x03U

/** @brief CHnSET channel power-down bit. */
#define ADS1299_CHSET_PD            0x80U
/** @brief CHnSET gain field mask. */
#define ADS1299_CHSET_GAIN_MASK     0x70U
/** @brief CHnSET gain code for 1 V/V. */
#define ADS1299_CHSET_GAIN_1        0x10U
/** @brief CHnSET gain code for 2 V/V. */
#define ADS1299_CHSET_GAIN_2        0x20U
/** @brief CHnSET gain code for 4 V/V. */
#define ADS1299_CHSET_GAIN_4        0x40U
/** @brief CHnSET gain code for 6 V/V. */
#define ADS1299_CHSET_GAIN_6        0x00U
/** @brief CHnSET gain code for 8 V/V. */
#define ADS1299_CHSET_GAIN_8        0x50U
/** @brief CHnSET gain code for 12 V/V. */
#define ADS1299_CHSET_GAIN_12       0x60U
/** @brief CHnSET gain code for 24 V/V. */
#define ADS1299_CHSET_GAIN_24       0x70U
/** @brief CHnSET input multiplexer field mask. */
#define ADS1299_CHSET_MUX_MASK      0x07U
/** @brief CHnSET normal electrode input mux code. */
#define ADS1299_CHSET_MUX_NORMAL    0x00U
/** @brief CHnSET input shorted mux code, used for noise measurements. */
#define ADS1299_CHSET_MUX_SHORTED   0x01U
/** @brief CHnSET bias measurement mux code. */
#define ADS1299_CHSET_MUX_BIAS_MEAS 0x02U
/** @brief CHnSET supply measurement mux code. */
#define ADS1299_CHSET_MUX_MVDD      0x03U
/** @brief CHnSET temperature sensor mux code. */
#define ADS1299_CHSET_MUX_TEMP      0x04U
/** @brief CHnSET test signal mux code. */
#define ADS1299_CHSET_MUX_TESTSIG   0x05U
/** @brief CHnSET bias drive positive electrode mux code. */
#define ADS1299_CHSET_MUX_BIAS_DRP  0x06U
/** @brief CHnSET bias drive negative electrode mux code. */
#define ADS1299_CHSET_MUX_BIAS_DRN  0x07U

/** @brief CONFIG4 single-shot conversion mode bit. */
#define ADS1299_CONFIG4_SINGLE_SHOT 0x08U
/** @brief CONFIG4 lead-off comparator power-down bit. */
#define ADS1299_CONFIG4_PD_LOFF_COMP 0x02U

/** @brief GPIO register mask for GPIO data bits. */
#define ADS1299_GPIO_DATA_MASK      0xF0U
/** @brief GPIO register mask for GPIO direction bits; 1 configures input. */
#define ADS1299_GPIO_DIR_MASK       0x0FU

/** @brief MISC1 SRB1 common reference connection bit. */
#define ADS1299_MISC1_SRB1          0x20U
/** @brief MISC2 reserved default value. */
#define ADS1299_MISC2_DEFAULT       0x00U

/** @brief Default CONFIG1 value for high-resolution, 250 SPS operation. */
#define ADS1299_DEFAULT_CONFIG1     (ADS1299_CONFIG1_HR | ADS1299_CONFIG1_RESERVED | ADS1299_CONFIG1_DR_250SPS)
/** @brief Default CONFIG2 value with test signal disabled. */
#define ADS1299_DEFAULT_CONFIG2     0xC0U
/** @brief Bench-test CONFIG3: internal reference on, BIAS amplifier OFF, no BIASREF.
 *  Switch to full CONFIG3 (with PD_BIAS | BIASREF_INT) only when electrodes are connected. */
#define ADS1299_DEFAULT_CONFIG3     (ADS1299_CONFIG3_PD_REFBUF | ADS1299_CONFIG3_RESERVED | ADS1299_CONFIG3_VREF_4V)
/** @brief Default LOFF value with lead-off detection disabled. */
#define ADS1299_DEFAULT_LOFF        0x00U
/** @brief Bench-test channel setting: gain 24, inputs shorted internally.
 *  Prevents BIAS amplifier saturation when no electrodes are connected.
 *  Change to ADS1299_CHSET_MUX_NORMAL when electrodes are attached. */
#define ADS1299_DEFAULT_CHSET       (ADS1299_CHSET_GAIN_24 | ADS1299_CHSET_MUX_SHORTED)
/** @brief BIAS sense disabled for bench test — no electrodes connected. */
#define ADS1299_DEFAULT_BIAS_SENSP  0x00U
/** @brief BIAS sense disabled for bench test — no electrodes connected. */
#define ADS1299_DEFAULT_BIAS_SENSN  0x00U
/** @brief Default GPIO value with all GPIO pins configured as inputs. */
#define ADS1299_DEFAULT_GPIO        0x0FU
/** @brief Default MISC1 value with SRB1 disconnected for per-channel differential inputs. */
#define ADS1299_DEFAULT_MISC1       0x00U
/** @brief Default CONFIG4 value with continuous conversion and lead-off comparator disabled. */
#define ADS1299_DEFAULT_CONFIG4     ADS1299_CONFIG4_PD_LOFF_COMP

/** @brief Status byte 0 bit 7 fixed marker mask. */
#define ADS1299_STATUS0_MARKER7     0x80U
/** @brief Status byte 0 bit 6 fixed marker mask. */
#define ADS1299_STATUS0_MARKER6     0x40U
/** @brief Status byte 0 bit 5 lead-off positive channel 8 status mask. */
#define ADS1299_STATUS0_LOFFP8      0x20U
/** @brief Status byte 0 bit 4 lead-off positive channel 7 status mask. */
#define ADS1299_STATUS0_LOFFP7      0x10U
/** @brief Status byte 0 bit 3 lead-off positive channel 6 status mask. */
#define ADS1299_STATUS0_LOFFP6      0x08U
/** @brief Status byte 0 bit 2 lead-off positive channel 5 status mask. */
#define ADS1299_STATUS0_LOFFP5      0x04U
/** @brief Status byte 0 bit 1 lead-off positive channel 4 status mask. */
#define ADS1299_STATUS0_LOFFP4      0x02U
/** @brief Status byte 0 bit 0 lead-off positive channel 3 status mask. */
#define ADS1299_STATUS0_LOFFP3      0x01U
/** @brief Status byte 1 bit 7 lead-off positive channel 2 status mask. */
#define ADS1299_STATUS1_LOFFP2      0x80U
/** @brief Status byte 1 bit 6 lead-off positive channel 1 status mask. */
#define ADS1299_STATUS1_LOFFP1      0x40U
/** @brief Status byte 1 bit 5 lead-off negative channel 8 status mask. */
#define ADS1299_STATUS1_LOFFN8      0x20U
/** @brief Status byte 1 bit 4 lead-off negative channel 7 status mask. */
#define ADS1299_STATUS1_LOFFN7      0x10U
/** @brief Status byte 1 bit 3 lead-off negative channel 6 status mask. */
#define ADS1299_STATUS1_LOFFN6      0x08U
/** @brief Status byte 1 bit 2 lead-off negative channel 5 status mask. */
#define ADS1299_STATUS1_LOFFN5      0x04U
/** @brief Status byte 1 bit 1 lead-off negative channel 4 status mask. */
#define ADS1299_STATUS1_LOFFN4      0x02U
/** @brief Status byte 1 bit 0 lead-off negative channel 3 status mask. */
#define ADS1299_STATUS1_LOFFN3      0x01U
/** @brief Status byte 2 bit 7 lead-off negative channel 2 status mask. */
#define ADS1299_STATUS2_LOFFN2      0x80U
/** @brief Status byte 2 bit 6 lead-off negative channel 1 status mask. */
#define ADS1299_STATUS2_LOFFN1      0x40U
/** @brief Status byte 2 bit 4 GPIO4 status mask. */
#define ADS1299_STATUS2_GPIO4       0x10U
/** @brief Status byte 2 bit 3 GPIO3 status mask. */
#define ADS1299_STATUS2_GPIO3       0x08U
/** @brief Status byte 2 bit 2 GPIO2 status mask. */
#define ADS1299_STATUS2_GPIO2       0x04U
/** @brief Status byte 2 bit 1 GPIO1 status mask. */
#define ADS1299_STATUS2_GPIO1       0x02U

#endif
