import { create } from 'zustand';
import { config, type LatLng, type RescueSettings } from '../config';
import type {
  ActiveAlert,
  AlertLevel,
  AlertSource,
  LinkStatus,
  LogEvent,
  RescueStage,
} from '../types';
import { loadJson, saveJson } from './persist';

const BASE_KEY = 'bs.baseStation';
const RESCUE_KEY = 'bs.rescue';
const TILES_KEY = 'bs.tiles';
const MUTE_KEY = 'bs.muted';

interface LinkSlice {
  status: LinkStatus;
  /** null until the receiver prints READY|... */
  receiverReady: boolean | null;
  lastHbAt: number | null;
  /** When the serial port was opened (start of the receiver-silence timer). */
  connectedAt: number | null;
  error: string | null;
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
  settings: SettingsSlice;
  droneLink: DroneLinkSlice;
  alert: ActiveAlert | null;
  detection: DetectionStatus;
  rescue: RescueSlice;
  events: LogEvent[];

  setLink: (patch: Partial<LinkSlice>) => void;

  setDroneLink: (patch: Partial<DroneLinkSlice>) => void;
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

let alertSeq = 0;

export const useStore = create<AppState>()((set, get) => ({
  link: { status: 'disconnected', receiverReady: null, lastHbAt: null, connectedAt: null, error: null },
  settings: {
    // ?sim=1 in the URL starts in simulation mode (handy for demos)
    simulate: typeof location !== 'undefined' && new URLSearchParams(location.search).get('sim') === '1',
    dryRun: true, // safety: always start in dry-run
    muted: loadJson<{ muted: boolean }>(MUTE_KEY, { muted: false }).muted,
    baseStation: loadJson<LatLng>(BASE_KEY, config.baseStation),
    rescue: loadJson<RescueSettings>(RESCUE_KEY, config.rescue),
    tileSource: loadJson<{ src: 'online' | 'offline' }>(TILES_KEY, { src: config.map.tileSource }).src,
  },
  droneLink: { wsConnected: false, mavlinkSeen: false },
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

  setTileSource: (src) =>
    set((s) => {
      saveJson(TILES_KEY, { src });
      return { settings: { ...s.settings, tileSource: src } };
    }),

  setLink: (patch) => set((s) => ({ link: { ...s.link, ...patch } })),

  // Leaving simulation always re-enables dry-run, so LIVE chosen for the simulated
  // drone can never carry over to the real one.
  setSimulate: (on) => set((s) => ({ settings: { ...s.settings, simulate: on, dryRun: on ? s.settings.dryRun : true } })),
  setDryRun: (on) => set((s) => ({ settings: { ...s.settings, dryRun: on } })),
  setMuted: (on) =>
    set((s) => {
      saveJson(MUTE_KEY, { muted: on });
      return { settings: { ...s.settings, muted: on } };
    }),
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
