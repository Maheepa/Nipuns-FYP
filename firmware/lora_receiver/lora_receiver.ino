// =====================================================================
//  Base-station LoRa receiver (ESP32 + Ra-02 SX1278, USB to the laptop)
//
//  Serial protocol (115200 baud, one line per message, read by the web app):
//    READY|LORA_OK            radio initialised (also re-printed after a successful retry)
//    READY|LORA_FAIL          radio not found — check wiring / 3.3 V supply
//    RX|<packet>|RSSI:<int>|SNR:<float>   one received LoRa packet
//    HB|<millis>              heartbeat every 5 s
//    # ...                    debug lines (ignored by the web app)
//  Nothing else is printed.
//
//  Radio settings must match the watch (reference/transmission-new.ino):
//  433 MHz and the sandeepmistry/LoRa library defaults for spreading factor,
//  bandwidth, coding rate and sync word — so none of them are changed here.
//
//  Library: "LoRa" by Sandeep Mistry (Arduino Library Manager).
// =====================================================================

#include <SPI.h>
#include <LoRa.h>

// ---------------- Pins: same defaults as the watch. CHECK THESE AGAINST YOUR WIRING. ----------------
#define LORA_NSS   5
#define LORA_RST   14
#define LORA_DIO0  26
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23

// ---------------- Settings ----------------
#define LORA_FREQ        433E6
#define SERIAL_BAUD      115200
#define HEARTBEAT_MS     5000UL
#define RETRY_MS         5000UL   // retry LoRa.begin() this often after a failure
#define MAX_PACKET_LEN   255      // SX1278 FIFO limit

bool loraOK = false;
unsigned long lastHeartbeat = 0;
unsigned long lastRetry = 0;
char packetBuf[MAX_PACKET_LEN + 1];

bool startRadio() {
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  return LoRa.begin(LORA_FREQ);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(100);  // let the USB-serial bridge settle after the auto-reset

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  loraOK = startRadio();
  Serial.println(loraOK ? "READY|LORA_OK" : "READY|LORA_FAIL");

  lastHeartbeat = millis();
  lastRetry = millis();
}

void loop() {
  unsigned long now = millis();

  // ---- heartbeat (unsigned subtraction is safe across millis() overflow)
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    Serial.print("HB|");
    Serial.println(now);
  }

  // ---- radio missing: keep retrying so a loose wire can be fixed without a reset
  if (!loraOK) {
    if (now - lastRetry >= RETRY_MS) {
      lastRetry = now;
      Serial.println("# retrying LoRa init");
      loraOK = startRadio();
      if (loraOK) Serial.println("READY|LORA_OK");
    }
    return;
  }

  // ---- receive
  int size = LoRa.parsePacket();
  if (size <= 0) return;

  int n = 0;
  while (LoRa.available()) {
    int c = LoRa.read();
    if (n >= MAX_PACKET_LEN) continue;  // drain anything beyond the buffer
    // One packet must stay on one serial line: replace line breaks, other
    // control characters and non-ASCII bytes (radio corruption) with '?'.
    // The web app's parser then rejects the corrupted packet and counts it as bad.
    packetBuf[n++] = (c >= 32 && c <= 126) ? (char)c : '?';
  }
  packetBuf[n] = '\0';

  Serial.print("RX|");
  Serial.print(packetBuf);
  Serial.print("|RSSI:");
  Serial.print(LoRa.packetRssi());
  Serial.print("|SNR:");
  Serial.println(LoRa.packetSnr(), 2);
}
