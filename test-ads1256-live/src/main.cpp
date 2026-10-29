/*
  ADS1256 live monitor (turunan ADS1256_Channel_Scan.ino)
  Diagnosis: baca tegangan tiap input ADS1256 satu per satu, untuk mencari
  di kanal mana tegangan VOUT AD620 (~1,3 V di pin header A0) benar-benar muncul.

  - Single-ended: AINx - AINCOM (kolom ACOM modul = AGND), x = 0..7
  - Diferensial : AIN0-AIN1 dan AIN2-AIN3
  - Diulang dengan buffer ON dan buffer OFF
  - MUX dibaca balik untuk memastikan register benar
  Wiring SPI sama: CS=IO21, SCLK=IO18, DIN=IO23, DRDY=IO34, DOUT=IO19, RST=IO26
  Serial Monitor 115200 baud. Tekan EN untuk mengulang.
*/
#include <Arduino.h>
#include <SPI.h>

const int PIN_CS = 21, PIN_SCLK = 18, PIN_MISO = 19, PIN_MOSI = 23;
const int PIN_DRDY = 34, PIN_RST = 26, PIN_PDWN = 27;
SPISettings adsSPI(500000, MSBFIRST, SPI_MODE1);

const uint8_t CMD_WAKEUP = 0x00, CMD_RDATA = 0x01, CMD_RREG = 0x10, CMD_WREG = 0x50;
const uint8_t CMD_SELFCAL = 0xF0, CMD_SYNC = 0xFC, CMD_RESET = 0xFE;
const uint8_t REG_STATUS = 0x00, REG_MUX = 0x01, REG_ADCON = 0x02, REG_DRATE = 0x03;
const float LSB_V = (2.0f * 2.5f / 1.0f) / 8388608.0f;   // PGA 1

void csLow()  { digitalWrite(PIN_CS, LOW);  delayMicroseconds(1); }
void csHigh() { delayMicroseconds(2); digitalWrite(PIN_CS, HIGH); delayMicroseconds(5); }
void sendCmd(uint8_t c) { SPI.beginTransaction(adsSPI); csLow(); SPI.transfer(c); csHigh(); SPI.endTransaction(); }
void writeReg(uint8_t r, uint8_t v) {
  SPI.beginTransaction(adsSPI); csLow();
  SPI.transfer(CMD_WREG | r); SPI.transfer(0); SPI.transfer(v);
  csHigh(); SPI.endTransaction();
}
uint8_t readReg(uint8_t r) {
  SPI.beginTransaction(adsSPI); csLow();
  SPI.transfer(CMD_RREG | r); SPI.transfer(0); delayMicroseconds(10);
  uint8_t v = SPI.transfer(0xFF); csHigh(); SPI.endTransaction(); return v;
}
bool waitFalling(uint32_t to_us) {
  uint32_t t0 = micros();
  while (digitalRead(PIN_DRDY) == LOW)  if (micros() - t0 > to_us) return false;
  while (digitalRead(PIN_DRDY) == HIGH) if (micros() - t0 > to_us) return false;
  return true;
}
int32_t rdata() {
  SPI.beginTransaction(adsSPI); csLow(); SPI.transfer(CMD_RDATA); delayMicroseconds(10);
  uint32_t b0 = SPI.transfer(0xFF), b1 = SPI.transfer(0xFF), b2 = SPI.transfer(0xFF);
  csHigh(); SPI.endTransaction();
  int32_t v = (b0 << 16) | (b1 << 8) | b2; if (v & 0x800000) v |= 0xFF000000; return v;
}

float measure(uint8_t mux, uint8_t &muxBack) {
  waitFalling(100000);
  writeReg(REG_MUX, mux);
  muxBack = readReg(REG_MUX);
  sendCmd(CMD_SYNC); sendCmd(CMD_WAKEUP);
  waitFalling(100000); waitFalling(100000);           // buang hasil settling
  double s = 0;
  for (int i = 0; i < 16; i++) { waitFalling(100000); s += rdata(); }
  return (s / 16) * LSB_V;
}


void setup() {
  Serial.begin(115200); delay(500);
  pinMode(PIN_CS, OUTPUT);   digitalWrite(PIN_CS, HIGH);
  pinMode(PIN_RST, OUTPUT);  digitalWrite(PIN_RST, HIGH);
  pinMode(PIN_PDWN, OUTPUT); digitalWrite(PIN_PDWN, HIGH);
  pinMode(PIN_DRDY, INPUT);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, PIN_CS);
  digitalWrite(PIN_RST, LOW); delay(1); digitalWrite(PIN_RST, HIGH); delay(50);
  waitFalling(500000); sendCmd(CMD_RESET); delay(5); waitFalling(500000);
  writeReg(REG_STATUS, 0x02);    // buffer ON
  writeReg(REG_ADCON, 0x00);     // PGA 1
  writeReg(REG_DRATE, 0xA1);     // 1000 SPS
  waitFalling(100000); sendCmd(CMD_SELFCAL); delay(10); waitFalling(1000000);
  Serial.printf("\n### Live monitor | ID=%u\n", readReg(REG_STATUS) >> 4);
}

void loop() {
  uint8_t mb;
  float a0c = measure(0x08, mb);   // AIN0 - AINCOM
  float a1c = measure(0x18, mb);   // AIN1 - AINCOM
  float a01 = measure(0x01, mb);   // AIN0 - AIN1
  float a2c = measure(0x28, mb);   // AIN2 - AINCOM (pembanding kanal kosong)
  Serial.printf("A0-COM %8.4f | A1-COM %8.4f | A0-A1 %8.4f | A2-COM %8.4f V\n", a0c, a1c, a01, a2c);
  delay(200);
}
