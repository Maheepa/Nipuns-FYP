import { create } from 'zustand';
import { config, type LatLng, type RescueSettings } from '../config';
import { distanceM } from '../geo';
import type {
  ActiveAlert,
  AlertLevel,
  AlertSource,
  DroneState,
  LinkStatus,
  LogEvent,
  RescueStage,
  Sample,
  WatchPacket,
} from '../types';
import { loadJson, saveJson } from './persist';

const BASE_KEY = 'bs.baseStation';
const RESCUE_KEY = 'bs.rescue';
const TILES_KEY = 'bs.tiles';

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
  track: [],
  statusTexts: [],
});

interface LinkSlice {
  status: LinkStatus;
  /** null until the receiver prints READY|... */
  receiverReady: boolean | null;
  lastHbAt: number | null;
  error: string | null;
}

interface StatsSlice {
  data: number;
  alert: number;
  bad: number;
  lastPacketAt: number | null;
  lastPacketType: WatchPacket['type'] | null;
  lastRssi: number | null;
  lastSnr: number | null;
  /** Arrival times of the last few packets, for the packet-rate readout. */
  recentRx: number[];
}

interface WatchSlice {
  latest: WatchPacket | null;
  /** Last known GPS position (kept when the watch reports NA). */
  position: LatLng | null;
  /** true when the most recent packet had no fix — position is the last known one. */
  positionStale: boolean;
  lastFixAt: number | null;
  samples: Sample[];
}

interface SettingsSlice {
  simulate: boolean;
  dryRun: boolean;
  muted: boolean;
  baseStation: LatLng;
  rescue: RescueSettings;
  tileSource: 'online' | 'offline';
}

interface RescueSlice {
  stage: RescueStage;
  /** Victim position the drone was sent to. */
  target: LatLng | null;
  dispatchedAt: number | null;
  stageAt: number | null;
}

export interface DetectionStatus {
  level: 'none' | 'warning' | 'drowning';
  reasons: string[];
}

interface DroneLinkSlice {
  /** WebSocket to the Node bridge is open. */
  wsConnected: boolean;
  /** Bridge reports it has seen MAVLink from Mission Planner recently. */
  mavlinkSeen: boolean;
}

export interface AppState {
  link: LinkSlice;
  stats: StatsSlice;
  watch: WatchSlice;
  settings: SettingsSlice;
  droneLink: DroneLinkSlice;
  drone: DroneState;
  alert: ActiveAlert | null;
  detection: DetectionStatus;
  rescue: RescueSlice;
  events: LogEvent[];

  setLink: (patch: Partial<LinkSlice>) => void;
  ingestPacket: (p: WatchPacket, now?: number) => void;
  countBad: () => void;
  resetTelemetry: () => void;

  setDroneLink: (patch: Partial<DroneLinkSlice>) => void;
  /** Merge telemetry; a new position is appended to the GPS track. */
  updateDrone: (patch: Partial<Omit<DroneState, 'track' | 'statusTexts'>>, now?: number) => void;
  addStatusText: (severity: number, text: string, now?: number) => void;
  clearDroneTrack: () => void;
  resetDrone: () => void;
  setTileSource: (src: 'online' | 'offline') => void;

  /** Raise a new alert or escalate the active one. Returns true when something changed. */
  raiseAlert: (source: AlertSource, level: AlertLevel, reasons: Record<string, string>, now?: number) => boolean;
  acknowledgeAlert: () => void;
  clearAlert: () => void;
  setDetection: (d: DetectionStatus) => void;
  setRescue: (patch: Partial<RescueSlice>, now?: number) => void;
  logEvent: (e: Omit<LogEvent, 't'> & { t?: number }) => void;
  clearEvents: () => void;

  setSimulate: (on: boolean) => void;
  setDryRun: (on: boolean) => void;
  setMuted: (on: boolean) => void;
  setBaseStation: (pos: LatLng | null) => void;
  setRescueSettings: (patch: Partial<RescueSettings>) => void;
}

const emptyStats = (): StatsSlice => ({
  data: 0,
  alert: 0,
  bad: 0,
  lastPacketAt: null,
  lastPacketType: null,
  lastRssi: null,
  lastSnr: null,
  recentRx: [],
});

const emptyWatch = (): WatchSlice => ({
  latest: null,
  position: null,
  positionStale: false,
  lastFixAt: null,
  samples: [],
});

/** BPM is only meaningful when the hub reports both a rate and a confidence. */
export function validBpm(p: Pick<WatchPacket, 'bpm' | 'conf'>): number | null {
  return p.bpm != null && p.bpm > 0 && p.conf != null && p.conf > 0 ? p.bpm : null;
}

let alertSeq = 0;

export const useStore = create<AppState>()((set, get) => ({
  link: { status: 'disconnected', receiverReady: null, lastHbAt: null, error: null },
  stats: emptyStats(),
  watch: emptyWatch(),
  settings: {
    // ?sim=1 in the URL starts in simulation mode (handy for demos)
    simulate: typeof location !== 'undefined' && new URLSearchParams(location.search).get('sim') === '1',
    dryRun: true, // safety: always start in dry-run
    muted: false,
    baseStation: loadJson<LatLng>(BASE_KEY, config.baseStation),
    rescue: loadJson<RescueSettings>(RESCUE_KEY, config.rescue),
    tileSource: loadJson<{ src: 'online' | 'offline' }>(TILES_KEY, { src: config.map.tileSource }).src,
  },
  droneLink: { wsConnected: false, mavlinkSeen: false },
  drone: emptyDrone(),
  alert: null,
  detection: { level: 'none', reasons: [] },
  rescue: { stage: 'idle', target: null, dispatchedAt: null, stageAt: null },
  events: [],

  raiseAlert: (source, level, reasons, now = Date.now()) => {
    const cur = get().alert;
    const rank = (l: AlertLevel) => (l === 'drowning' ? 2 : 1);
    if (cur) {
      // Escalate (warning → drowning, or detection → button) but never downgrade.
      const escalate = rank(level) > rank(cur.level) || (source === 'button' && cur.source !== 'button');
      const newRule = Object.keys(reasons).some((k) => !(k in cur.reasons));
      const merged = { ...cur.reasons, ...reasons };
      if (!escalate && !newRule) {
        // Same rules still firing: refresh the text (live numbers) without counting it as a change.
        set({ alert: { ...cur, reasons: merged } });
        return false;
      }
      set({
        alert: {
          ...cur,
          source: source === 'button' ? 'button' : cur.source,
          level: rank(level) > rank(cur.level) ? level : cur.level,
          reasons: merged,
          // An escalation re-sounds the alarm even if the previous level was acknowledged.
          acknowledged: escalate ? false : cur.acknowledged,
        },
      });
      return true;
    }
    alertSeq += 1;
    set((s) => ({
      alert: { id: alertSeq, source, level, startedAt: now, reasons, acknowledged: false },
      rescue: s.rescue.stage === 'idle' ? { ...s.rescue, stage: 'alert', stageAt: now } : s.rescue,
    }));
    return true;
  },

  acknowledgeAlert: () => set((s) => (s.alert ? { alert: { ...s.alert, acknowledged: true } } : {})),

  clearAlert: () =>
    set((s) => ({
      alert: null,
      // Clearing an alert before a drone was sent ends the rescue; once dispatched, the
      // rescue status stays so the operator can still release the ring / RTL.
      rescue: s.rescue.stage === 'alert' ? { stage: 'idle', target: null, dispatchedAt: null, stageAt: null } : s.rescue,
    })),

  setDetection: (d) => set({ detection: d }),

  setRescue: (patch, now = Date.now()) =>
    set((s) => ({
      rescue: { ...s.rescue, ...patch, stageAt: patch.stage && patch.stage !== s.rescue.stage ? now : s.rescue.stageAt },
    })),

  logEvent: (e) => set((s) => ({ events: [...s.events, { ...e, t: e.t ?? Date.now() }].slice(-2000) })),
  clearEvents: () => set({ events: [] }),

  setDroneLink: (patch) => set((s) => ({ droneLink: { ...s.droneLink, ...patch } })),

  updateDrone: (patch, now = Date.now()) =>
    set((s) => {
      const drone = { ...s.drone, ...patch, lastMsgAt: now };
      const pos = patch.position;
      if (pos) {
        const last = s.drone.track[s.drone.track.length - 1];
        // Only extend the track when the drone has actually moved (avoids GPS jitter piling up).
        if (!last || distanceM({ lat: last[0], lng: last[1] }, pos) > 0.5) {
          drone.track = [...s.drone.track, [pos.lat, pos.lng] as [number, number]].slice(-config.map.trackMaxPoints);
        }
      }
      return { drone };
    }),

  addStatusText: (severity, text, now = Date.now()) =>
    set((s) => {
      const list = s.drone.statusTexts;
      const last = list[list.length - 1];
      // ArduCopter repeats PreArm messages every ~30 s; collapse identical consecutive ones.
      const statusTexts =
        last && last.text === text
          ? [...list.slice(0, -1), { ...last, t: now, count: last.count + 1 }]
          : [...list, { t: now, severity, text, count: 1 }].slice(-200);
      return { drone: { ...s.drone, statusTexts } };
    }),

  clearDroneTrack: () => set((s) => ({ drone: { ...s.drone, track: [] } })),
  resetDrone: () => set({ drone: emptyDrone() }),
  setTileSource: (src) =>
    set((s) => {
      saveJson(TILES_KEY, { src });
      return { settings: { ...s.settings, tileSource: src } };
    }),

  setLink: (patch) => set((s) => ({ link: { ...s.link, ...patch } })),

  ingestPacket: (p, now = Date.now()) =>
    set((s) => {
      const recentRx = [...s.stats.recentRx.filter((t) => now - t < 10_000), now];
      const stats: StatsSlice = {
        ...s.stats,
        data: s.stats.data + (p.type === 'DATA' ? 1 : 0),
        alert: s.stats.alert + (p.type === 'ALERT' ? 1 : 0),
        lastPacketAt: now,
        lastPacketType: p.type,
        lastRssi: p.rssi ?? s.stats.lastRssi,
        lastSnr: p.snr ?? s.stats.lastSnr,
        recentRx,
      };

      const hasFix = p.lat != null && p.lng != null;
      const sample: Sample = {
        t: now,
        type: p.type,
        ax: p.ax,
        ay: p.ay,
        az: p.az,
        gx: p.gx,
        gy: p.gy,
        gz: p.gz,
        bpm: validBpm(p),
        conf: p.conf,
        stat: p.stat,
      };
      const cutoff = now - config.charts.windowMs;
      const samples = [...s.watch.samples.filter((x) => x.t >= cutoff), sample];

      const watch: WatchSlice = {
        latest: p,
        position: hasFix ? { lat: p.lat!, lng: p.lng! } : s.watch.position,
        positionStale: !hasFix,
        lastFixAt: hasFix ? now : s.watch.lastFixAt,
        samples,
      };
      return { stats, watch };
    }),

  countBad: () => set((s) => ({ stats: { ...s.stats, bad: s.stats.bad + 1 } })),

  resetTelemetry: () => set({ stats: emptyStats(), watch: emptyWatch() }),

  // Leaving simulation always re-enables dry-run, so LIVE chosen for the simulated
  // drone can never carry over to the real one.
  setSimulate: (on) => set((s) => ({ settings: { ...s.settings, simulate: on, dryRun: on ? s.settings.dryRun : true } })),
  setDryRun: (on) => set((s) => ({ settings: { ...s.settings, dryRun: on } })),
  setMuted: (on) => set((s) => ({ settings: { ...s.settings, muted: on } })),
  setBaseStation: (pos) =>
    set((s) => {
      const baseStation = pos ?? config.baseStation;
      saveJson(BASE_KEY, baseStation);
      return { settings: { ...s.settings, baseStation } };
    }),
  setRescueSettings: (patch) =>
    set((s) => {
      const rescue = { ...s.settings.rescue, ...patch };
      saveJson(RESCUE_KEY, rescue);
      return { settings: { ...s.settings, rescue } };
    }),
}));
