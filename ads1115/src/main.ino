#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <driver/i2s.h>
#include <math.h>

// ─── User config ────────────────────────────────────────────────────────────
#define WS_HOST          "10.57.242.35"
#define WS_PORT          8080
#define DEVICE_ID        "esp32-abr-001"

// Hotspot default — dipakai kalau NVS kosong dan sebelum fallback ke AP mode
#define DEFAULT_SSID     "irsad"
#define DEFAULT_PASS     "nonenone"

// ─── Pin map ─────────────────────────────────────────────────────────────────
#define SDA_PIN       21
#define SCL_PIN       22
#define ALRT_PIN      34
#define I2S_BCLK      25   // BCK
#define I2S_LRC       26   // RCK/WS
#define I2S_DOUT      27   // DIN
#define BOOT_BTN      0

// ─── ADS1115 ─────────────────────────────────────────────────────────────────
#define GAIN_AD620    1000.0f
#define BUF_SIZE      512

// ─── Debug ───────────────────────────────────────────────────────────────────
#ifndef DEBUG_LEVEL
  #define DEBUG_LEVEL 1
#endif
#define PRINT_INTERVAL_MS  100

// ─── I2S ────────────────────────────────────────────────────────────────────
#define I2S_PORT      I2S_NUM_0
#define I2S_SAMPLE_RATE 44100
#define I2S_DMA_BUF_LEN 256
#define I2S_DMA_BUF_CNT 4
#define STIM_INTERVAL_MS 91   // ~11 clicks/sec
#define STIM_PULSE_SAMPLES 5

// ─── Ring buffer ─────────────────────────────────────────────────────────────
static int16_t       ringBuf[BUF_SIZE];
static volatile uint16_t bufHead = 0;
static volatile uint16_t bufTail = 0;

// ─── ADS1115 state ───────────────────────────────────────────────────────────
Adafruit_ADS1115   ads;
volatile bool      dataReady   = false;

// ─── Debug counters ──────────────────────────────────────────────────────────
static uint32_t    sampleCount   = 0;
static uint32_t    overflowCount = 0;
static uint32_t    lastStatMs    = 0;
static int16_t     rollingMin    = INT16_MAX;
static int16_t     rollingMax    = INT16_MIN;
static uint32_t    stimCount     = 0;

// ─── Throttled print state ───────────────────────────────────────────────────
static uint32_t    lastPrintMs   = 0;
static int16_t     lastRaw       = 0;
static bool        hasNewSample  = false;

// ─── WiFi / WS state ─────────────────────────────────────────────────────────
WebSocketsClient   wsClient;
static bool        wsConnected   = false;
static uint32_t    lastWifiLogMs = 0;
static bool        apMode        = false;
static uint32_t    lastReconnMs  = 0;

// ─── I2S state ───────────────────────────────────────────────────────────────
static bool        i2sReady      = false;
static bool        pendingI2SReinit = false;
static uint32_t    lastStimMs    = 0;
static bool        stimPending   = false;
static int         stimDbLevel   = 80;

// ─── ISR ─────────────────────────────────────────────────────────────────────
void IRAM_ATTR onDRDY() {
    dataReady = true;
}

// ─── Helpers: ring buffer ────────────────────────────────────────────────────
static inline uint16_t bufUsed() {
    return (bufHead - bufTail + BUF_SIZE) % BUF_SIZE;
}

// ─── I2S setup ───────────────────────────────────────────────────────────────
static void setupI2S() {
    if (i2sReady) i2s_driver_uninstall(I2S_PORT);

    i2s_config_t cfg = {
        .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
        .sample_rate          = I2S_SAMPLE_RATE,
        .bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format       = I2S_CHANNEL_FMT_RIGHT_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count        = I2S_DMA_BUF_CNT,
        .dma_buf_len          = I2S_DMA_BUF_LEN,
        .use_apll             = false,
        .tx_desc_auto_clear   = true,
    };

    i2s_pin_config_t pins = {
        .bck_io_num   = I2S_BCLK,
        .ws_io_num    = I2S_LRC,
        .data_out_num = I2S_DOUT,
        .data_in_num  = I2S_PIN_NO_CHANGE,
    };

    if (i2s_driver_install(I2S_PORT, &cfg, 0, NULL) != ESP_OK) {
        if (DEBUG_LEVEL >= 1) Serial.println(F("[I2S] driver install failed"));
        i2sReady = false;
        return;
    }
    i2s_set_pin(I2S_PORT, &pins);
    i2s_zero_dma_buffer(I2S_PORT);
    i2sReady = true;
}

// ─── Audio helpers ───────────────────────────────────────────────────────────
// Tulis blok silence supaya DMA flush dan tidak ada artefak dari klik sebelumnya
// 32-bit per sample: data 16-bit di-shift ke MSB (bit 31..16)
static inline int32_t to32(int16_t s) { return (int32_t)s << 16; }

static void i2sFlushSilence() {
    static const int32_t zeros[I2S_DMA_BUF_LEN * 2] = {0};
    size_t w = 0;
    i2s_write(I2S_PORT, zeros, sizeof(zeros), &w, pdMS_TO_TICKS(5));
}

static void playClick(int db) {
    if (!i2sReady) return;

    float scale;
    switch (db) {
        case 90: scale = 1.000f; break;
        case 80: scale = 0.316f; break;
        case 70: scale = 0.100f; break;
        case 60: scale = 0.032f; break;
        default: scale = 0.316f; break;
    }

    int16_t amp16 = (int16_t)(scale * 32767.0f);
    int32_t amp   = to32(amp16);

    static int32_t clickBuf[44 * 2];
    for (int i = 0; i < 44 * 2; i++) clickBuf[i] = amp;

    size_t w = 0;
    esp_err_t err = i2s_write(I2S_PORT, clickBuf, sizeof(clickBuf), &w, pdMS_TO_TICKS(5));
    if (DEBUG_LEVEL >= 1) {
        Serial.printf("[PCM] click %ddB  amp16=%d  written=%u/%u  err=%d\n",
                      db, amp16, w, sizeof(clickBuf), err);
    }
    i2sFlushSilence();
}

static void playStartupTone() {
    if (!i2sReady) {
        Serial.println(F("[PCM] SKIP — i2sReady=false"));
        return;
    }

    Serial.println(F("[PCM] Startup tone dimulai (32-bit)..."));
    static int32_t buf[256 * 2];
    size_t totalWritten = 0;

    // Fase 1: 200ms silence — PLL PCM5102A lock ke BCK/LRCK
    memset(buf, 0, sizeof(buf));
    int silenceSamples = I2S_SAMPLE_RATE * 200 / 1000;
    for (int offset = 0; offset < silenceSamples; offset += 256) {
        size_t w = 0;
        i2s_write(I2S_PORT, buf, sizeof(buf), &w, pdMS_TO_TICKS(50));
        totalWritten += w;
    }
    Serial.printf("[PCM] Silence: %u bytes\n", totalWritten);

    // Fase 2: 500ms square wave 1kHz
    const int TONE_HZ     = 1000;
    const int HALF_PERIOD = I2S_SAMPLE_RATE / TONE_HZ / 2;
    const int toneSamples = I2S_SAMPLE_RATE * 500 / 1000;
    totalWritten = 0;
    int writeErrors = 0;
    for (int offset = 0; offset < toneSamples; offset += 256) {
        int chunk = ((toneSamples - offset) < 256) ? (toneSamples - offset) : 256;
        for (int i = 0; i < chunk; i++) {
            int32_t s = to32((((offset + i) / HALF_PERIOD) % 2 == 0) ? 30000 : -30000);
            buf[i * 2]     = s;
            buf[i * 2 + 1] = s;
        }
        size_t w = 0;
        esp_err_t err = i2s_write(I2S_PORT, buf, chunk * 8, &w, pdMS_TO_TICKS(50));
        totalWritten += w;
        if (err != ESP_OK) writeErrors++;
    }
    Serial.printf("[PCM] Tone: %u bytes  errors=%d\n", totalWritten, writeErrors);

    i2sFlushSilence();
    Serial.println(F("[PCM] Done"));
}

// ─── WiFi ────────────────────────────────────────────────────────────────────
static void onWiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            wsConnected = false;
            // Jangan reinit I2S saat disconnect — loop jadi blocking
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            // Reinit I2S sekali setelah dapat IP (WiFi radio bisa ganggu I2S timing)
            pendingI2SReinit = true;
            break;
        default:
            break;
    }
}

static void startAP() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    WiFi.softAP("ESP32-ABR", "12345678");
    WiFi.softAPConfig(
        IPAddress(192, 168, 4, 1),
        IPAddress(192, 168, 4, 1),
        IPAddress(255, 255, 255, 0)
    );
    apMode = true;
    if (DEBUG_LEVEL >= 1) {
        Serial.printf("[WiFi] AP mode: ESP32-ABR  IP: %s\n",
                      WiFi.softAPIP().toString().c_str());
    }
}

static void connectWiFi() {
    Preferences prefs;
    prefs.begin("wifi", true);
    String ssid = prefs.getString("ssid", "");
    String pass = prefs.getString("pass", "");
    prefs.end();

    if (ssid.isEmpty()) {
        ssid = DEFAULT_SSID;
        pass = DEFAULT_PASS;
        if (DEBUG_LEVEL >= 1) Serial.println(F("[WiFi] NVS kosong, pakai DEFAULT_SSID"));
    }

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());

    if (DEBUG_LEVEL >= 1) Serial.printf("[WiFi] Connecting to %s", ssid.c_str());

    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(200);
        if (DEBUG_LEVEL >= 1) Serial.print('.');
    }

    if (WiFi.status() == WL_CONNECTED) {
        if (DEBUG_LEVEL >= 1) {
            Serial.printf(" OK  IP: %s\n", WiFi.localIP().toString().c_str());
        }
        apMode = false;
    } else {
        if (DEBUG_LEVEL >= 1) Serial.println(F(" TIMEOUT"));
        startAP();
    }
}

// ─── WebSocket event ─────────────────────────────────────────────────────────
static void onWsEvent(WStype_t type, uint8_t* payload, size_t len) {
    switch (type) {
        case WStype_CONNECTED:
            wsConnected = true;
            if (DEBUG_LEVEL >= 1) Serial.println(F("[WS] Connected"));
            break;

        case WStype_DISCONNECTED:
            wsConnected = false;
            if (DEBUG_LEVEL >= 1) Serial.println(F("[WS] Disconnected"));
            break;

        case WStype_TEXT: {
            StaticJsonDocument<128> doc;
            if (deserializeJson(doc, payload, len) == DeserializationError::Ok) {
                const char* cmd = doc["cmd"];
                if (cmd && strcmp(cmd, "set_db") == 0) {
                    stimDbLevel = doc["value"] | stimDbLevel;
                    if (DEBUG_LEVEL >= 1) {
                        Serial.printf("[WS] set_db → %d dB\n", stimDbLevel);
                    }
                }
            }
            break;
        }

        default:
            break;
    }
}

// ─── Stats ───────────────────────────────────────────────────────────────────
static void printStats() {
    uint32_t now     = millis();
    uint32_t elapsed = now - lastStatMs;
    if (elapsed == 0) return;

    float actualSps = sampleCount * 1000.0f / elapsed;

    const char* adsStatus = (actualSps > 10.0f) ? "ADS:OK" : "ADS:NO";
    const char* wsStatus  = wsConnected          ? "WS:OK"  : "WS:--";

    if (DEBUG_LEVEL == 1) {
        if (overflowCount > 0) {
            Serial.printf("[%s][%s] SPS:%5.0f  stim:%lu  buf:%3u  overflow:%lu\n",
                          adsStatus, wsStatus, actualSps, stimCount,
                          bufUsed(), overflowCount);
        } else {
            Serial.printf("[%s][%s] SPS:%5.0f  stim:%lu  buf:%3u\n",
                          adsStatus, wsStatus, actualSps, stimCount, bufUsed());
        }
    } else if (DEBUG_LEVEL >= 2) {
        float minMv = ads.computeVolts(rollingMin) * 1000.0f;
        float maxMv = ads.computeVolts(rollingMax) * 1000.0f;
        Serial.printf("[%s][%s] SPS:%5.0f  stim:%lu  buf:%3u  overflow:%lu  "
                      "raw:%d..%d  mV:%.3f..%.3f\n",
                      adsStatus, wsStatus, actualSps, stimCount,
                      bufUsed(), overflowCount,
                      rollingMin, rollingMax, minMv, maxMv);
        rollingMin = INT16_MAX;
        rollingMax = INT16_MIN;
    }

    sampleCount   = 0;
    overflowCount = 0;
    stimCount     = 0;
    lastStatMs    = now;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(500);  // beri waktu USB-UART stabil, tidak pakai while(!Serial)

    Serial.println(F("\n===== ESP32 ABR Demo (ADS1115) ====="));
    Serial.printf("Debug level : %d\n", DEBUG_LEVEL);
    Serial.printf("BUF_SIZE    : %d samples\n", BUF_SIZE);
    Serial.printf("AD620 gain  : %.0f\n", GAIN_AD620);
    Serial.printf("WS target   : %s:%d/ws?id=%s\n", WS_HOST, WS_PORT, DEVICE_ID);

    // Clear credentials if BOOT button held
    pinMode(BOOT_BTN, INPUT_PULLUP);
    if (digitalRead(BOOT_BTN) == LOW) {
        Preferences prefs;
        prefs.begin("wifi", false);
        prefs.clear();
        prefs.end();
        Serial.println(F("[NVS] WiFi credentials cleared"));
    }

    WiFi.onEvent(onWiFiEvent);
    connectWiFi();

    Wire.begin(SDA_PIN, SCL_PIN);
    Wire.setClock(100000);  // 100kHz — 400kHz timeout di ESP32 saat WiFi aktif

    Serial.print(F("ADS1115 init... "));
    if (!ads.begin(0x48)) {
        Serial.println(F("FAILED - check SDA/SCL/VDD/ADDR"));
        while (1) delay(1000);
    }
    Serial.println(F("OK"));

    ads.setGain(GAIN_ONE);
    ads.setDataRate(RATE_ADS1115_860SPS);
    ads.startADCReading(ADS1X15_REG_CONFIG_MUX_SINGLE_0, /*continuous=*/true);

    pinMode(ALRT_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(ALRT_PIN), onDRDY, FALLING);

    setupI2S();
    Serial.printf("I2S PCM5102A: %s (BCLK=%d LRC=%d DOUT=%d)\n",
                  i2sReady ? "OK" : "FAIL", I2S_BCLK, I2S_LRC, I2S_DOUT);
    if (i2sReady) {
        playStartupTone();  // tone 440Hz 100ms — kalau ada suara, PCM5102A OK
        Serial.println(F("I2S test tone selesai"));
    }

    // WS selalu di-init — library handle reconnect sendiri
    wsClient.begin(WS_HOST, WS_PORT, "/ws?id=" DEVICE_ID);
    wsClient.onEvent(onWsEvent);
    wsClient.setReconnectInterval(3000);
    Serial.printf("WS target: ws://%s:%d/ws?id=%s\n", WS_HOST, WS_PORT, DEVICE_ID);

    lastStatMs = millis();
    lastStimMs = millis();

    Serial.println(F("Sampling started."));
    if (DEBUG_LEVEL == 0) {
        Serial.println(F("Format: {t,r,s}  JSON over WS"));
    } else {
        Serial.println(F("Format: {t,r,s}  JSON over WS  + stats every 1s"));
    }
    Serial.println(F("====================================\n"));
}

// ─── Loop ────────────────────────────────────────────────────────────────────
void loop() {
    wsClient.loop();

    if (pendingI2SReinit) {
        pendingI2SReinit = false;
        setupI2S();
    }

    // wsClient.loop() sudah handle reconnect via setReconnectInterval — tidak perlu manual begin()

    // Read ADS1115 on DRDY
    if (dataReady) {
        dataReady = false;

        // I2C error recovery: kalau timeout, reinit Wire + restart ADC
        Wire.beginTransmission(0x48);
        uint8_t i2cErr = Wire.endTransmission();
        if (i2cErr != 0) {
            Wire.begin(SDA_PIN, SCL_PIN);
            Wire.setClock(100000);
            ads.begin(0x48);
            ads.setGain(GAIN_ONE);
            ads.setDataRate(RATE_ADS1115_860SPS);
            ads.startADCReading(ADS1X15_REG_CONFIG_MUX_SINGLE_0, true);
            return;  // skip sample ini
        }

        int16_t raw = ads.getLastConversionResults();

        uint16_t next = (bufHead + 1) % BUF_SIZE;
        if (next != bufTail) {
            ringBuf[bufHead] = raw;
            bufHead = next;
        } else {
            overflowCount++;
        }

        if (DEBUG_LEVEL >= 2) {
            if (raw < rollingMin) rollingMin = raw;
            if (raw > rollingMax) rollingMax = raw;
        }

        sampleCount++;
    }

    // Stimulus tick ~11/sec
    uint32_t nowMs = millis();
    if (nowMs - lastStimMs >= STIM_INTERVAL_MS) {
        lastStimMs = nowMs;
        playClick(stimDbLevel);
        stimPending = true;
        stimCount++;
    }

    // Drain ring buffer → WS send (batch up to 8 samples per message)
    #define WS_BATCH 8
    while (bufTail != bufHead) {
        static char jsonBuf[256];
        int pos = 0;
        pos += snprintf(jsonBuf + pos, sizeof(jsonBuf) - pos, "[");
        int count = 0;
        while (bufTail != bufHead && count < WS_BATCH) {
            lastRaw  = ringBuf[bufTail];
            bufTail  = (bufTail + 1) % BUF_SIZE;
            hasNewSample = true;
            int s = stimPending ? 1 : 0;
            if (stimPending) stimPending = false;
            pos += snprintf(jsonBuf + pos, sizeof(jsonBuf) - pos,
                            "%s{\"t\":%lu,\"r\":%d,\"s\":%d}",
                            count ? "," : "",
                            (unsigned long)millis(), lastRaw, s);
            count++;
        }
        snprintf(jsonBuf + pos, sizeof(jsonBuf) - pos, "]");
        if (wsConnected) wsClient.sendTXT(jsonBuf);
    }

    // Throttled serial data print
    nowMs = millis();
    if (hasNewSample && (nowMs - lastPrintMs >= PRINT_INTERVAL_MS)) {
        float volt_mv   = ads.computeVolts(lastRaw) * 1000.0f;
        float signal_uv = volt_mv / GAIN_AD620 * 1000.0f;

        if (DEBUG_LEVEL <= 1) {
            Serial.printf("%d,%.4f,%.4f\n", lastRaw, volt_mv, signal_uv);
        } else {
            Serial.printf("raw=%6d  mV=%8.4f  uV=%8.2f\n",
                          lastRaw, volt_mv, signal_uv);
        }

        lastPrintMs  = nowMs;
        hasNewSample = false;
    }

    // Stats every 1 second
    if (DEBUG_LEVEL >= 1 && (millis() - lastStatMs >= 1000)) {
        printStats();
    }

    // WiFi/WS status log tiap 5 detik untuk diagnosa
    if (DEBUG_LEVEL >= 1 && (millis() - lastWifiLogMs >= 5000)) {
        lastWifiLogMs = millis();
        wl_status_t ws = WiFi.status();
        if (ws == WL_CONNECTED) {
            Serial.printf("[NET] WiFi OK  IP:%s  WS:%s\n",
                          WiFi.localIP().toString().c_str(),
                          wsConnected ? "CONNECTED" : "connecting...");
        } else if (apMode) {
            Serial.printf("[NET] AP mode  IP:%s  WS:N/A\n",
                          WiFi.softAPIP().toString().c_str());
        } else {
            Serial.printf("[NET] WiFi status:%d (connecting...)  WS:waiting\n", ws);
        }
    }
}
