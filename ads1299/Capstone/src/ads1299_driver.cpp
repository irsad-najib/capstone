#include "ads1299_driver.h"

#include <Arduino.h>
#include <SPI.h>

#include "ads1299_defs.h"
#include "eeg_config.h"

static const uint32_t ADS1299_SPI_HZ  = 1000000UL;
static const uint8_t  ADS1299_SPI_MODE = SPI_MODE1;
static SPISettings ads1299_spi_settings(ADS1299_SPI_HZ, MSBFIRST, ADS1299_SPI_MODE);

/* True while RDATAC is active — guards ads1299_read_reg() against frame misalignment. */
static volatile bool ads1299_in_rdatac = false;

static inline void ads1299_select(void)   { digitalWrite(EEG_PIN_ADS1299_CS, LOW);  }
static inline void ads1299_deselect(void) { digitalWrite(EEG_PIN_ADS1299_CS, HIGH); }
static void ads1299_wait_ms(uint32_t ms)  { vTaskDelay(pdMS_TO_TICKS(ms)); }

static void ads1299_diag_print_pins(const char *label) {
    Serial.printf("[DIAG] %s CS=%d SCLK=%d MOSI=%d MISO=%d DRDY=%d RESET=%d PWDN=%d START=%d\n",
                  label,
                  digitalRead(EEG_PIN_ADS1299_CS),
                  digitalRead(EEG_PIN_SPI_SCLK),
                  digitalRead(EEG_PIN_SPI_MOSI),
                  digitalRead(EEG_PIN_SPI_MISO),
                  digitalRead(EEG_PIN_ADS1299_DRDY),
                  digitalRead(EEG_PIN_ADS1299_RESET),
                  digitalRead(EEG_PIN_ADS1299_PWDN),
                  digitalRead(EEG_PIN_ADS1299_START));
}

static void ads1299_raw_command(uint8_t cmd, const SPISettings &settings) {
    SPI.beginTransaction(settings);
    ads1299_select();
    delayMicroseconds(5);
    SPI.transfer(cmd);
    delayMicroseconds(5);
    ads1299_deselect();
    SPI.endTransaction();
}

static uint8_t ads1299_raw_read_reg(uint8_t reg, const SPISettings &settings) {
    SPI.beginTransaction(settings);
    ads1299_select();
    delayMicroseconds(5);
    SPI.transfer(static_cast<uint8_t>(ADS1299_CMD_RREG | (reg & 0x1FU)));
    delayMicroseconds(5);
    SPI.transfer(0x00U);
    delayMicroseconds(5);
    const uint8_t value = SPI.transfer(0x00U);
    delayMicroseconds(5);
    ads1299_deselect();
    SPI.endTransaction();
    return value;
}

static void ads1299_diag_scan_spi(void) {
    static const uint32_t speeds[] = {125000UL, 250000UL, 500000UL, 1000000UL};
    static const uint8_t modes[] = {SPI_MODE0, SPI_MODE1, SPI_MODE2, SPI_MODE3};

    ads1299_diag_print_pins("before-spi-scan");
    for (uint8_t mode_i = 0U; mode_i < sizeof(modes); ++mode_i) {
        for (uint8_t speed_i = 0U; speed_i < sizeof(speeds) / sizeof(speeds[0]); ++speed_i) {
            SPISettings settings(speeds[speed_i], MSBFIRST, modes[mode_i]);
            ads1299_raw_command(ADS1299_CMD_SDATAC, settings);
            delayMicroseconds(20);
            const uint8_t id = ads1299_raw_read_reg(ADS1299_REG_ID, settings);
            Serial.printf("[DIAG] scan mode=%u hz=%lu id=0x%02X\n",
                          (unsigned)mode_i,
                          (unsigned long)speeds[speed_i],
                          id);
        }
    }
    ads1299_diag_print_pins("after-spi-scan");
}

static int32_t ads1299_sign_extend_24(uint32_t raw) {
    if ((raw & 0x00800000UL) != 0UL) raw |= 0xFF000000UL;
    return static_cast<int32_t>(raw);
}

/* ads1299_init() configures the device but does NOT start streaming.
   Call ads1299_start_stream() separately after the acquisition task exists. */
bool ads1299_init(void) {
    pinMode(EEG_PIN_ADS1299_CS,    OUTPUT);
    pinMode(EEG_PIN_ADS1299_RESET, OUTPUT);
    pinMode(EEG_PIN_ADS1299_PWDN,  OUTPUT);
    pinMode(EEG_PIN_ADS1299_START, OUTPUT);
    pinMode(EEG_PIN_ADS1299_DRDY,  INPUT);

    ads1299_deselect();
    digitalWrite(EEG_PIN_ADS1299_START, LOW);

    /* CRITICAL-3 fix: both PWDN and RESET HIGH from the start (active-low).
       PWDN LOW = chip off. Never hold LOW then HIGH through SPI.begin(). */
    digitalWrite(EEG_PIN_ADS1299_PWDN,  HIGH);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);

    SPI.begin(EEG_PIN_SPI_SCLK, EEG_PIN_SPI_MISO, EEG_PIN_SPI_MOSI, EEG_PIN_ADS1299_CS);
    ads1299_diag_print_pins("after-gpio-init");

    /* tPOR (internal power-on reset) = 2^18 / 2.048MHz ≈ 128 ms.
       Use 500 ms — generous margin for AVDD/DVDD/LDO/oscillator all stable. */
    ads1299_wait_ms(500);

    /* DIAG-0: DRDY check (chip live?) + raw MISO in RDATAC before any SPI command.
       RDATAC+CS-low: DOUT HIGH between frames → expect 0xFF. 0x00 = MISO unwired. */
    {
        bool drdy_seen = false;
        const uint32_t t0 = millis();
        while ((millis() - t0) < 20UL) {
            if (digitalRead(EEG_PIN_ADS1299_DRDY) == LOW) { drdy_seen = true; break; }
        }

        SPI.beginTransaction(ads1299_spi_settings);
        ads1299_select();
        const uint8_t b0 = SPI.transfer(0x00U);
        const uint8_t b1 = SPI.transfer(0x00U);
        const uint8_t b2 = SPI.transfer(0x00U);
        ads1299_deselect();
        SPI.endTransaction();

        Serial.printf("[DIAG] DRDY=%s raw=0x%02X%02X%02X PWDN=%d\n",
                      drdy_seen ? "Y" : "N", b0, b1, b2,
                      digitalRead(EEG_PIN_ADS1299_PWDN));
    }

    /* Hardware RESET pulse: datasheet t_RST min = 2 tCLK ≈ 1 µs.
       Use 2 ms to be absolutely safe across all supply ramp conditions. */
    digitalWrite(EEG_PIN_ADS1299_RESET, LOW);
    ads1299_wait_ms(2);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);

    /* After RESET deasserts, chip begins internal POR cycle.
       Datasheet: 18 tCLK = 8.8 µs min before first SPI.
       We use 50 ms — allows oscillator lock + LDO settle. */
    ads1299_wait_ms(50);

    /* Device defaults to RDATAC after any reset.
       Send SDATAC first, then software RESET to guarantee clean register state. */
    ads1299_send_command(ADS1299_CMD_SDATAC);
    ads1299_wait_ms(10);   /* > 1 DRDY period @ 250 SPS = 4 ms */

    /* Software RESET (SPI command 0x06) — forces all registers to default
       and exits any residual RDATAC state the hardware reset may have missed. */
    ads1299_send_command(ADS1299_CMD_RESET);
    ads1299_wait_ms(50);   /* full POR cycle after software reset */

    /* SDATAC again after software reset (device re-enters RDATAC after SPI reset). */
    ads1299_send_command(ADS1299_CMD_SDATAC);
    ads1299_wait_ms(10);   /* > 1 DRDY period */

    /* Read ID up to 3 times — chip may need one extra DRDY cycle to settle. */
    uint8_t device_id = 0x00U;
    for (uint8_t attempt = 0U; attempt < 3U; ++attempt) {
        device_id = ads1299_read_reg(ADS1299_REG_ID);
        Serial.printf("[ADS1299] ID attempt %u: 0x%02X\n", attempt + 1U, device_id);
        if (device_id == ADS1299_ID_EXPECTED) break;
        ads1299_wait_ms(5);
    }

    if (device_id != ADS1299_ID_EXPECTED) {
        Serial.printf("[ADS1299] ID 0x%02X != 0x3E — cek MISO/MOSI/SCLK/CS, AVDD=5V, VCAP1=100uF\n", device_id);
        ads1299_diag_scan_spi();
        return false;
    }
    Serial.printf("[ADS1299] ID 0x%02X OK\n", device_id);

    ads1299_write_reg(ADS1299_REG_CONFIG1, ADS1299_DEFAULT_CONFIG1);
    ads1299_write_reg(ADS1299_REG_CONFIG2, ADS1299_DEFAULT_CONFIG2);
    ads1299_write_reg(ADS1299_REG_CONFIG3, ADS1299_DEFAULT_CONFIG3);
    ads1299_write_reg(ADS1299_REG_LOFF,   ADS1299_DEFAULT_LOFF);

    for (uint8_t reg = ADS1299_REG_CH1SET; reg <= ADS1299_REG_CH8SET; ++reg) {
        ads1299_write_reg(reg, ADS1299_DEFAULT_CHSET);
    }

    ads1299_write_reg(ADS1299_REG_BIAS_SENSP, ADS1299_DEFAULT_BIAS_SENSP);
    ads1299_write_reg(ADS1299_REG_BIAS_SENSN, ADS1299_DEFAULT_BIAS_SENSN);
    ads1299_write_reg(ADS1299_REG_LOFF_SENSP, 0x00U);
    ads1299_write_reg(ADS1299_REG_LOFF_SENSN, 0x00U);
    ads1299_write_reg(ADS1299_REG_LOFF_FLIP,  0x00U);
    ads1299_write_reg(ADS1299_REG_GPIO,   ADS1299_DEFAULT_GPIO);
    ads1299_write_reg(ADS1299_REG_MISC1,  ADS1299_DEFAULT_MISC1);
    ads1299_write_reg(ADS1299_REG_MISC2,  ADS1299_MISC2_DEFAULT);
    ads1299_write_reg(ADS1299_REG_CONFIG4, ADS1299_DEFAULT_CONFIG4);

    /* Do NOT call ads1299_start_stream() here.
       eeg_task_start() must create the task and attach the interrupt first. */
    return true;
}

bool ads1299_reset(void) {
    /* Kept for external callers but hardware reset is preferred from ads1299_init(). */
    if (ads1299_in_rdatac) {
        ads1299_stop_stream();
    }
    digitalWrite(EEG_PIN_ADS1299_RESET, LOW);
    delayMicroseconds(10);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);
    delayMicroseconds(20);
    ads1299_send_command(ADS1299_CMD_SDATAC);
    ads1299_wait_ms(2);
    return true;
}

void ads1299_powerdown(void) {
    ads1299_stop_stream();
    ads1299_send_command(ADS1299_CMD_STANDBY);
    digitalWrite(EEG_PIN_ADS1299_PWDN, LOW);
}

void ads1299_wakeup(void) {
    digitalWrite(EEG_PIN_ADS1299_PWDN, HIGH);
    ads1299_wait_ms(10);
    ads1299_send_command(ADS1299_CMD_WAKEUP);
    ads1299_wait_ms(2);
}

void ads1299_write_reg(uint8_t reg, uint8_t val) {
    /* CRITICAL-2 fix: WREG is ignored in RDATAC; pause streaming first. */
    bool was_streaming = ads1299_in_rdatac;
    if (was_streaming) {
        ads1299_send_command(ADS1299_CMD_SDATAC);
        ads1299_in_rdatac = false;
        delayMicroseconds(10);
    }

    SPI.beginTransaction(ads1299_spi_settings);
    ads1299_select();
    SPI.transfer(static_cast<uint8_t>(ADS1299_CMD_WREG | (reg & 0x1FU)));
    SPI.transfer(0x00U);
    SPI.transfer(val);
    ads1299_deselect();
    SPI.endTransaction();

    if (was_streaming) {
        delayMicroseconds(10);
        ads1299_send_command(ADS1299_CMD_RDATAC);
        ads1299_in_rdatac = true;
    }
}

uint8_t ads1299_read_reg(uint8_t reg) {
    /* CRITICAL-2 fix: RREG is ignored in RDATAC; pause streaming first. */
    bool was_streaming = ads1299_in_rdatac;
    if (was_streaming) {
        ads1299_send_command(ADS1299_CMD_SDATAC);
        ads1299_in_rdatac = false;
        delayMicroseconds(10);
    }

    SPI.beginTransaction(ads1299_spi_settings);
    ads1299_select();
    SPI.transfer(static_cast<uint8_t>(ADS1299_CMD_RREG | (reg & 0x1FU)));
    SPI.transfer(0x00U);
    const uint8_t value = SPI.transfer(0x00U);
    ads1299_deselect();
    SPI.endTransaction();

    if (was_streaming) {
        delayMicroseconds(10);
        ads1299_send_command(ADS1299_CMD_RDATAC);
        ads1299_in_rdatac = true;
    }
    return value;
}

void ads1299_send_command(uint8_t cmd) {
    SPI.beginTransaction(ads1299_spi_settings);
    ads1299_select();
    SPI.transfer(cmd);
    ads1299_deselect();
    SPI.endTransaction();
}

/* WARNING-3 fix: Use START pin only; CMD_START is redundant and ignored when pin is HIGH.
   RDATAC sent first, then START pin asserted — this matches datasheet Figure 90. */
void ads1299_start_stream(void) {
    ads1299_send_command(ADS1299_CMD_RDATAC);
    delayMicroseconds(10);   /* > 4 tCLK before first DRDY pulse */
    digitalWrite(EEG_PIN_ADS1299_START, HIGH);
    ads1299_in_rdatac = true;
}

void ads1299_stop_stream(void) {
    digitalWrite(EEG_PIN_ADS1299_START, LOW);
    delayMicroseconds(10);
    ads1299_send_command(ADS1299_CMD_SDATAC);
    ads1299_in_rdatac = false;
}

bool ads1299_read_data(int32_t samples[8]) {
    uint8_t frame[27];

    SPI.beginTransaction(ads1299_spi_settings);
    ads1299_select();
    for (uint8_t i = 0U; i < sizeof(frame); ++i) {
        frame[i] = SPI.transfer(0x00U);
    }
    ads1299_deselect();
    SPI.endTransaction();

    /* INFO-2: Verify frame alignment via fixed marker bits 23 and 22 of status word.
       Both must be 1; if not, frame boundary has drifted — log and discard. */
    if ((frame[0] & 0xC0U) != 0xC0U) {
        Serial.printf("[ADS1299] Frame misalign! status[0]=0x%02X\n", frame[0]);
        return false;
    }

    for (uint8_t ch = 0U; ch < EEG_NUM_CHANNELS; ++ch) {
        const uint8_t  offset = static_cast<uint8_t>(3U + (ch * 3U));
        const uint32_t raw    = (static_cast<uint32_t>(frame[offset])      << 16U) |
                                (static_cast<uint32_t>(frame[offset + 1U]) <<  8U) |
                                 static_cast<uint32_t>(frame[offset + 2U]);
        samples[ch] = ads1299_sign_extend_24(raw);
    }
    return true;
}
