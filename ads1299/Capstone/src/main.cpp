#include <Arduino.h>
#include "eeg_config.h"
#include "eeg_task.h"

#ifndef EEG_DRDY_FREQ_DIAG
#define EEG_DRDY_FREQ_DIAG 1
#endif

#ifndef EEG_SPI_HOLD_DIAG
#define EEG_SPI_HOLD_DIAG 0
#endif

#ifndef EEG_DOUT_DIAG
#define EEG_DOUT_DIAG 0
#endif

#if EEG_DRDY_FREQ_DIAG
static volatile uint32_t drdy_edges = 0U;

static void IRAM_ATTR drdy_count_isr(void) {
    drdy_edges++;
}

static void run_drdy_freq_diag(void) {
    pinMode(EEG_PIN_ADS1299_CS, OUTPUT);
    pinMode(EEG_PIN_SPI_SCLK, OUTPUT);
    pinMode(EEG_PIN_SPI_MOSI, OUTPUT);
    pinMode(EEG_PIN_SPI_MISO, INPUT);
    pinMode(EEG_PIN_ADS1299_RESET, OUTPUT);
    pinMode(EEG_PIN_ADS1299_PWDN, OUTPUT);
    pinMode(EEG_PIN_ADS1299_START, OUTPUT);
    pinMode(EEG_PIN_ADS1299_DRDY, INPUT);

    digitalWrite(EEG_PIN_ADS1299_CS, HIGH);
    digitalWrite(EEG_PIN_SPI_SCLK, LOW);
    digitalWrite(EEG_PIN_SPI_MOSI, LOW);
    digitalWrite(EEG_PIN_ADS1299_START, LOW);
    digitalWrite(EEG_PIN_ADS1299_PWDN, HIGH);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);

    delay(500);
    digitalWrite(EEG_PIN_ADS1299_RESET, LOW);
    delay(2);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);
    delay(100);

    attachInterrupt(digitalPinToInterrupt(EEG_PIN_ADS1299_DRDY), drdy_count_isr, FALLING);

    Serial.println("[DRDY-DIAG] START low 3s: DRDY harus minim/tidak jalan.");
    drdy_edges = 0U;
    delay(3000);
    Serial.printf("[DRDY-DIAG] START low edges=%lu DRDY_now=%d\n",
                  (unsigned long)drdy_edges,
                  digitalRead(EEG_PIN_ADS1299_DRDY));

    Serial.println("[DRDY-DIAG] START high: hitung falling edge DRDY per 1s.");
    digitalWrite(EEG_PIN_ADS1299_START, HIGH);
    delay(50);

    for (;;) {
        drdy_edges = 0U;
        delay(1000);
        const uint32_t edges = drdy_edges;
        Serial.printf("[DRDY-DIAG] edges_per_sec=%lu DRDY_now=%d RESET=%d PWDN=%d START=%d\n",
                      (unsigned long)edges,
                      digitalRead(EEG_PIN_ADS1299_DRDY),
                      digitalRead(EEG_PIN_ADS1299_RESET),
                      digitalRead(EEG_PIN_ADS1299_PWDN),
                      digitalRead(EEG_PIN_ADS1299_START));
    }
}
#endif

static void print_input_status(void) {
    Serial.printf(" | MISO=%d DRDY=%d\n",
                  digitalRead(EEG_PIN_SPI_MISO),
                  digitalRead(EEG_PIN_ADS1299_DRDY));
}

#if EEG_SPI_HOLD_DIAG
static void hold_pin(const char *name, uint8_t pin) {
    digitalWrite(pin, LOW);
    Serial.printf("[SPI-HOLD] %s LOW  8s readback=%d", name, digitalRead(pin));
    print_input_status();
    delay(8000);

    digitalWrite(pin, HIGH);
    Serial.printf("[SPI-HOLD] %s HIGH 8s readback=%d", name, digitalRead(pin));
    print_input_status();
    delay(8000);
}

static void run_spi_hold_diag(void) {
    pinMode(EEG_PIN_ADS1299_CS, OUTPUT);
    pinMode(EEG_PIN_SPI_SCLK, OUTPUT);
    pinMode(EEG_PIN_SPI_MOSI, OUTPUT);
    pinMode(EEG_PIN_ADS1299_RESET, OUTPUT);
    pinMode(EEG_PIN_ADS1299_PWDN, OUTPUT);
    pinMode(EEG_PIN_ADS1299_START, OUTPUT);
    pinMode(EEG_PIN_SPI_MISO, INPUT);
    pinMode(EEG_PIN_ADS1299_DRDY, INPUT);

    digitalWrite(EEG_PIN_SPI_SCLK, LOW);
    digitalWrite(EEG_PIN_SPI_MOSI, LOW);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);
    digitalWrite(EEG_PIN_ADS1299_PWDN, HIGH);
    digitalWrite(EEG_PIN_ADS1299_START, LOW);

    Serial.println("[SPI-HOLD] SPI hold diagnostic aktif.");
    Serial.println("[SPI-HOLD] Ukur langsung di kaki ADS1299: CS39, SCLK40, DIN34.");

    for (;;) {
        hold_pin("CS pin39", EEG_PIN_ADS1299_CS);
        hold_pin("SCLK pin40", EEG_PIN_SPI_SCLK);
        hold_pin("DIN pin34", EEG_PIN_SPI_MOSI);
    }
}
#elif EEG_DOUT_DIAG
static void prepare_ads_lines(void) {
    pinMode(EEG_PIN_ADS1299_CS, OUTPUT);
    pinMode(EEG_PIN_SPI_SCLK, OUTPUT);
    pinMode(EEG_PIN_SPI_MOSI, OUTPUT);
    pinMode(EEG_PIN_ADS1299_RESET, OUTPUT);
    pinMode(EEG_PIN_ADS1299_PWDN, OUTPUT);
    pinMode(EEG_PIN_ADS1299_START, OUTPUT);
    pinMode(EEG_PIN_ADS1299_DRDY, INPUT);

    digitalWrite(EEG_PIN_ADS1299_CS, HIGH);
    digitalWrite(EEG_PIN_SPI_SCLK, LOW);
    digitalWrite(EEG_PIN_SPI_MOSI, LOW);
    digitalWrite(EEG_PIN_ADS1299_RESET, HIGH);
    digitalWrite(EEG_PIN_ADS1299_PWDN, HIGH);
    digitalWrite(EEG_PIN_ADS1299_START, LOW);
}

static void sample_miso_window(const char *label, uint16_t samples = 500U) {
    uint16_t high = 0U;
    uint16_t transitions = 0U;
    int last = digitalRead(EEG_PIN_SPI_MISO);

    for (uint16_t i = 0U; i < samples; ++i) {
        const int v = digitalRead(EEG_PIN_SPI_MISO);
        if (v) high++;
        if (v != last) transitions++;
        last = v;
        delayMicroseconds(200);
    }

    Serial.printf("[DOUT-DIAG] %-22s high=%u/%u transitions=%u now=%d CS=%d DRDY=%d\n",
                  label,
                  (unsigned)high,
                  (unsigned)samples,
                  (unsigned)transitions,
                  digitalRead(EEG_PIN_SPI_MISO),
                  digitalRead(EEG_PIN_ADS1299_CS),
                  digitalRead(EEG_PIN_ADS1299_DRDY));
}

static uint8_t spi_bitbang_byte(uint8_t out) {
    uint8_t in = 0U;
    for (uint8_t bit = 0U; bit < 8U; ++bit) {
        digitalWrite(EEG_PIN_SPI_MOSI, (out & 0x80U) ? HIGH : LOW);
        delayMicroseconds(20);
        digitalWrite(EEG_PIN_SPI_SCLK, HIGH);
        delayMicroseconds(20);
        in = static_cast<uint8_t>((in << 1U) | (digitalRead(EEG_PIN_SPI_MISO) ? 1U : 0U));
        digitalWrite(EEG_PIN_SPI_SCLK, LOW);
        delayMicroseconds(20);
        out <<= 1U;
    }
    return in;
}

static uint8_t bitbang_read_id_once(void) {
    digitalWrite(EEG_PIN_ADS1299_CS, LOW);
    delayMicroseconds(20);
    (void)spi_bitbang_byte(0x11U); /* SDATAC */
    delayMicroseconds(50);
    digitalWrite(EEG_PIN_ADS1299_CS, HIGH);
    delayMicroseconds(100);

    digitalWrite(EEG_PIN_ADS1299_CS, LOW);
    delayMicroseconds(20);
    const uint8_t echo0 = spi_bitbang_byte(0x20U); /* RREG ID */
    const uint8_t echo1 = spi_bitbang_byte(0x00U); /* one register */
    const uint8_t id = spi_bitbang_byte(0x00U);
    delayMicroseconds(20);
    digitalWrite(EEG_PIN_ADS1299_CS, HIGH);

    Serial.printf("[DOUT-DIAG] bitbang RREG ID echo=0x%02X/0x%02X id=0x%02X\n", echo0, echo1, id);
    return id;
}

static void run_dout_diag(void) {
    prepare_ads_lines();
    Serial.println("[DOUT-DIAG] GPIO19 / ADS1299 DOUT diagnostic aktif.");
    Serial.println("[DOUT-DIAG] Interpretasi cepat: floating mengikuti pull-up/down; stuck 0/1 tidak pernah berubah.");

    for (;;) {
        prepare_ads_lines();

        pinMode(EEG_PIN_SPI_MISO, INPUT);
        digitalWrite(EEG_PIN_ADS1299_CS, HIGH);
        sample_miso_window("CS high, no pull");

        pinMode(EEG_PIN_SPI_MISO, INPUT_PULLUP);
        sample_miso_window("CS high, pull-up");

        pinMode(EEG_PIN_SPI_MISO, INPUT_PULLDOWN);
        sample_miso_window("CS high, pull-down");

        pinMode(EEG_PIN_SPI_MISO, INPUT);
        digitalWrite(EEG_PIN_ADS1299_CS, LOW);
        sample_miso_window("CS low, no clock");

        for (uint8_t i = 0U; i < 32U; ++i) {
            digitalWrite(EEG_PIN_SPI_SCLK, HIGH);
            delayMicroseconds(50);
            digitalWrite(EEG_PIN_SPI_SCLK, LOW);
            delayMicroseconds(50);
        }
        sample_miso_window("CS low, after clocks");
        digitalWrite(EEG_PIN_ADS1299_CS, HIGH);

        (void)bitbang_read_id_once();
        delay(1500);
    }
}
#endif

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("[BOOT] ADS1299 EEG System");

#if EEG_DRDY_FREQ_DIAG
    run_drdy_freq_diag();
#elif EEG_SPI_HOLD_DIAG
    run_spi_hold_diag();
#elif EEG_DOUT_DIAG
    run_dout_diag();
#endif

    if (!eeg_task_start()) {
        Serial.println("[ERROR] EEG task gagal start — cek wiring ADS1299");
    } else {
        Serial.println("[BOOT] EEG task OK");
    }

    Serial.println("[BOOT] Setup selesai");
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(5000));
    Serial.printf("[LOOP] uptime=%lus  available=%lu  drdy_timeouts=%lu\n",
                  (unsigned long)(millis() / 1000UL),
                  (unsigned long)eeg_available(),
                  (unsigned long)0UL);
}
