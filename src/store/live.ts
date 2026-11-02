// High-rate telemetry kept OUTSIDE React state. Packets and MAVLink messages are written
// here as they arrive; components read it during render, driven by the shared ticker
// (store/ticker.ts), so the UI refreshes at a fixed rate however fast data comes in.

import { config, type LatLng } from '../config';
import { distanceM } from '../geo';
import type { DroneState, Sample, StatusText, WatchPacket } from '../types';
import { RingBuffer } from './ringBuffer';

/** BPM is only meaningful when the hub reports both a rate and a confidence. */
export function validBpm(p: Pick<WatchPacket, 'bpm' | 'conf'>): number | null {
  return p.bpm != null && p.bpm > 0 && p.conf != null && p.conf > 0 ? p.bpm : null;
}

export const emptyDrone = (): DroneState => ({
  lastMsgAt: null,
  sysid: null,
  armed: false,
  mode: '—',
  customMode: null,
  gpsFix: 0,
  sats: null,
  hdop: null,
  position: null,
  relAltM: null,
  headingDeg: null,
  groundSpeed: null,
  airSpeed: null,
  climb: null,
  batteryV: null,
  batteryPct: null,
});

const emptyStats = () => ({
  data: 0,
  alert: 0,
  bad: 0,
  lastPacketAt: null as number | null,
  lastPacketType: null as WatchPacket['type'] | null,
  lastRssi: null as number | null,
  lastSnr: null as number | null,
});

const emptyWatch = () => ({
  latest: null as WatchPacket | null,
  /** Last known GPS position (kept when the watch reports NA). */
  position: null as LatLng | null,
  /** true when the most recent packet had no fix — position is the last known one. */
  positionStale: false,
  lastFixAt: null as number | null,
});

export const live = {
  /** Last ~4 min of samples (charts and detection use the last 60 s). */
  samples: new RingBuffer<Sample>(240),
  /** Packet arrival times for the packet-rate readout. */
  rx: new RingBuffer<number>(64),
  stats: emptyStats(),
  watch: emptyWatch(),
  drone: emptyDrone(),
  /** Drone GPS track as [lat, lng]. */
  track: new RingBuffer<[number, number]>(config.map.trackMaxPoints),
  statusTexts: new RingBuffer<StatusText>(200),
};

/** Samples from the last `ms` milliseconds (oldest first). */
export function recentSamples(ms = config.charts.windowMs, now = Date.now()): Sample[] {
  const all = live.samples.toArray();
  let i = all.length;
  while (i > 0 && all[i - 1].t >= now - ms) i--;
  return i === 0 ? all : all.slice(i);
}

export function packetRate(now = Date.now(), windowMs = 10_000): number {
  return live.rx.toArray().filter((t) => now - t < windowMs).length / (windowMs / 1000);
}

// ------------------------------------------------------------------ watch

export function ingestPacket(p: WatchPacket, now = Date.now()): void {
  const s = live.stats;
  if (p.type === 'DATA') s.data++;
  else s.alert++;
  s.lastPacketAt = now;
  s.lastPacketType = p.type;
  if (p.rssi != null) s.lastRssi = p.rssi;
  if (p.snr != null) s.lastSnr = p.snr;
  live.rx.push(now);

  const w = live.watch;
  const hasFix = p.lat != null && p.lng != null;
  w.latest = p;
  if (hasFix) {
    w.position = { lat: p.lat!, lng: p.lng! };
    w.lastFixAt = now;
  }
  w.positionStale = !hasFix;

  live.samples.push({
    t: now,
    type: p.type,
    ax: p.ax,
    ay: p.ay,
    az: p.az,
    gx: p.gx,
    gy: p.gy,
    gz: p.gz,
    amax: p.amax,
    astd: p.astd,
    gmax: p.gmax,
    bpm: validBpm(p),
    conf: p.conf,
    stat: p.stat,
  });
}

export function countBad(): void {
  live.stats.bad++;
}

export function resetWatch(): void {
  live.samples.clear();
  live.rx.clear();
  live.stats = emptyStats();
  live.watch = emptyWatch();
}

// ------------------------------------------------------------------ drone

type DroneListener = (cur: DroneState, prev: DroneState) => void;
const droneListeners = new Set<DroneListener>();

/** Called after every drone telemetry update (used by the rescue tracker). */
export function onDroneUpdate(fn: DroneListener): () => void {
  droneListeners.add(fn);
  return () => droneListeners.delete(fn);
}

/** Merge telemetry; a new position extends the GPS track when the drone has really moved. */
export function updateDrone(patch: Partial<DroneState>, now = Date.now()): void {
  const prev = live.drone;
  live.drone = { ...prev, ...patch, lastMsgAt: now };
  const pos = patch.position;
  if (pos) {
    const last = live.track.last();
    // Avoid piling up GPS jitter while hovering or parked.
    if (!last || distanceM({ lat: last[0], lng: last[1] }, pos) > 0.5) live.track.push([pos.lat, pos.lng]);
  }
  droneListeners.forEach((fn) => fn(live.drone, prev));
}

export function addStatusText(severity: number, text: string, now = Date.now()): void {
  const last = live.statusTexts.last();
  // ArduCopter repeats PreArm messages every ~30 s; collapse identical consecutive ones.
  if (last && last.text === text) {
    last.t = now;
    last.count++;
    live.statusTexts.version++;
  } else {
    live.statusTexts.push({ t: now, severity, text, count: 1 });
  }
}

export function resetDrone(): void {
  live.drone = emptyDrone();
  live.track.clear();
  live.statusTexts.clear();
}
