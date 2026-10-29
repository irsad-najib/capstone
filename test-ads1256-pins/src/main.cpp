// Tes pin ADS1256: apakah DRDY toggle, dan apakah DOUT (MISO) floating/nyangkut.
#include <Arduino.h>

const int PIN_CS = 21, PIN_SCLK = 18, PIN_MISO = 19, PIN_MOSI = 23;
const int PIN_DRDY = 34, PIN_RST = 26, PIN_PDWN = 27;

void setup() {
  Serial.begin(115200); delay(500);
  pinMode(PIN_CS, OUTPUT);   digitalWrite(PIN_CS, HIGH);
  pinMode(PIN_SCLK, OUTPUT); digitalWrite(PIN_SCLK, LOW);
  pinMode(PIN_MOSI, OUTPUT); digitalWrite(PIN_MOSI, LOW);
  pinMode(PIN_PDWN, OUTPUT); digitalWrite(PIN_PDWN, HIGH);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, LOW); delay(1); digitalWrite(PIN_RST, HIGH); delay(50);
  pinMode(PIN_DRDY, INPUT);

  // Hitung tepi DRDY selama 1 detik (default 30 kSPS -> ~30000 tepi turun)
  uint32_t t0 = millis(), falls = 0, highs = 0, n = 0; int prev = digitalRead(PIN_DRDY);
  while (millis() - t0 < 1000) {
    int v = digitalRead(PIN_DRDY); n++; highs += v;
    if (prev == HIGH && v == LOW) falls++;
    prev = v;
  }
  Serial.printf("\n### DRDY(IO34): %u tepi turun/detik, HIGH %.1f%% sampel\n", falls, 100.0 * highs / n);

  // DOUT dengan CS LOW: tarik pull-up lalu pull-down. Kalau ikut tarikan -> floating/tidak nyambung.
  digitalWrite(PIN_CS, LOW); delayMicroseconds(10);
  pinMode(PIN_MISO, INPUT_PULLUP);   delay(2); int pu = digitalRead(PIN_MISO);
  pinMode(PIN_MISO, INPUT_PULLDOWN); delay(2); int pd = digitalRead(PIN_MISO);
  digitalWrite(PIN_CS, HIGH);
  Serial.printf("### DOUT(IO19) CS LOW: pullup->%d pulldown->%d  %s\n", pu, pd,
                pu != pd ? "(FLOATING: tidak ada yang men-drive)" : (pu ? "(nyangkut HIGH)" : "(nyangkut LOW)"));
  Serial.println("Selesai.");
}
void loop() {}
