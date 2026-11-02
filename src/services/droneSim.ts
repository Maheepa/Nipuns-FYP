// Simulated quadcopter for Simulate mode. It accepts the same DroneCommand objects as
// the real bridge and publishes telemetry into the store the way droneSocket does.
// It is a kinematic toy (constant speeds), not a flight model.

import { destination, distanceM, bearingDeg } from '../geo';
import { useStore } from '../store/useStore';
import type { DroneCommand, FlightMode } from './droneCommands';

const TICK_MS = 200;
const CLIMB_MS = 2.5; // m/s
const DESCEND_MS = 1.2;
const CRUISE_MS = 8;

interface Vehicle {
  timer: number | null;
  home: { lat: number; lng: number };
  pos: { lat: number; lng: number };
  alt: number;
  heading: number;
  armed: boolean;
  mode: FlightMode;
  target: { lat: number; lng: number; alt: number } | null;
  takeoffAlt: number | null;
  battery: number;
  speed: number;
}

const v: Vehicle = {
  timer: null,
  home: { lat: 0, lng: 0 },
  pos: { lat: 0, lng: 0 },
  alt: 0,
  heading: 0,
  armed: false,
  mode: 'STABILIZE',
  target: null,
  takeoffAlt: null,
  battery: 100,
  speed: 0,
};

const MODE_NUM: Record<FlightMode, number> = {
  STABILIZE: 0,
  ALT_HOLD: 2,
  AUTO: 3,
  GUIDED: 4,
  LOITER: 5,
  RTL: 6,
  LAND: 9,
};

function say(text: string, severity = 6) {
  useStore.getState().addStatusText(severity, `SIM: ${text}`);
}

function publish() {
  useStore.getState().updateDrone({
    sysid: 1,
    armed: v.armed,
    mode: v.mode,
    customMode: MODE_NUM[v.mode],
    gpsFix: 3,
    sats: 14,
    hdop: 1.4,
    position: { ...v.pos },
    relAltM: v.alt,
    headingDeg: v.heading,
    groundSpeed: v.speed,
    airSpeed: v.speed,
    climb: 0,
    batteryV: 10.8 + (v.battery / 100) * 1.8,
    batteryPct: Math.round(v.battery),
  });
}

/** Move horizontally toward `to`; returns remaining distance. */
function flyToward(to: { lat: number; lng: number }, dt: number): number {
  const d = distanceM(v.pos, to);
  if (d < 0.3) {
    v.speed = 0;
    return d;
  }
  const step = Math.min(d, CRUISE_MS * dt);
  v.heading = bearingDeg(v.pos, to);
  v.pos = destination(v.pos, v.heading, step);
  v.speed = step / dt;
  return d - step;
}

function step() {
  const dt = TICK_MS / 1000;
  v.speed = 0;
  if (v.armed) {
    v.battery = Math.max(0, v.battery - 0.01);
    if (v.mode === 'GUIDED') {
      if (v.takeoffAlt != null && v.alt < v.takeoffAlt) {
        v.alt = Math.min(v.takeoffAlt, v.alt + CLIMB_MS * dt);
      } else if (v.target && v.alt > 2) {
        if (Math.abs(v.alt - v.target.alt) > 0.2) v.alt += Math.sign(v.target.alt - v.alt) * Math.min(CLIMB_MS * dt, Math.abs(v.target.alt - v.alt));
        flyToward(v.target, dt);
      }
    } else if (v.mode === 'RTL') {
      if (v.alt < 15 && distanceM(v.pos, v.home) > 2) v.alt = Math.min(15, v.alt + CLIMB_MS * dt);
      else if (flyToward(v.home, dt) < 0.5) v.mode = 'LAND';
    }
    if (v.mode === 'LAND') {
      v.alt = Math.max(0, v.alt - DESCEND_MS * dt);
      if (v.alt === 0) {
        v.armed = false;
        v.takeoffAlt = null;
        v.target = null;
        say('Landed, disarmed');
      }
    }
  }
  publish();
}

export function startDroneSim(): void {
  if (v.timer != null) return;
  const base = useStore.getState().settings.baseStation;
  v.home = { ...base };
  // Park the drone a few metres from the base station, like a launch pad.
  v.pos = destination(base, 200, 15);
  v.alt = 0;
  v.heading = 300;
  v.armed = false;
  v.mode = 'STABILIZE';
  v.target = null;
  v.takeoffAlt = null;
  v.battery = 100;
  useStore.getState().resetDrone();
  useStore.getState().setDroneLink({ wsConnected: true, mavlinkSeen: true });
  say('Simulated vehicle ready (STABILIZE, disarmed)');
  v.timer = window.setInterval(step, TICK_MS);
}

export function stopDroneSim(): void {
  if (v.timer != null) window.clearInterval(v.timer);
  v.timer = null;
  useStore.getState().resetDrone();
  useStore.getState().setDroneLink({ wsConnected: false, mavlinkSeen: false });
}

/** Apply a command to the simulated vehicle. Returns an error string when ArduCopter would refuse it. */
export function simDroneCommand(c: DroneCommand): string | null {
  switch (c.type) {
    case 'setMode':
      v.mode = c.mode;
      if (c.mode !== 'GUIDED') v.target = null;
      say(`Mode ${c.mode}`);
      return null;
    case 'arm':
      if (v.armed) return null;
      if (!['GUIDED', 'STABILIZE', 'LOITER', 'ALT_HOLD'].includes(v.mode)) return `Arm: not in an armable mode (${v.mode})`;
      v.armed = true;
      say('Arming motors');
      return null;
    case 'disarm':
      if (v.alt > 0.5) return 'Disarm refused: vehicle is airborne';
      v.armed = false;
      say('Disarming motors');
      return null;
    case 'takeoff':
      if (!v.armed || v.mode !== 'GUIDED') return 'Takeoff needs GUIDED mode and armed motors';
      v.takeoffAlt = c.altM;
      return null;
    case 'goto':
      if (v.mode !== 'GUIDED') return 'Go-to ignored: vehicle is not in GUIDED';
      v.target = { lat: c.lat, lng: c.lng, alt: c.altM };
      v.takeoffAlt = null;
      return null;
    case 'servo':
      say(`Servo ch${c.channel} → ${c.pwm} µs`);
      return null;
    case 'rtl':
      v.mode = 'RTL';
      v.target = null;
      say('Mode RTL');
      return null;
  }
}
