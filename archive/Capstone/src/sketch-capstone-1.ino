// ============================================================
//  ESP32 WROOM-32U — WebSocket Client + Serial Logger
//  Libraries (install via PlatformIO lib_deps):
//    - links2004/WebSockets
//    - bblanchon/ArduinoJson
// ============================================================

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <driver/i2s.h>
#include <math.h>
#include <SPI.h>

// ============================================================
//  CONFIG — sesuaikan di sini
// ============================================================
const char* WS_HOST   = "10.159.161.216";  // IP server Go
const int   WS_PORT   = 8080;
const char* WS_PATH   = "/ws";
const char* DEVICE_ID = "esp32-001";

const char* AP_SSID = "ESP32-Setup";
const char* AP_PASS = "12345678";

// Fallback WiFi — dicoba kalau tidak ada credentials tersimpan di NVS
// Kosongkan DEFAULT_SSID ("") untuk skip
const char* DEFAULT_SSID = "irsad";   // <-- ganti ini
const char* DEFAULT_PASS = "nonenone"; // <-- ganti ini

#define RESET_PIN  0   // GPIO 0 = BOOT button
#define LED_PIN    2   // Built-in LED

// PCM5102A I2S pins
#define I2S_BCLK  26
#define I2S_LRC   25
#define I2S_DOUT  22

// ADS1299 SPI pins
#define ADS_SCLK   18
#define ADS_MOSI   23
#define ADS_MISO   19
#define ADS_CS      5
#define ADS_DRDY    4
#define ADS_RESET  17
#define ADS_PWDN   16
#define ADS_START  21
#define ADS_CLKSEL 33   // HIGH = internal oscillator (wajib HIGH untuk EEG)

// ADS1299 commands
#define ADS_CMD_WAKEUP  0x02
#define ADS_CMD_RESET   0x06
#define ADS_CMD_START   0x08
#define ADS_CMD_STOP    0x0A
#define ADS_CMD_RDATAC  0x10
#define ADS_CMD_SDATAC  0x11
#define ADS_CMD_RREG    0x20
#define ADS_CMD_WREG    0x40

// ADS1299 registers
#define ADS_REG_ID      0x00
#define ADS_REG_CONFIG1 0x01
#define ADS_REG_CONFIG2 0x02
#define ADS_REG_CONFIG3 0x03
#define ADS_REG_CH1SET  0x05
#define ADS_REG_MISC1   0x15

#define ADS_NUM_CHANNELS 8

#define SAMPLE_RATE          44100
#define TICK_VOLUME          20000
#define AUDIO_BUF_COUNT      8
#define AUDIO_BUF_LEN        256
#define AUDIO_CHUNK_FRAMES   128

// ============================================================
//  GLOBALS
// ============================================================
WebSocketsClient wsClient;
WebServer        portalServer(80);
DNSServer        dnsServer;
Preferences      prefs;

bool wsConnected     = false;
bool portalSubmitted = false;

// Audio state
bool     i2sReady                = false;
bool     audioTickActive         = false;
uint32_t audioTickRemainingFrames = 0;
float    audioPhase              = 0.0f;
float    audioPhaseStep          = 0.0f;
bool     pendingI2SReinit        = false;

// ============================================================
//  AUDIO — PCM5102A via I2S
// ============================================================
bool setupI2S() {
  if (i2sReady) {
    i2s_driver_uninstall(I2S_NUM_0);
    i2sReady = false;
  }

  i2s_config_t cfg = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format       = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = 0,
    .dma_buf_count        = AUDIO_BUF_COUNT,
    .dma_buf_len          = AUDIO_BUF_LEN,
    .use_apll             = false,
    .tx_desc_auto_clear   = true,
    .fixed_mclk           = 0
  };

  i2s_pin_config_t pins = {
    .bck_io_num   = I2S_BCLK,
    .ws_io_num    = I2S_LRC,
    .data_out_num = I2S_DOUT,
    .data_in_num  = I2S_PIN_NO_CHANGE
  };

  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL) != ESP_OK) {
    Serial.println("[PCM5102] Gagal install I2S driver");
    return false;
  }
  if (i2s_set_pin(I2S_NUM_0, &pins) != ESP_OK) {
    Serial.println("[PCM5102] Gagal set pin I2S");
    i2s_driver_uninstall(I2S_NUM_0);
    return false;
  }

  i2s_zero_dma_buffer(I2S_NUM_0);
  i2sReady              = true;
  audioTickActive       = false;
  audioTickRemainingFrames = 0;
  audioPhase            = 0.0f;
  audioPhaseStep        = 0.0f;
  Serial.println("[PCM5102] Ready");
  return true;
}

// Mulai beep: frekuensi Hz, durasi ms
void playTick(int freqHz, int durationMs) {
  if (durationMs <= 0) return;
  if (!i2sReady && !setupI2S()) return;

  audioTickRemainingFrames = (uint32_t)((uint64_t)SAMPLE_RATE * durationMs / 1000ULL);
  if (audioTickRemainingFrames == 0) audioTickRemainingFrames = 1;
  audioPhase     = 0.0f;
  audioPhaseStep = (2.0f * PI * freqHz) / SAMPLE_RATE;
  audioTickActive = true;
}

// Dipanggil tiap loop() — non-blocking, tulis satu chunk DMA
void audioService() {
  if (!audioTickActive || !i2sReady) return;

  static int16_t buf[AUDIO_CHUNK_FRAMES * 2];
  uint32_t frames = min((uint32_t)AUDIO_CHUNK_FRAMES, audioTickRemainingFrames);

  for (uint32_t i = 0; i < frames; i++) {
    int16_t s = (int16_t)(TICK_VOLUME * sinf(audioPhase));
    audioPhase += audioPhaseStep;
    if (audioPhase > 2.0f * PI) audioPhase -= 2.0f * PI;
    buf[i * 2]     = s;
    buf[i * 2 + 1] = s;
  }

  size_t written = 0;
  i2s_write(I2S_NUM_0, buf, frames * sizeof(int16_t) * 2, &written, 0);

  uint32_t framesWritten = written / (sizeof(int16_t) * 2);
  if (framesWritten >= audioTickRemainingFrames) {
    audioTickRemainingFrames = 0;
    audioTickActive = false;
  } else {
    audioTickRemainingFrames -= framesWritten;
  }
}

// ============================================================
//  ADS1299 EEG
// ============================================================
volatile bool adsDataReady = false;

void IRAM_ATTR adsOnDRDY() {
  adsDataReady = true;
}

void adsSendCmd(uint8_t cmd) {
  digitalWrite(ADS_CS, LOW);
  SPI.transfer(cmd);
  digitalWrite(ADS_CS, HIGH);
  delayMicroseconds(2);
}

void adsWriteReg(uint8_t reg, uint8_t val) {
  digitalWrite(ADS_CS, LOW);
  SPI.transfer(ADS_CMD_WREG | reg);
  SPI.transfer(0x00); // write 1 register
  SPI.transfer(val);
  digitalWrite(ADS_CS, HIGH);
  delayMicroseconds(2);
}

uint8_t adsReadReg(uint8_t reg) {
  digitalWrite(ADS_CS, LOW);
  SPI.transfer(ADS_CMD_RREG | reg);
  SPI.transfer(0x00);
  uint8_t val = SPI.transfer(0x00);
  digitalWrite(ADS_CS, HIGH);
  delayMicroseconds(2);
  return val;
}

// Baca 1 frame: 3 byte status + 3 byte x 8 channel = 27 byte
bool adsReadFrame(int32_t channels[ADS_NUM_CHANNELS]) {
  if (!adsDataReady) return false;
  adsDataReady = false;

  digitalWrite(ADS_CS, LOW);
  // 3 byte status (buang)
  SPI.transfer(0x00);
  SPI.transfer(0x00);
  SPI.transfer(0x00);
  // 8 channel x 3 byte (24-bit signed)
  for (int i = 0; i < ADS_NUM_CHANNELS; i++) {
    uint32_t raw = 0;
    raw |= ((uint32_t)SPI.transfer(0x00) << 16);
    raw |= ((uint32_t)SPI.transfer(0x00) << 8);
    raw |= ((uint32_t)SPI.transfer(0x00));
    // Sign extend 24-bit ke 32-bit
    if (raw & 0x800000) raw |= 0xFF000000;
    channels[i] = (int32_t)raw;
  }
  digitalWrite(ADS_CS, HIGH);
  return true;
}

// Helper: cetak nilai register dengan nama
static void adsLogReg(const char* name, uint8_t reg, uint8_t expected, uint8_t got) {
  bool ok = (got == expected);
  Serial.printf("    %-10s reg=0x%02X exp=0x%02X got=0x%02X %s\n",
    name, reg, expected, got, ok ? "✓" : "✗ MISMATCH");
}

bool setupADS1299() {
  Serial.println("\n[ADS1299] ========================================");
  Serial.println("[ADS1299] INIT START");
  Serial.println("[ADS1299] ========================================");

  // --- STEP 1: set semua pin, CLKSEL HIGH sebelum apapun ---
  Serial.println("[ADS1299] STEP 1: Konfigurasi pin...");
  pinMode(ADS_CS,     OUTPUT); digitalWrite(ADS_CS, HIGH);
  pinMode(ADS_RESET,  OUTPUT); digitalWrite(ADS_RESET, HIGH);
  pinMode(ADS_PWDN,   OUTPUT); digitalWrite(ADS_PWDN, HIGH);
  pinMode(ADS_START,  OUTPUT); digitalWrite(ADS_START, LOW);
  pinMode(ADS_CLKSEL, OUTPUT); digitalWrite(ADS_CLKSEL, HIGH); // internal oscillator
  pinMode(ADS_DRDY,   INPUT_PULLUP); // open-drain → butuh pullup

  Serial.printf("  CS=%d RESET=%d PWDN=%d START=%d CLKSEL=%d DRDY=%d\n",
    ADS_CS, ADS_RESET, ADS_PWDN, ADS_START, ADS_CLKSEL, ADS_DRDY);
  Serial.printf("  CLKSEL → HIGH (internal oscillator)\n");
  Serial.printf("  DRDY → INPUT_PULLUP (open-drain, butuh pullup)\n");
  delay(10);

  // --- STEP 2: Cek sinyal raw sebelum power-on ---
  Serial.println("[ADS1299] STEP 2: Cek sinyal raw sebelum power-on...");
  pinMode(ADS_MISO, INPUT);
  Serial.printf("  MISO  (GPIO%-2d) = %s\n", ADS_MISO,  digitalRead(ADS_MISO)  ? "HIGH" : "LOW");
  Serial.printf("  DRDY  (GPIO%-2d) = %s  (HIGH=idle/no-data, LOW=data-ready)\n",
    ADS_DRDY, digitalRead(ADS_DRDY) ? "HIGH" : "LOW");
  Serial.printf("  RESET (GPIO%-2d) = %s\n", ADS_RESET, digitalRead(ADS_RESET) ? "HIGH" : "LOW");
  Serial.printf("  PWDN  (GPIO%-2d) = %s\n", ADS_PWDN,  digitalRead(ADS_PWDN)  ? "HIGH" : "LOW");

  // --- STEP 3: Power-on sequence ---
  Serial.println("[ADS1299] STEP 3: Power-on sequence...");
  Serial.println("  PWDN LOW 200ms → chip power-down...");
  digitalWrite(ADS_PWDN, LOW);
  delay(200);
  Serial.println("  PWDN HIGH → power-up...");
  digitalWrite(ADS_PWDN, HIGH);
  delay(100);
  Serial.printf("  MISO setelah PWDN HIGH = %s\n", digitalRead(ADS_MISO) ? "HIGH" : "LOW");

  // --- STEP 4: RESET pulse ---
  Serial.println("[ADS1299] STEP 4: RESET pulse...");
  digitalWrite(ADS_RESET, LOW);
  delay(10);
  Serial.printf("  MISO saat RESET LOW = %s\n", digitalRead(ADS_MISO) ? "HIGH" : "LOW");
  digitalWrite(ADS_RESET, HIGH);
  delay(200); // datasheet: min 18 tCLK setelah RESET HIGH, kasih 200ms untuk safety
  Serial.printf("  MISO setelah RESET HIGH (200ms) = %s\n", digitalRead(ADS_MISO) ? "HIGH" : "LOW");
  Serial.printf("  DRDY setelah RESET = %s\n", digitalRead(ADS_DRDY) ? "HIGH" : "LOW");

  // --- STEP 4.5: GPIO19 self-test (pastikan pin ESP32 berfungsi) ---
  Serial.println("[ADS1299] STEP 4.5: GPIO19 self-test...");
  // Drive GPIO19 sebagai OUTPUT HIGH, baca kembali
  pinMode(ADS_MISO, OUTPUT);
  digitalWrite(ADS_MISO, HIGH); delayMicroseconds(10);
  pinMode(ADS_MISO, INPUT);     delayMicroseconds(10);
  bool selfHigh = digitalRead(ADS_MISO);
  // Drive LOW
  pinMode(ADS_MISO, OUTPUT);
  digitalWrite(ADS_MISO, LOW);  delayMicroseconds(10);
  pinMode(ADS_MISO, INPUT);     delayMicroseconds(10);
  bool selfLow = digitalRead(ADS_MISO);
  Serial.printf("  GPIO19 self-test: drive HIGH → read %s | drive LOW → read %s\n",
    selfHigh ? "HIGH" : "LOW", selfLow ? "HIGH" : "LOW");
  if (!selfHigh || selfLow) {
    Serial.println("  [!!] GPIO19 BERMASALAH — pin tidak merespons benar");
    Serial.println("       Coba ganti GPIO MISO ke pin lain (misal GPIO34 INPUT-ONLY tidak cocok,");
    Serial.println("       coba GPIO35 atau GPIO12)");
  } else {
    Serial.println("  GPIO19 OK — pin ESP32 berfungsi normal");
    Serial.println("  → Masalah pasti di sisi ADS1299 atau kabel DOUT→GPIO19");
  }

  // --- STEP 4.7: SCOPE DEBUG ---
  Serial.println("[ADS1299] STEP 4.7: Scope debug — probe pin-pin ini di osiloskop...");
  pinMode(ADS_CS,   OUTPUT); digitalWrite(ADS_CS,   HIGH);
  pinMode(ADS_SCLK, OUTPUT); digitalWrite(ADS_SCLK, LOW);
  pinMode(ADS_MOSI, OUTPUT); digitalWrite(ADS_MOSI, LOW);
  pinMode(ADS_MISO, INPUT);

  // [A] SCLK burst 10kHz selama 500ms — mudah diidentifikasi di scope
  Serial.println("  [SCOPE-A] SCLK burst 10kHz, 500ms → probe GPIO18 & CLK chip");
  Serial.println("            Harus ada gelombang kotak ~10kHz di kedua titik");
  {
    unsigned long t0 = millis();
    while (millis() - t0 < 10000) { // 10 detik — cukup waktu untuk probe multimeter
      digitalWrite(ADS_SCLK, HIGH); delayMicroseconds(50);
      digitalWrite(ADS_SCLK, LOW);  delayMicroseconds(50);
    }
    digitalWrite(ADS_SCLK, LOW);
  }
  Serial.println("  [SCOPE-A] selesai");

  // [B] CS pulse + MOSI pattern 0xAA (10101010) — identifiable di scope
  Serial.println("  [SCOPE-B] CS LOW + MOSI 0xAA (10101010) 200x → probe GPIO5 & CS chip");
  Serial.println("            CS harus LOW, MOSI harus alternating HIGH-LOW");
  for (int rep = 0; rep < 200; rep++) {
    digitalWrite(ADS_CS, LOW); delayMicroseconds(10);
    for (int i = 7; i >= 0; i--) {
      digitalWrite(ADS_MOSI, (0xAA >> i) & 1);
      delayMicroseconds(50);
      digitalWrite(ADS_SCLK, HIGH); delayMicroseconds(50);
      digitalWrite(ADS_SCLK, LOW);  delayMicroseconds(50);
    }
    digitalWrite(ADS_CS, HIGH); delayMicroseconds(100);
  }
  Serial.println("  [SCOPE-B] selesai");

  // [C] Kirim SDATAC + RREG, log MISO setiap bit (24 bit = 3 byte)
  Serial.println("  [SCOPE-C] Kirim SDATAC+RREG, log MISO bit-per-bit...");
  Serial.println("            Probe GPIO19 & DOUT chip — harus ada sinyal saat CS LOW");
  digitalWrite(ADS_CS, LOW); delayMicroseconds(100);
  // kirim SDATAC (0x11)
  for (int i = 7; i >= 0; i--) {
    digitalWrite(ADS_MOSI, (0x11 >> i) & 1);
    delayMicroseconds(50);
    digitalWrite(ADS_SCLK, HIGH); delayMicroseconds(50);
    digitalWrite(ADS_SCLK, LOW);  delayMicroseconds(50);
  }
  digitalWrite(ADS_CS, HIGH); delay(10);

  // kirim RREG|ID (0x20), 0x00, baca 1 byte — log tiap bit
  Serial.print("  MISO bits (RREG): ");
  uint8_t miso_bits[24];
  uint8_t tx[3] = {0x20, 0x00, 0x00};
  uint8_t rx[3] = {0};
  digitalWrite(ADS_CS, LOW); delayMicroseconds(100);
  for (int b = 0; b < 3; b++) {
    for (int i = 7; i >= 0; i--) {
      digitalWrite(ADS_MOSI, (tx[b] >> i) & 1);
      delayMicroseconds(50);
      digitalWrite(ADS_SCLK, HIGH); delayMicroseconds(50);
      uint8_t bit = digitalRead(ADS_MISO);
      miso_bits[b*8+(7-i)] = bit;
      rx[b] = (rx[b] << 1) | bit;
      digitalWrite(ADS_SCLK, LOW); delayMicroseconds(50);
    }
  }
  digitalWrite(ADS_CS, HIGH);
  for (int i = 0; i < 24; i++) {
    Serial.print(miso_bits[i]);
    if (i == 7 || i == 15) Serial.print('|');
  }
  Serial.println();
  Serial.printf("  Bytes: 0x%02X 0x%02X 0x%02X | ID=0x%02X %s\n",
    rx[0], rx[1], rx[2], rx[2], rx[2]==0x3E?"✓":"✗");

  // [D] MISO voltage check — apakah MISO floating atau ada yang drive?
  Serial.println("  [SCOPE-D] MISO voltage check...");
  Serial.println("            Probe GPIO19: kalau floating = acak, kalau driven = stabil");
  {
    int highCount = 0;
    for (int i = 0; i < 1000; i++) {
      if (digitalRead(ADS_MISO)) highCount++;
      delayMicroseconds(100);
    }
    Serial.printf("  MISO: %d/1000 sample HIGH, %d/1000 LOW\n", highCount, 1000-highCount);
    if (highCount > 400 && highCount < 600)
      Serial.println("  → MISO FLOATING (acak ~50/50) — kabel DOUT→GPIO19 tidak ada sinyal");
    else if (highCount < 50)
      Serial.println("  → MISO stuck LOW — DOUT driven LOW atau short ke GND");
    else if (highCount > 950)
      Serial.println("  → MISO stuck HIGH — DOUT driven HIGH atau pullup dominan");
    else
      Serial.printf("  → MISO semi-stabil (%d%% HIGH) — noise atau sinyal lemah\n", highCount/10);
  }

  // --- STEP 5: Bit-bang SPI test ---
  Serial.println("[ADS1299] STEP 5: Bit-bang SPI test (Mode 1)...");
  pinMode(ADS_CS,   OUTPUT);
  pinMode(ADS_SCLK, OUTPUT); digitalWrite(ADS_SCLK, LOW);
  pinMode(ADS_MOSI, OUTPUT); digitalWrite(ADS_MOSI, LOW);
  pinMode(ADS_MISO, INPUT);

  digitalWrite(ADS_CS, HIGH); delay(1);
  Serial.printf("  MISO saat CS=HIGH = %s\n", digitalRead(ADS_MISO) ? "HIGH" : "LOW");
  digitalWrite(ADS_CS, LOW); delayMicroseconds(50);
  Serial.printf("  MISO saat CS=LOW  = %s  (ADS1299 seharusnya mulai drive DOUT)\n",
    digitalRead(ADS_MISO) ? "HIGH" : "LOW");
  digitalWrite(ADS_CS, HIGH);

  // SPI Mode 1: CPOL=0 CPHA=1, sample on falling edge
  // helper bit-bang dengan delay configurable
  auto bbByte = [](uint8_t out, uint32_t us) -> uint8_t {
    uint8_t in = 0;
    for (int i = 7; i >= 0; i--) {
      digitalWrite(ADS_MOSI, (out >> i) & 1);
      delayMicroseconds(us);
      digitalWrite(ADS_SCLK, HIGH); delayMicroseconds(us);
      digitalWrite(ADS_SCLK, LOW);  delayMicroseconds(us);
      in = (in << 1) | digitalRead(ADS_MISO);
    }
    return in;
  };

  // --- DRDY watch: apakah chip pernah assert DRDY LOW? ---
  Serial.println("  [DRDY] Tunggu DRDY LOW 2 detik (chip hidup = DRDY pernah LOW)...");
  {
    unsigned long t0 = millis();
    bool drdySeen = false;
    while (millis() - t0 < 2000) {
      if (digitalRead(ADS_DRDY) == LOW) { drdySeen = true; break; }
    }
    if (drdySeen) {
      Serial.println("  [DRDY] DRDY LOW terdeteksi ✓ — chip hidup dan konversi jalan!");
    } else {
      Serial.println("  [DRDY] DRDY tidak pernah LOW — chip tidak konversi / mati / START belum aktif");
    }
  }

  // Bit-bang 4µs
  Serial.println("  Bit-bang @ 4µs delay...");
  digitalWrite(ADS_CS, LOW); delayMicroseconds(10);
  bbByte(0x11, 4); // SDATAC
  digitalWrite(ADS_CS, HIGH); delay(10);
  digitalWrite(ADS_CS, LOW); delayMicroseconds(10);
  { uint8_t r0=bbByte(0x20,4), r1=bbByte(0x00,4), id=bbByte(0x00,4);
    Serial.printf("  4µs → bytes: 0x%02X 0x%02X 0x%02X | ID=0x%02X %s\n",
      r0,r1,id,id,id==0x3E?"✓":"✗"); }
  digitalWrite(ADS_CS, HIGH); delay(5);

  // Bit-bang 50µs (sangat lambat)
  Serial.println("  Bit-bang @ 50µs delay (sangat lambat)...");
  digitalWrite(ADS_CS, LOW); delayMicroseconds(50);
  bbByte(0x11, 50);
  digitalWrite(ADS_CS, HIGH); delay(20);
  digitalWrite(ADS_CS, LOW); delayMicroseconds(50);
  { uint8_t r0=bbByte(0x20,50), r1=bbByte(0x00,50), id=bbByte(0x00,50);
    Serial.printf("  50µs → bytes: 0x%02X 0x%02X 0x%02X | ID=0x%02X %s\n",
      r0,r1,id,id,id==0x3E?"✓":"✗"); }
  digitalWrite(ADS_CS, HIGH); delay(5);

  // Bit-bang 500µs (ultra lambat)
  Serial.println("  Bit-bang @ 500µs delay (ultra lambat)...");
  digitalWrite(ADS_CS, LOW); delayMicroseconds(500);
  bbByte(0x11, 500);
  digitalWrite(ADS_CS, HIGH); delay(50);
  digitalWrite(ADS_CS, LOW); delayMicroseconds(500);
  { uint8_t r0=bbByte(0x20,500), r1=bbByte(0x00,500), id=bbByte(0x00,500);
    Serial.printf("  500µs → bytes: 0x%02X 0x%02X 0x%02X | ID=0x%02X %s\n",
      r0,r1,id,id,id==0x3E?"✓":"✗"); }
  digitalWrite(ADS_CS, HIGH);

  uint8_t id_bb = 0x00; // hasil bit-bang terbaik (diisi di bawah)
  // ambil hasil dari 4µs sebagai referensi (sudah dilog di atas)
  digitalWrite(ADS_CS, LOW); delayMicroseconds(10);
  bbByte(0x11, 4);
  digitalWrite(ADS_CS, HIGH); delay(10);
  digitalWrite(ADS_CS, LOW); delayMicroseconds(10);
  bbByte(0x20, 4); bbByte(0x00, 4); id_bb = bbByte(0x00, 4);
  digitalWrite(ADS_CS, HIGH);

  Serial.printf("  MISO setelah bit-bang = %s\n", digitalRead(ADS_MISO) ? "HIGH" : "LOW");
  Serial.printf("  DRDY setelah bit-bang = %s\n", digitalRead(ADS_DRDY) ? "HIGH" : "LOW");

  // --- STEP 6: Library SPI test, beberapa mode & frekuensi ---
  Serial.println("[ADS1299] STEP 6: Library SPI test...");
  SPI.begin(ADS_SCLK, ADS_MISO, ADS_MOSI, ADS_CS);
  SPI.setBitOrder(MSBFIRST);

  struct { uint8_t mode; uint32_t freq; } spiConfigs[] = {
    {SPI_MODE1, 250000},
    {SPI_MODE1, 100000},
    {SPI_MODE0, 250000},
    {SPI_MODE1, 500000},
  };
  uint8_t best_id = 0x00;
  uint8_t best_mode = SPI_MODE1;
  for (auto& cfg : spiConfigs) {
    SPI.setDataMode(cfg.mode);
    SPI.setFrequency(cfg.freq);
    adsSendCmd(ADS_CMD_SDATAC); delayMicroseconds(500);
    uint8_t id_lib = adsReadReg(ADS_REG_ID);
    Serial.printf("  Mode%d @ %6lu Hz → ID=0x%02X %s\n",
      cfg.mode, cfg.freq, id_lib, id_lib == 0x3E ? "✓ MATCH" : "");
    if (id_lib == 0x3E && best_id != 0x3E) {
      best_id   = id_lib;
      best_mode = cfg.mode;
    } else if (best_id == 0x00) {
      best_id = id_lib; // simpan nilai apapun untuk diagnosa
    }
  }

  uint8_t id = (id_bb == 0x3E) ? id_bb : best_id;

  // Write-readback test pada Mode1
  SPI.setDataMode(SPI_MODE1);
  SPI.setFrequency(250000);
  adsSendCmd(ADS_CMD_SDATAC); delay(5);
  Serial.println("[ADS1299] STEP 7: Write→Read register test...");
  adsWriteReg(ADS_REG_MISC1, 0x20);
  delayMicroseconds(100);
  uint8_t rb = adsReadReg(ADS_REG_MISC1);
  Serial.printf("  MISC1: write 0x20 → read 0x%02X %s\n", rb, rb == 0x20 ? "✓" : "✗");

  // --- STEP 8: Diagnosa akhir ---
  Serial.println("[ADS1299] ========================================");
  Serial.println("[ADS1299] DIAGNOSA:");
  if (id == 0xFF) {
    Serial.println("  0xFF → MISO stuck HIGH");
    Serial.println("  → Cek apakah ada level-shifter antara DOUT dan GPIO19");
    Serial.println("  → Cek apakah SCLK (GPIO18) sampai ke chip");
  } else if (id == 0x00) {
    Serial.println("  0x00 → MISO stuck LOW");
    Serial.println("  KEMUNGKINAN PENYEBAB (urut dari paling sering):");
    Serial.println("  1. DOUT (ADS1299) TIDAK tersambung ke GPIO19 — cek kabel/soldiran");
    Serial.println("  2. DVDD/AVDD tidak ada tegangan — ukur pin 11,12 harus ~3.3V");
    Serial.println("  3. CLKSEL floating/LOW — pin ini harus HIGH untuk internal osc");
    Serial.println("     → Firmware sudah set GPIO33 HIGH, cek apakah terhubung ke CLKSEL chip");
    Serial.println("  4. Chip rusak / terbakar");
  } else if (id == 0x3E) {
    Serial.println("  0x3E → ADS1299 terdeteksi ✓");
  } else {
    Serial.printf("  0x%02X → Chip merespons tapi ID tidak valid\n", id);
    Serial.println("  → Kemungkinan bukan ADS1299, atau SPI mode/frekuensi salah");
    Serial.println("  → Coba cek ADS1299-4 (ID=0x3C) atau ADS1296 (ID=0x3A)");
  }
  Serial.printf("  MISO sekarang = %s\n", digitalRead(ADS_MISO) ? "HIGH" : "LOW");
  Serial.printf("  DRDY sekarang = %s\n", digitalRead(ADS_DRDY) ? "HIGH" : "LOW");
  Serial.println("[ADS1299] ========================================");
  Serial.printf("[ADS1299] ID = 0x%02X %s\n", id, (id == 0x3E) ? "✓ OK" : "✗ GAGAL");

  if (id != 0x3E) return false;

  // --- STEP 9: Konfigurasi register ---
  Serial.println("[ADS1299] STEP 9: Tulis konfigurasi register...");
  SPI.setDataMode(best_mode);
  SPI.setFrequency(250000);
  adsSendCmd(ADS_CMD_SDATAC); delay(5);

  // CONFIG1: 250 SPS, internal oscillator, daisy-chain off
  adsWriteReg(ADS_REG_CONFIG1, 0x96);
  // CONFIG2: internal test signal off, amp cal off, internal ref
  adsWriteReg(ADS_REG_CONFIG2, 0xC0);
  // CONFIG3: internal reference ON, bias buffer ON
  adsWriteReg(ADS_REG_CONFIG3, 0xEC);
  delay(150);

  // Readback verifikasi
  Serial.println("  Verifikasi register:");
  adsLogReg("CONFIG1", ADS_REG_CONFIG1, 0x96, adsReadReg(ADS_REG_CONFIG1));
  adsLogReg("CONFIG2", ADS_REG_CONFIG2, 0xC0, adsReadReg(ADS_REG_CONFIG2));
  adsLogReg("CONFIG3", ADS_REG_CONFIG3, 0xEC, adsReadReg(ADS_REG_CONFIG3));

  // Semua channel: gain 24x, normal input (0x60)
  Serial.println("  Set semua channel gain 24x...");
  for (int i = 0; i < ADS_NUM_CHANNELS; i++) {
    adsWriteReg(ADS_REG_CH1SET + i, 0x60);
    uint8_t chval = adsReadReg(ADS_REG_CH1SET + i);
    Serial.printf("    CH%d: tulis 0x60 → baca 0x%02X %s\n",
      i+1, chval, chval == 0x60 ? "✓" : "✗");
  }

  // DRDY interrupt (falling edge = data siap)
  attachInterrupt(digitalPinToInterrupt(ADS_DRDY), adsOnDRDY, FALLING);
  Serial.printf("  DRDY interrupt attach GPIO%d FALLING\n", ADS_DRDY);

  // START konversi
  digitalWrite(ADS_START, HIGH);
  delay(1);
  adsSendCmd(ADS_CMD_START);
  delay(1);
  adsSendCmd(ADS_CMD_RDATAC);

  Serial.println("[ADS1299] Ready — streaming 250 SPS ✓");
  return true;
}

// Kirim data EEG via WebSocket (JSON)
void adsSendToWS(int32_t channels[ADS_NUM_CHANNELS]) {
  if (!wsConnected) return;

  StaticJsonDocument<256> doc;
  doc["type"]   = "eeg";
  doc["device"] = DEVICE_ID;
  doc["ts"]     = millis();
  JsonArray ch  = doc.createNestedArray("ch");
  for (int i = 0; i < ADS_NUM_CHANNELS; i++) ch.add(channels[i]);

  String msg;
  serializeJson(doc, msg);
  wsClient.sendTXT(msg);
}

// ============================================================
//  NVS HELPERS
// ============================================================
void clearSavedWiFi() {
  prefs.begin("wifi-cfg", false);
  prefs.clear();
  prefs.end();
  Serial.println("[NVS] Kredensial WiFi dihapus");
}

bool loadWiFiCreds(String& ssid, String& pass) {
  prefs.begin("wifi-cfg", true);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  prefs.end();
  return ssid.length() > 0;
}

void saveWiFiCreds(const String& ssid, const String& pass) {
  prefs.begin("wifi-cfg", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
}

// ============================================================
//  WIFI STATION
// ============================================================
bool tryConnect(const String& ssid, const String& pass) {
  Serial.print("[WiFi] Konek ke: " + ssid);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), pass.c_str());

  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] Terhubung. IP: " + WiFi.localIP().toString());
    return true;
  }

  WiFi.disconnect(true);
  Serial.println("[WiFi] Gagal konek");
  return false;
}

bool connectSavedWiFi() {
  // 1. Coba credentials tersimpan di NVS
  String ssid, pass;
  if (loadWiFiCreds(ssid, pass)) {
    if (tryConnect(ssid, pass)) return true;
  } else {
    Serial.println("[WiFi] Belum ada kredensial tersimpan");
  }

  // 2. Coba default hardcoded (hotspot HP)
  if (strlen(DEFAULT_SSID) > 0) {
    Serial.println("[WiFi] Coba default WiFi...");
    if (tryConnect(DEFAULT_SSID, DEFAULT_PASS)) {
      // Simpan ke NVS supaya next boot langsung konek
      saveWiFiCreds(DEFAULT_SSID, DEFAULT_PASS);
      return true;
    }
  }

  return false;
}

// ============================================================
//  CAPTIVE PORTAL
// ============================================================
static String cachedWifiList;
static bool   scanInProgress = false;

static String htmlEscape(const String& s) {
  String o = s;
  o.replace("&", "&amp;");
  o.replace("<", "&lt;");
  o.replace(">", "&gt;");
  o.replace("\"", "&quot;");
  return o;
}

static String jsEscape(const String& s) {
  String o = s;
  o.replace("\\", "\\\\");
  o.replace("'", "\\'");
  return o;
}

void startAsyncScan() {
  if (!scanInProgress) {
    WiFi.scanNetworks(true);
    scanInProgress = true;
  }
}

void checkScanResults() {
  if (!scanInProgress) return;
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return;
  scanInProgress = false;

  if (n <= 0) {
    cachedWifiList = "<p style='color:#9fb3c8'>Tidak ada jaringan. Isi SSID manual.</p>";
    WiFi.scanDelete();
    return;
  }

  String html = "";
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;
    html += "<button type='button' onclick=\"document.getElementById('ssid').value='";
    html += jsEscape(ssid);
    html += "';document.getElementById('pass').focus()\" style='display:block;width:100%;margin:4px 0;padding:10px;background:#0b1629;border:1px solid #334;border-radius:10px;color:#eef6ff;text-align:left;cursor:pointer'>";
    html += htmlEscape(ssid);
    html += " <span style='color:#9fb3c8;font-size:12px'>(";
    html += String(WiFi.RSSI(i));
    html += " dBm)</span></button>";
  }
  cachedWifiList = html;
  WiFi.scanDelete();
}

String buildPortalPage(const String& notice, bool isError) {
  String page = "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ESP32 Setup</title>"
    "<style>body{margin:0;font-family:sans-serif;background:#08111f;color:#eef6ff;display:flex;justify-content:center;padding:20px}"
    ".box{width:100%;max-width:480px}.h1{font-size:22px;margin-bottom:4px}"
    "label{display:block;margin:12px 0 4px;font-size:13px;color:#9fb3c8}"
    "input{width:100%;padding:12px;background:#0b1629;border:1px solid #334;border-radius:10px;color:#eef6ff;font-size:15px;box-sizing:border-box}"
    "button.cta{width:100%;margin-top:16px;padding:14px;background:linear-gradient(135deg,#34d399,#38bdf8);border:0;border-radius:12px;color:#02190d;font-weight:800;font-size:15px;cursor:pointer}"
    ".notice{padding:10px 14px;border-radius:10px;margin-bottom:12px;font-size:14px}"
    ".ok{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3)}"
    ".err{background:rgba(251,113,133,.12);border:1px solid rgba(251,113,133,.3)}</style>"
    "</head><body><div class='box'>"
    "<p class='h1'>ESP32 WiFi Setup</p>"
    "<p style='color:#9fb3c8;font-size:13px'>Device: ";
  page += htmlEscape(DEVICE_ID);
  page += " &nbsp;|&nbsp; Server: ";
  page += htmlEscape(String(WS_HOST) + ":" + WS_PORT);
  page += "</p>";

  if (notice.length() > 0) {
    page += "<div class='notice ";
    page += isError ? "err'>" : "ok'>";
    page += htmlEscape(notice);
    page += "</div>";
  }

  page += "<p style='font-size:12px;color:#9fb3c8;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 8px'>Jaringan Terdeteksi</p>";
  page += (cachedWifiList.length() > 0 ? cachedWifiList : "<p style='color:#9fb3c8'>Memindai...</p>");
  page += "<form method='POST' action='/save'>"
    "<label>SSID</label><input id='ssid' name='ssid' placeholder='Nama WiFi' required>"
    "<label>Password</label><input id='pass' name='pass' type='password' placeholder='Password WiFi'>"
    "<button class='cta' type='submit'>Simpan &amp; Hubungkan</button>"
    "</form>"
    "<p style='color:#9fb3c8;font-size:12px;margin-top:12px'>Tahan tombol BOOT 3 detik untuk reset WiFi.</p>"
    "</div></body></html>";
  return page;
}

void startConfigPortal() {
  Serial.println("[Portal] Membuka AP: " + String(AP_SSID));
  Serial.println("[Portal] Buka browser: 192.168.4.1");

  portalSubmitted = false;
  cachedWifiList  = "";
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  WiFi.softAP(AP_SSID, AP_PASS);
  delay(300);

  dnsServer.start(53, "*", WiFi.softAPIP());

  portalServer.on("/", HTTP_GET, []() {
    portalServer.send(200, "text/html", buildPortalPage("", false));
  });
  portalServer.on("/save", HTTP_POST, []() {
    String ssid = portalServer.arg("ssid");
    String pass = portalServer.arg("pass");
    ssid.trim(); pass.trim();
    if (ssid.length() == 0) {
      portalServer.send(400, "text/html", buildPortalPage("SSID wajib diisi.", true));
      return;
    }
    saveWiFiCreds(ssid, pass);
    portalSubmitted = true;
    portalServer.send(200, "text/html", buildPortalPage("Disimpan! ESP32 akan restart.", false));
  });
  // Captive portal probes
  auto redirect = []() {
    portalServer.sendHeader("Location", "http://192.168.4.1/", true);
    portalServer.send(302, "text/plain", "");
  };
  portalServer.on("/generate_204",       HTTP_GET, redirect);
  portalServer.on("/gen_204",            HTTP_GET, redirect);
  portalServer.on("/hotspot-detect.html",HTTP_GET, []() {
    portalServer.send(200, "text/html", buildPortalPage("", false));
  });
  portalServer.on("/ncsi.txt",           HTTP_GET, redirect);
  portalServer.onNotFound(redirect);
  portalServer.begin();

  unsigned long start    = millis();
  unsigned long lastScan = millis();
  bool firstScan = false;

  while (!portalSubmitted) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    checkScanResults();

    if (!firstScan && millis() - start > 3000) {
      startAsyncScan();
      firstScan = true;
    }
    if (firstScan && !scanInProgress && millis() - lastScan > 30000) {
      startAsyncScan();
      lastScan = millis();
    }
    if (millis() - start > 180000) {
      Serial.println("[Portal] Timeout, restart...");
      delay(500);
      ESP.restart();
    }
    delay(2);
  }

  dnsServer.stop();
  delay(1000);
  ESP.restart();
}

// ============================================================
//  WEBSOCKET
// ============================================================
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {

    case WStype_CONNECTED:
      wsConnected = true;
      digitalWrite(LED_PIN, HIGH);
      Serial.println("[WS] Terhubung ke server");
      // Kirim hello
      {
        StaticJsonDocument<128> doc;
        doc["type"]   = "hello";
        doc["device"] = DEVICE_ID;
        String msg;
        serializeJson(doc, msg);
        wsClient.sendTXT(msg);
      }
      break;

    case WStype_DISCONNECTED:
      wsConnected = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("[WS] Putus, mencoba reconnect...");
      break;

    case WStype_TEXT:
      Serial.printf("[WS] ← %.*s\n", (int)length, payload);
      break;

    case WStype_BIN:
      Serial.printf("[WS] ← binary %u bytes\n", (unsigned)length);
      break;

    case WStype_PING:
      Serial.println("[WS] Ping");
      break;

    case WStype_PONG:
      Serial.println("[WS] Pong");
      break;

    case WStype_ERROR:
      Serial.println("[WS] Error");
      break;

    default:
      break;
  }
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(800);

  pinMode(RESET_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.println("\n=== ESP32 WebSocket Logger ===");
  Serial.printf("Device: %s  Server: %s:%d%s\n", DEVICE_ID, WS_HOST, WS_PORT, WS_PATH);

  // Test audio SEBELUM WiFi — kalau dengar suara berarti WiFi yang ganggu I2S
  setupI2S();
  Serial.println("[TEST] Beep sebelum WiFi...");
  playTick(440, 500);
  unsigned long t = millis();
  while (millis() - t < 600) audioService();
  delay(200);
  playTick(880, 500);
  t = millis();
  while (millis() - t < 600) audioService();
  delay(500);
  Serial.println("[TEST] Selesai. Dengar suara? Kalau ya = WiFi ganggu I2S.");

  // Tahan BOOT saat startup → reset credentials
  if (digitalRead(RESET_PIN) == LOW) {
    clearSavedWiFi();
    delay(300);
  }

  if (!connectSavedWiFi()) {
    startConfigPortal(); // tidak return — restart setelah portal
  }

  // Reinit I2S setelah WiFi konek — WiFi radio mengganggu I2S timing
  Serial.println("[PCM5102] Reinit I2S setelah WiFi...");
  setupI2S();

  setupADS1299();

  // Buka WebSocket
  String path = String(WS_PATH) + "?id=" + DEVICE_ID;
  wsClient.begin(WS_HOST, WS_PORT, path.c_str());
  wsClient.onEvent(webSocketEvent);
  wsClient.setReconnectInterval(5000);
  wsClient.enableHeartbeat(15000, 3000, 2);

  Serial.println("[WS] Konek ke ws://" + String(WS_HOST) + ":" + WS_PORT + path);
}

// ============================================================
//  LOOP
// ============================================================
void loop() {
  wsClient.loop();
  audioService();

  // Baca EEG kalau DRDY triggered
  static int32_t eegChannels[ADS_NUM_CHANNELS];
  static uint32_t eegSampleCount = 0;
  static unsigned long lastEegLog = 0;
  if (adsReadFrame(eegChannels)) {
    adsSendToWS(eegChannels);
    eegSampleCount++;
    // Log 1x per detik
    if (millis() - lastEegLog > 1000) {
      lastEegLog = millis();
      Serial.printf("[EEG] %lu sps | ch1=%ld ch2=%ld ch3=%ld\n",
        eegSampleCount, eegChannels[0], eegChannels[1], eegChannels[2]);
      eegSampleCount = 0;
    }
  }

  // Beep 1000 Hz / 100 ms tiap 2 detik — test PCM5102A
  static unsigned long lastTick = 0;
  if (!audioTickActive && millis() - lastTick > 2000) {
    lastTick = millis();
    playTick(1000, 100);
  }

  // Tahan BOOT 5 detik di runtime → reset WiFi
  // Diabaikan dalam 5 detik pertama setelah boot (hindari false trigger)
  static unsigned long bootTime = millis();
  if (millis() - bootTime > 5000 && digitalRead(RESET_PIN) == LOW) {
    unsigned long held = millis();
    while (digitalRead(RESET_PIN) == LOW && millis() - held < 5000) delay(10);
    if (millis() - held >= 5000) {
      clearSavedWiFi();
      ESP.restart();
    }
  }
}
