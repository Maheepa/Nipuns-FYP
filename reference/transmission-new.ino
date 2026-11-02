#include <Wire.h>
#include <SparkFun_Bio_Sensor_Hub_Library.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <TinyGPS++.h>
#include <SPI.h>
#include <LoRa.h>

// ================= SETTINGS =================
#define LORA_TX_POWER   5      // dBm (2-17). Raise only if the heart sensor stays alive
#define LORA_FREQ       433E6

// ================= HARDWARE PINS =================
#define SDA_PIN       21
#define SCL_PIN       22

#define HR_RESET_PIN  32
#define HR_MFIO_PIN   33

#define BUTTON_PIN    4

#define LORA_NSS      5
#define LORA_RST      14
#define LORA_DIO0     26
#define LORA_MOSI     23
#define LORA_MISO     19
#define LORA_SCK      18

#define GPS_RX_PIN    16
#define GPS_TX_PIN    17
#define GPS_BAUD      9600

// ================= SENSOR OBJECTS =================
SparkFun_Bio_Sensor_Hub bioHub(HR_RESET_PIN, HR_MFIO_PIN);
bioData body;

Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// ================= STATE =================
bool mpuOK  = false;
bool loraOK = false;

float ax = 0, ay = 0, az = 0;
float gx = 0, gy = 0, gz = 0;

// ================= TIMING =================
const unsigned long BIO_INTERVAL    = 250;     // read hub every 250 ms
const unsigned long SEND_INTERVAL   = 1000;    // send/print every 1 s
const unsigned long BIO_CLEAR_AFTER = 3000;    // clear BPM values after 3 s of no data
const unsigned long BIO_DEAD_AFTER  = 10000;   // no finger/status for 10 s -> try hub reset
const unsigned long RECOVERY_GAP    = 30000;   // at most one hub reset per 30 s
const unsigned long BUTTON_COOLDOWN = 1000;

unsigned long lastBioRead   = 0;
unsigned long lastBioActive = 0;
unsigned long lastSend      = 0;
unsigned long lastAlert     = 0;
unsigned long lastRecovery  = 0;

// ================= FUNCTION DECLARATIONS =================
bool initBioHub(unsigned long warmupMs);
void readBioHub();
void updateMPU();
void sendLoRaPacket(const char* packetHeader);
void printLocalSerialData();

// =====================================================
void setup() {
  // Brownout protection stays ON so a real power problem is visible

  Serial.begin(115200);
  while (!Serial && millis() < 3000);
  Serial.println("\n--- INITIALIZING ESP32 TRANSMITTER ---");

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Bio hub first, before anything else
  bool bioOK = initBioHub(4000);
  Serial.println(bioOK ? "✅ Bio Hub ready" : "❌ Bio Hub failed");

  // MPU6050
  if (!mpu.begin()) {
    Serial.println("❌ MPU6050 not found on I2C!");
  } else {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    mpuOK = true;
    Serial.println("✅ MPU6050 initialized!");
  }
  Wire.setClock(100000);   // make sure MPU init didn't change the speed

  // LoRa
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("❌ LoRa initialization failed!");
  } else {
    LoRa.setTxPower(LORA_TX_POWER);
    loraOK = true;
    Serial.println("✅ LoRa Transmitter initialized!");
  }

  lastBioActive = millis();
  lastRecovery  = millis();
  Serial.println("\n--- TRANSMITTER READY ---\n");
}

// =====================================================
void loop() {
  // GPS decoding
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Heart rate hub
  if (millis() - lastBioRead >= BIO_INTERVAL) {
    lastBioRead = millis();
    readBioHub();
  }

  // Recovery: hub reported nothing for a while -> reset it (rate limited)
  if (millis() - lastBioActive > BIO_DEAD_AFTER &&
      millis() - lastRecovery  > RECOVERY_GAP) {
    lastRecovery = millis();
    Serial.println("♻️ Hub silent, re-initialising...");
    initBioHub(1500);
    lastBioActive = millis();
  }

  // Emergency button
  if (digitalRead(BUTTON_PIN) == LOW && millis() - lastAlert >= BUTTON_COOLDOWN) {
    lastAlert = millis();
    Serial.println("\n🚨 EMERGENCY BUTTON PRESSED! 🚨");
    updateMPU();
    sendLoRaPacket("ALERT");
    printLocalSerialData();
  }

  // Regular transmission
  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();
    updateMPU();
    sendLoRaPacket("DATA");
    printLocalSerialData();
  }
}

// =====================================================
bool initBioHub(unsigned long warmupMs) {
  Wire.setClock(100000);

  int r = bioHub.begin();
  if (r != 0) {
    Serial.print("❌ Bio hub begin error: ");
    Serial.println(r);
    return false;
  }

  int c = bioHub.configBpm(MODE_ONE);
  if (c != 0) {
    Serial.print("⚠️ Bio hub config error: ");
    Serial.println(c);
    return false;
  }

  delay(warmupMs);
  return true;
}

void readBioHub() {
  bioData tmp = bioHub.readBpm();

  // Empty FIFO reads come back as zeros; only accept real data
  bool hasData = (tmp.heartRate != 0 || tmp.oxygen != 0 ||
                  tmp.confidence != 0 || tmp.status != 0);

  if (hasData) {
    body = tmp;
    if (tmp.status != 0) lastBioActive = millis();
  } else if (millis() - lastBioActive > BIO_CLEAR_AFTER) {
    body = tmp;   // clear stale values
  }
}

void updateMPU() {
  if (!mpuOK) return;
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  ax = a.acceleration.x;
  ay = a.acceleration.y;
  az = a.acceleration.z;
  gx = g.gyro.x * 57.2958;
  gy = g.gyro.y * 57.2958;
  gz = g.gyro.z * 57.2958;
}

void sendLoRaPacket(const char* packetHeader) {
  if (!loraOK) return;

  LoRa.beginPacket();
  LoRa.print(packetHeader);

  LoRa.print("|BPM:");   LoRa.print(body.heartRate);
  LoRa.print("|SPO2:");  LoRa.print(body.oxygen);
  LoRa.print("|CONF:");  LoRa.print(body.confidence);

  LoRa.print("|AX:");    LoRa.print(ax, 2);
  LoRa.print("|AY:");    LoRa.print(ay, 2);
  LoRa.print("|AZ:");    LoRa.print(az, 2);

  LoRa.print("|GX:");    LoRa.print(gx, 2);
  LoRa.print("|GY:");    LoRa.print(gy, 2);
  LoRa.print("|GZ:");    LoRa.print(gz, 2);

  LoRa.print("|LAT:");
  if (gps.location.isValid()) LoRa.print(gps.location.lat(), 6);
  else                        LoRa.print("NA");

  LoRa.print("|LNG:");
  if (gps.location.isValid()) LoRa.print(gps.location.lng(), 6);
  else                        LoRa.print("NA");

  // Added at the END so existing receiver parsing is unaffected
  LoRa.print("|STAT:");  LoRa.print(body.status);

  LoRa.endPacket();
}

void printLocalSerialData() {
  Serial.print("📡 Sent -> BPM: ");
  Serial.print(body.heartRate);
  Serial.print(" | SpO2: ");
  Serial.print(body.oxygen);
  Serial.print("% | Conf: ");
  Serial.print(body.confidence);
  Serial.print("% | Status: ");
  Serial.print(body.status);

  Serial.print(" || Accel: ");
  Serial.print(ax, 1); Serial.print(",");
  Serial.print(ay, 1); Serial.print(",");
  Serial.print(az, 1);

  Serial.print(" || Gyro: ");
  Serial.print(gx, 1); Serial.print(",");
  Serial.print(gy, 1); Serial.print(",");
  Serial.print(gz, 1);

  Serial.print(" || GPS: ");
  if (gps.location.isValid()) {
    Serial.print(gps.location.lat(), 6);
    Serial.print(",");
    Serial.print(gps.location.lng(), 6);
  } else {
    Serial.print("Searching...");
  }
  Serial.println();
}
