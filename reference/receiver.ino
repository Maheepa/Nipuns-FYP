
#define APM_RX_PIN 16  // Connect to APM telemetry TX

HardwareSerial APMSerial(2);

unsigned long lastReport = 0;
unsigned long totalBytes = 0;
unsigned long mavlinkV1 = 0;
unsigned long mavlinkV2 = 0;

void setup() {
  Serial.begin(115200);

  APMSerial.begin(
    57600,
    SERIAL_8N1,
    APM_RX_PIN,
    -1
  );

  Serial.println();
  Serial.println("APM UART RECEIVE TEST");
  Serial.println("Waiting for APM data...");
}

void loop() {

  while (APMSerial.available()) {

    uint8_t incomingByte = APMSerial.read();

    totalBytes++;

    if (incomingByte == 0xFE) {
      mavlinkV1++;
    }

    if (incomingByte == 0xFD) {
      mavlinkV2++;
    }
  }

  if (millis() - lastReport >= 1000) {

    lastReport = millis();

    Serial.print("Total bytes: ");
    Serial.print(totalBytes);

    Serial.print(" | MAVLink V1 frames: ");
    Serial.print(mavlinkV1);

    Serial.print(" | MAVLink V2 frames: ");
    Serial.println(mavlinkV2);
  }
}
