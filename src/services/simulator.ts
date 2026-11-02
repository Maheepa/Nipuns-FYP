// Simulation mode: produces receiver lines exactly as firmware/lora_receiver
// prints them, at 1 Hz, and pushes them through handleSerialLine().

import { useStore } from '../store/useStore';
import { handleSerialLine } from './telemetry';

export type SimScenario = 'swimming' | 'struggling' | 'motionless' | 'no-gps' | 'no-finger';

export const SIM_SCENARIOS: { id: SimScenario; label: string }[] = [
  { id: 'swimming', label: 'Normal swimming' },
  { id: 'struggling', label: 'Struggling (panic)' },
  { id: 'motionless', label: 'Motionless / sinking' },
  { id: 'no-gps', label: 'No GPS fix' },
  { id: 'no-finger', label: 'Sensor off wrist' },
];

const M_PER_DEG_LAT = 111_320;

interface SimState {
  timer: number | null;
  scenario: SimScenario;
  t0: number;
  lat: number;
  lng: number;
  heading: number;
  bpm: number;
  bootMs: number;
  lastHb: number;
  /** Extra lines to emit (e.g. a bad packet) — lets the bad counter be exercised. */
  injectGarbageEvery: number;
  tick: number;
}

const sim: SimState = {
  timer: null,
  scenario: 'swimming',
  t0: 0,
  lat: 0,
  lng: 0,
  heading: 0,
  bpm: 82,
  bootMs: 0,
  lastHb: 0,
  injectGarbageEvery: 45,
  tick: 0,
};

const listeners = new Set<() => void>();
export function onSimChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const gauss = () => {
  // Box–Muller, good enough for sensor noise
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function r2(v: number) {
  return v.toFixed(2);
}

export function generatePacket(type: 'DATA' | 'ALERT'): string {
  const sc = sim.scenario;

  // ---- heart rate drifts toward a scenario target
  const target = sc === 'struggling' ? 138 : sc === 'motionless' ? 44 : 84;
  sim.bpm += (target - sim.bpm) * 0.12 + gauss() * 1.5;
  const fingerOn = sc !== 'no-finger';
  const bpm = fingerOn ? Math.max(0, Math.round(sim.bpm)) : 0;
  const conf = fingerOn ? Math.round(rand(88, 99)) : 0;
  const stat = fingerOn ? 3 : 0;
  // The MAX32664 in MODE_ONE was observed reporting SpO2 0 on the real watch (slide 26).
  const spo2 = 0;

  // ---- IMU (m/s², °/s); gravity mostly on Z for a wrist floating face-up
  let ax: number, ay: number, az: number, gx: number, gy: number, gz: number;
  if (sc === 'struggling') {
    const spike = Math.random() < 0.35 ? rand(12, 30) : 0;
    ax = gauss() * 8 + (Math.random() < 0.5 ? spike : -spike);
    ay = gauss() * 8;
    az = 9.81 + gauss() * 9;
    gx = gauss() * 260;
    gy = gauss() * 260;
    gz = gauss() * 200;
  } else if (sc === 'motionless') {
    ax = 0.3 + gauss() * 0.05;
    ay = -1.2 + gauss() * 0.05;
    az = 9.7 + gauss() * 0.05;
    gx = gauss() * 0.6;
    gy = gauss() * 0.6;
    gz = gauss() * 0.6;
  } else {
    // swimming stroke: periodic arm motion
    const ph = (Date.now() - sim.t0) / 1000;
    ax = 4 * Math.sin(ph * 1.7) + gauss() * 1.2;
    ay = -1.5 + 2.5 * Math.cos(ph * 1.7) + gauss() * 1.0;
    az = 9.5 + gauss() * 1.5;
    gx = 60 * Math.sin(ph * 1.7 + 1) + gauss() * 10;
    gy = 40 * Math.cos(ph * 1.7) + gauss() * 10;
    gz = gauss() * 15;
  }

  // ---- position: slow random walk, kept within ~120 m of the base station
  const base = useStore.getState().settings.baseStation;
  const speed = sc === 'swimming' ? 0.6 : sc === 'struggling' ? 0.15 : 0.05; // m/s
  sim.heading += gauss() * 0.4;
  const dn = Math.cos(sim.heading) * speed;
  const de = Math.sin(sim.heading) * speed;
  sim.lat += dn / M_PER_DEG_LAT;
  sim.lng += de / (M_PER_DEG_LAT * Math.cos((sim.lat * Math.PI) / 180));
  const dN = (sim.lat - base.lat) * M_PER_DEG_LAT;
  const dE = (sim.lng - base.lng) * M_PER_DEG_LAT * Math.cos((base.lat * Math.PI) / 180);
  if (Math.hypot(dN, dE) > 120) sim.heading = Math.atan2(-dE, -dN); // turn back toward base

  const gps = sc === 'no-gps' ? 'LAT:NA|LNG:NA' : `LAT:${sim.lat.toFixed(6)}|LNG:${sim.lng.toFixed(6)}`;

  return (
    `${type}|BPM:${bpm}|SPO2:${spo2}|CONF:${conf}` +
    `|AX:${r2(ax)}|AY:${r2(ay)}|AZ:${r2(az)}|GX:${r2(gx)}|GY:${r2(gy)}|GZ:${r2(gz)}` +
    `|${gps}|STAT:${stat}`
  );
}

function rxLine(packet: string): string {
  const rssi = Math.round(rand(-95, -60));
  const snr = rand(-2, 10).toFixed(2);
  return `RX|${packet}|RSSI:${rssi}|SNR:${snr}`;
}

function step() {
  sim.tick++;
  const now = Date.now();
  if (now - sim.lastHb >= 5000) {
    sim.lastHb = now;
    handleSerialLine(`HB|${now - sim.bootMs}`);
  }
  handleSerialLine(rxLine(generatePacket('DATA')));
  if (sim.injectGarbageEvery > 0 && sim.tick % sim.injectGarbageEvery === 0) {
    handleSerialLine('RX|DA¿A|BPM:7\u0003|RSSI:-118|SNR:-14.25'); // corrupted packet
  }
}

export function startSimulator(): void {
  if (sim.timer != null) return;
  const base = useStore.getState().settings.baseStation;
  // Start the swimmer ~70 m from the base station.
  const ang = rand(0, Math.PI * 2);
  sim.lat = base.lat + (70 * Math.cos(ang)) / M_PER_DEG_LAT;
  sim.lng = base.lng + (70 * Math.sin(ang)) / (M_PER_DEG_LAT * Math.cos((base.lat * Math.PI) / 180));
  sim.heading = rand(0, Math.PI * 2);
  sim.t0 = sim.bootMs = Date.now();
  sim.lastHb = 0;
  sim.tick = 0;
  sim.bpm = 82;
  // ?scenario=struggling etc. picks the starting scenario (demos / testing)
  const fromUrl = new URLSearchParams(location.search).get('scenario');
  if (fromUrl && SIM_SCENARIOS.some((s) => s.id === fromUrl)) sim.scenario = fromUrl as SimScenario;
  handleSerialLine('# simulator started');
  handleSerialLine('READY|LORA_OK');
  sim.timer = window.setInterval(step, 1000);
  notify();
}

export function stopSimulator(): void {
  if (sim.timer != null) window.clearInterval(sim.timer);
  sim.timer = null;
  notify();
}

export function isSimRunning(): boolean {
  return sim.timer != null;
}

/** Emergency button press: one immediate ALERT packet. */
export function simFireAlert(): void {
  if (sim.timer == null) return;
  handleSerialLine(rxLine(generatePacket('ALERT')));
}

export function setSimScenario(s: SimScenario): void {
  sim.scenario = s;
  notify();
}

export function getSimScenario(): SimScenario {
  return sim.scenario;
}
