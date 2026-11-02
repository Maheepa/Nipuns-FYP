# Beach Safety — Drowning Detection & Drone Rescue (base station)

Base-station web app for the final-year project *"Design and Development of a Wearable AI System for Drowning Detection with Autonomous Drone Rescue for Beach Safety"* (MC 11).

It receives the watch telemetry over LoRa, shows the swimmer and the drone on a satellite map, raises drowning alerts (emergency button or automatic detection) and sends the rescue drone to the victim through Mission Planner.

```
Watch ESP32 ──LoRa 433 MHz──► Receiver ESP32 ──USB serial──► Browser (Web Serial API)
                                                               ▲
APM drone ──USB COM15──► Mission Planner ──MAVLink UDP──► Node bridge ──WebSocket──┘
```

> **Safety first.** Drone commands start in **dry-run** (logged, never sent). Read the
> [safety checklist](#safety-checklist) before switching to LIVE, and bench-test every
> command with the **propellers removed**.

---

## Contents

1. [Quick start](#quick-start)
2. [Receiver hardware and wiring](#receiver-hardware-and-wiring)
3. [Flashing the receiver](#flashing-the-receiver)
4. [Connecting the receiver (Chrome / Edge)](#connecting-the-receiver-chrome--edge)
5. [Mission Planner MAVLink mirror and the bridge](#mission-planner-mavlink-mirror-and-the-bridge)
6. [Using the app](#using-the-app)
7. [Automatic detection and the Random Forest model](#automatic-detection-and-the-random-forest-model)
8. [Offline map tiles](#offline-map-tiles)
9. [Configuration and assumed values](#configuration-and-assumed-values)
10. [Safety checklist](#safety-checklist)
11. [Tests](#tests)
12. [Project structure](#project-structure)
13. [Known limitations](#known-limitations)

---

## Quick start

Requirements: **Node.js 18+** (tested with 22), **Google Chrome or Microsoft Edge**.

```bash
npm install
npm run dev          # starts the web app (Vite) and the drone bridge together
```

Open **http://localhost:5173** in Chrome or Edge.

- No hardware? Press **Simulate** in the header, or open http://localhost:5173/?sim=1.
  The simulator sends fake watch packets through the real parser and runs a simulated drone.
  Pick a scenario next to the map (normal swimming, struggling, motionless, no GPS, sensor off wrist)
  or press **Fire ALERT** to send an emergency-button packet. `?sim=1&scenario=struggling` starts in a scenario.
- `npm run dev:web` starts only the web app; `npm run bridge` starts only the bridge.

## Receiver hardware and wiring

The base-station receiver is an ESP32 dev board with a Ra-02 (SX1278, 433 MHz) module, plugged into the laptop by USB. The pins are the same as on the watch (`reference/transmission-new.ino` and the PCB schematic on proposal slide 22):

| Ra-02 pin | ESP32 pin | Note |
|---|---|---|
| 3.3V | 3V3 | **3.3 V only** — 5 V destroys the module |
| GND | GND | |
| NSS | GPIO 5 | `LORA_NSS` |
| RESET | GPIO 14 | `LORA_RST` |
| DIO0 | GPIO 26 | `LORA_DIO0` (packet-received interrupt) |
| SCK | GPIO 18 | `LORA_SCK` |
| MISO | GPIO 19 | `LORA_MISO` |
| MOSI | GPIO 23 | `LORA_MOSI` |

Always connect the 433 MHz antenna before powering the module. If your receiver is wired differently, change the `#define`s at the top of `firmware/lora_receiver/lora_receiver.ino`.

## Flashing the receiver

`reference/receiver.ino` is the old **APM UART test** (it counts MAVLink bytes) and is **not** a LoRa receiver. Flash the new sketch instead:

1. Arduino IDE → *Boards Manager* → install **esp32 by Espressif Systems**.
2. *Library Manager* → install **LoRa by Sandeep Mistry** (the same library the watch uses).
3. Open `firmware/lora_receiver/lora_receiver.ino`, select your ESP32 board (e.g. *ESP32 Dev Module*) and its COM port, and upload.
4. Open the Serial Monitor at **115200** baud. You should see:
   ```
   READY|LORA_OK
   HB|5000
   RX|DATA|BPM:72|SPO2:0|CONF:95|AX:0.12|...|LAT:6.812298|LNG:79.890736|STAT:3|RSSI:-57|SNR:9.25
   ```
   `READY|LORA_FAIL` means the radio was not found (check wiring and 3.3 V). The sketch retries every 5 s.
5. **Close the Serial Monitor** before connecting the web app: only one program can open the port.

The radio settings match the watch: 433 MHz and the library defaults for spreading factor, bandwidth, coding rate and sync word (the watch changes none of them).

### Serial protocol (receiver → web app)

| Line | Meaning |
|---|---|
| `READY\|LORA_OK` / `READY\|LORA_FAIL` | radio status at boot (and after a successful retry) |
| `RX\|<packet>\|RSSI:<int>\|SNR:<float>` | one LoRa packet, exactly as the watch sent it |
| `HB\|<millis>` | heartbeat every 5 s |
| `# ...` | debug text, ignored by the app |

Watch packets (`DATA|...` every second, `ALERT|...` on the emergency button) are parsed **by key**, so new fields or a different order do not break anything. `LAT:NA` / `LNG:NA` means no GPS fix: the app keeps the last known position and marks it stale. `BPM:0` or `CONF:0` means no valid heart-rate reading. Malformed lines are counted as *bad packets*.

## Connecting the receiver (Chrome / Edge)

The app reads the receiver with the **Web Serial API**, which only exists in **Chrome and Edge** and only on a secure origin — `http://localhost` counts, a LAN IP address does not. Firefox and Safari show a warning banner (simulation still works there).

1. Plug in the receiver ESP32.
2. Click **Connect** (top-right) and choose the receiver's port (*USB-SERIAL CH340*, *CP210x*, …).
3. The status next to the button shows *Connected · receiver ready*, the packet rate, last RSSI/SNR and the time since the last packet.
4. **Disconnect** releases the port cleanly, so it can be reconnected straight away. Unplugging the USB cable is detected and shown as an error.

The ESP32 reboots when the port is opened (DTR/RTS auto-reset); that is expected and prints `READY|...` again.

## Mission Planner MAVLink mirror and the bridge

Mission Planner already owns COM15, so the browser cannot open it too. Instead Mission Planner **mirrors** the MAVLink stream to the Node bridge over UDP, and the bridge talks to the web app over a WebSocket (`ws://localhost:8787`).

### Set up the mirror in Mission Planner

1. Connect Mission Planner to the drone as usual (COM15, 115200).
2. Press **Ctrl+F** to open the hidden *temp* window and click **Mavlink** (MAVLink Mirror).
3. Choose **UDP Client**, tick **Write access** (needed to send commands back) and press **Connect**.
4. Enter host **127.0.0.1** and port **14550**.

The header chip turns to *Drone: connected* once MAVLink arrives; the HUD on the map shows ARMED/DISARMED, mode, GPS fix/satellites, altitude, ground speed, battery and the latest STATUSTEXT (e.g. *PreArm: Bad Velocity*).

The mirror dialog differs between Mission Planner builds. If your build only offers **UDP Host** (Mission Planner listens on 14550), start the bridge in client mode instead:

```bash
# PowerShell
$env:BRIDGE_MAV_REMOTE="127.0.0.1:14550"; npm run bridge
```

### Bridge options (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `BRIDGE_UDP_PORT` | `14550` | UDP port the bridge listens on |
| `BRIDGE_UDP_HOST` | `127.0.0.1` | interface to bind (keep localhost unless Mission Planner runs on another PC) |
| `BRIDGE_MAV_REMOTE` | — | `host:port` of a mirror in *UDP Host* mode |
| `BRIDGE_WS_PORT` | `8787` | WebSocket port for the web app |
| `BRIDGE_FORCE_DRY_RUN` | — | `1` = never transmit any command, whatever the UI says |
| `BRIDGE_SYSID` | `254` | MAVLink system id used for commands (Mission Planner is 255) |

The WebSocket only accepts connections from `localhost` pages, so no other website can send drone commands.

### Test the bridge without a drone

```bash
npm run bridge          # terminal 1
npm run fake-vehicle    # terminal 2: pretends to be Mission Planner + APM
npm run bridge:smoke    # terminal 3: sends a dry-run, a refused and a live command
```

### Commands sent (ArduCopter 3.2.1, MAVLink v1)

| Action | Message |
|---|---|
| GUIDED / RTL mode | `SET_MODE` (custom mode 4 = GUIDED) |
| Fly to victim | `MISSION_ITEM` with `current = 2`, frame `GLOBAL_RELATIVE_ALT`, `NAV_WAYPOINT` |
| Arm / disarm | `COMMAND_LONG` `MAV_CMD_COMPONENT_ARM_DISARM` (400) |
| Take off | `COMMAND_LONG` `MAV_CMD_NAV_TAKEOFF` (22), param 7 = altitude |
| Return to launch | `COMMAND_LONG` `MAV_CMD_NAV_RETURN_TO_LAUNCH` (20) |
| Release life ring | `COMMAND_LONG` `MAV_CMD_DO_SET_SERVO` (183), channel + PWM from Settings |

`COMMAND_ACK` and `MISSION_ACK` replies from the drone are shown as toasts and written to the event log.

## Using the app

**Layout.** Header with status chips and Connect (top). Satellite map (top half) with the base station locked at the exact centre. Bottom-left is a reserved, empty panel (`<ReservedPanel />`); bottom-right shows the MPU-6050 accelerometer/gyroscope charts and the MAX32664 heart-rate panel (last 60 s).

**Map.** The base station never moves from the centre; the zoom adjusts automatically so the swimmer and the drone stay visible (**AUTO**). **+ / −** zoom manually around the centre, but never so close that a marker leaves the view. Right-click → *Set base station here* (saved in this browser). Lines: black drone GPS track, red drone heading, dashed base→marker lines with distances, dashed orange drone→victim line during a rescue. The bar under the map shows the cursor position (`GEO lat lng`) like Mission Planner.

**Alerts.**
- *Type 1 — emergency button:* an `ALERT` packet immediately shows the red banner, sounds the alarm and makes the swimmer marker pulse.
- *Type 2 — automatic detection:* threshold rules raise *Possible drowning* (one rule) or *Drowning detected* (two or more rules).
- **Acknowledge** silences the alarm; **Clear alert** closes it (automatic detection cannot re-raise it for 30 s; the emergency button always can). **🔊 Sound** mutes the alarm entirely. The browser only plays sound after the first click on the page.

**Rescue flow** (buttons appear in the banner as the rescue progresses):

`Alert → Drone dispatched → En route (distance) → On target (≤ radius) → Life ring delivered → Returning`

1. Arm and take off with **Drone controls** on the map (each needs confirmation; arming also needs a checklist). The app **never arms automatically**.
2. **Dispatch drone to victim** → confirmation with coordinates and distances → `SET_MODE GUIDED` + GUIDED go-to.
3. If the swimmer drifts, **Update target** re-sends the go-to.
4. **Release life ring** (DO_SET_SERVO) → **Return to launch**. When the drone lands and disarms the rescue closes automatically, or press **Finish rescue**.

**Dry-run / LIVE.** The **DRY-RUN ON** button in the header is on at every start. In dry-run each command is still validated and encoded by the bridge (the hex frame goes into the log) but nothing is sent. Switching to **LIVE** needs a confirmation with a checklist. Turning *Simulate* off always switches dry-run back on.

**Settings (⚙ in Drone controls).** Rescue altitude, max distance from the base station, on-target radius, release servo channel and PWM values. Saved in this browser; defaults come from `src/config.ts`.

**Event log.** **Log** in the header lists alerts, detections, commands, dry-runs, link changes and settings changes with time, location and vitals. **Export CSV** saves it for the report.

## Automatic detection and the Random Forest model

`src/services/detection.ts` defines a pluggable interface:

```ts
export interface Detector {
  readonly name: string;
  evaluate(sample: Sample, history: Sample[]): DetectionResult; // called once per packet, history = last 60 s
  reset(): void;
}
```

The default `ThresholdDetector` rules (thresholds in `config.detection`):

| Rule | Default |
|---|---|
| Heart rate out of range for N s (only with CONF ≥ 50 and finger detected) | < 50 or > 120 BPM for 10 s |
| Violent movement, then almost none | \|a\| more than 25 m/s² away from 1 g, then acceleration-vector spread < 0.5 m/s² for 5 s |
| Erratic rotation | \|ω\| > 250 °/s in 3 of the last 5 samples |

To use your Random Forest, implement `Detector` (e.g. call a model exported to JavaScript/ONNX, or a small local Python service) and register it once at start-up:

```ts
import { setDetector } from './services/detection';
setDetector(new RandomForestDetector(/* ... */));
```

Alerts, the banner and the log work unchanged.

## Offline map tiles

The beach may have no internet, so the map can load tiles from `public/tiles/{z}/{x}/{y}.jpg`.

```bash
npm run tiles                                   # shows how many tiles would be downloaded
npm run tiles -- --yes                          # 800 m around the base station, zoom 15–19 (~660 tiles)
npm run tiles -- --yes --lat 6.81 --lng 79.89 --radius 1000 --minz 15 --maxz 19
```

Then tick **Offline tiles** under the map (or set `map.tileSource: 'offline'` in `src/config.ts`). Do it at home, before the field test, and check the map once with Wi-Fi off. Place-name labels are online-only.

> **Terms of use:** the script fetches Esri World Imagery. Esri restricts bulk and offline use of its basemap tiles — check that a small cached area for a university project is allowed for your account before running it. Google tile URLs are deliberately not used (that would break Google's terms).

## Configuration and assumed values

Everything lives in `src/config.ts`. Values marked **ASSUMED** are not known from the hardware — check them on the bench:

| Setting | Default | Status |
|---|---|---|
| Base station | 6.8122982, 79.8907368 | from the Mission Planner screenshot |
| Receiver pins | NSS 5, RST 14, DIO0 26, SCK 18, MISO 19, MOSI 23 | same as the watch — verify your wiring |
| Rescue altitude | 10 m | ASSUMED |
| Max distance from base | 300 m (LoRa range test reached 150 m) | ASSUMED |
| On-target radius | 5 m | ASSUMED |
| Release servo | channel 9, release 1900 µs, hold 1100 µs | ASSUMED — depends on your APM output wiring |
| Detection thresholds | see above | ASSUMED, literature-based starting point |
| Bridge limits | altitude 2–40 m, ≤ 1000 m from home, PWM 800–2200 | hard limits in `bridge/commands.js` |

## Safety checklist

Before any test with the real drone:

- [ ] **Bench-test every command with the propellers removed**: GUIDED, ARM, TAKEOFF, go-to, RELEASE/HOLD, RTL, DISARM. Check each reaches the drone (Mission Planner *Messages* tab, `COMMAND_ACK` in the event log).
- [ ] Run a full rescue in **Simulate** first, then in **dry-run** with the real drone connected, and read the event log.
- [ ] Verify the release servo channel and PWM direction with the ring attached, propellers off.
- [ ] Set the rescue altitude and the max distance for the test site; keep the max distance inside LoRa and RC range.
- [ ] Confirm RTL altitude, failsafes (RC, battery, GCS) and geofence in Mission Planner.
- [ ] GPS: 3D fix, HDOP < 2, and no *PreArm* messages in the HUD.
- [ ] A **safety pilot with an RC transmitter** is ready to switch to STABILIZE/LOITER and take over at any time.
- [ ] People are clear of the take-off area and the flight path; obey local drone regulations.
- [ ] Use LIVE mode only for the flight itself and switch dry-run back on afterwards.

## Tests

```bash
npm test           # Vitest: parser, detection, alerts, rescue flow, MAVLink codec, bridge commands
npm run build      # type-check and production build
```

The suites cover the packet parser (DATA, ALERT, `LAT:NA`, missing fields, extra fields, garbage lines, receiver lines), the serial line splitter, the simulator output, the detection rules, alert escalation, the CSV export, the full simulated rescue flow (including "dry-run never moves the drone" and "out-of-range target refused"), the MAVLink codec (CRC_EXTRA of every message is derived from its field list and checked against the published value) and the bridge command builder.

## Project structure

```
src/
  components/   Header, MapPanel, Hud, MpuPanel, HeartPanel, ReservedPanel, AlertBanner,
                RescueActions, DroneControls, SettingsDialog, ConfirmHost, EventLog, …
  services/     loraSerial.ts  packetParser.ts  telemetry.ts  simulator.ts  detection.ts
                alerts.ts  alarm.ts  droneSocket.ts  droneSim.ts  rescue.ts  eventLog.ts
  store/        useStore.ts (watch, drone, links, alerts, rescue, events)  useUi.ts
  config.ts
bridge/         server.js (UDP ↔ WebSocket)  mavlink.js (v1/v2 codec)  commands.js
                fake-vehicle.js  smoke-test.js
firmware/lora_receiver/lora_receiver.ino
reference/      transmission-new.ino (watch, source of truth for the packet)  receiver.ino (old APM test)
scripts/        download-tiles.js
```

## Known limitations

- **1 Hz IMU sampling.** The watch sends one accelerometer/gyro sample per second, so short spikes between samples are missed. Sending a per-second peak or variance from the watch would make motion detection much more reliable.
- **SpO₂** is shown as "—" when the hub reports 0, which the real watch did in every logged packet (proposal slide 26). It is not used for detection.
- **Go-to precision.** ArduCopter 3.2.1 takes the GUIDED target as `MISSION_ITEM`, whose coordinates are 32-bit floats: the position is rounded to about 1 m.
- **ArduCopter 3.2.1 behaviour** (GUIDED take-off, `MISSION_ITEM current=2`, servo numbering on the APM) follows the 3.2 documentation and must be confirmed on the bench.
- **Web Serial** works only in Chrome/Edge on `localhost`.
- The simulated drone is a simple kinematic model for testing the UI, not a flight simulator. For realistic tests use ArduPilot SITL with Mission Planner.
