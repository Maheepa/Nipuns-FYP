import type { LatLng } from './config';

export type PacketType = 'DATA' | 'ALERT';

/** One decoded watch packet. Numeric fields are null when absent from the packet. */
export interface WatchPacket {
  type: PacketType;
  /** Raw packet text as received over LoRa (without the RX| wrapper). */
  raw: string;
  bpm: number | null;
  spo2: number | null;
  conf: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gy: number | null;
  gz: number | null;
  /** null when the field is missing or NA (no GPS fix). */
  lat: number | null;
  lng: number | null;
  /** true when LAT/LNG were present but "NA". */
  gpsNoFix: boolean;
  /** MAX32664 finger status: 0 none, 1 object, 2 not a finger, 3 finger. */
  stat: number | null;
  /** Unknown KEY:value fields, kept so newer firmware does not break anything. */
  extra: Record<string, string>;
  /** Radio metadata from the receiver wrapper (absent for bare packets). */
  rssi: number | null;
  snr: number | null;
}

/** One point in the rolling 60 s buffer. */
export interface Sample {
  t: number;
  type: PacketType;
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gy: number | null;
  gz: number | null;
  /** null when there is no valid reading (BPM 0 or CONF 0). */
  bpm: number | null;
  conf: number | null;
  stat: number | null;
}

export type LinkStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';

export type DroneLinkState = 'down' | 'nodata' | 'ok';

export interface StatusText {
  t: number;
  severity: number;
  text: string;
  /** Number of identical consecutive messages collapsed into this one. */
  count: number;
}

export interface DroneState {
  lastMsgAt: number | null;
  sysid: number | null;
  armed: boolean;
  mode: string;
  customMode: number | null;
  gpsFix: number;
  sats: number | null;
  hdop: number | null;
  position: LatLng | null;
  relAltM: number | null;
  headingDeg: number | null;
  groundSpeed: number | null;
  airSpeed: number | null;
  climb: number | null;
  batteryV: number | null;
  batteryPct: number | null;
  track: [number, number][];
  statusTexts: StatusText[];
}

export type AlertSource = 'button' | 'detection';
export type AlertLevel = 'warning' | 'drowning';

export interface ActiveAlert {
  id: number;
  source: AlertSource;
  level: AlertLevel;
  startedAt: number;
  /** Latest reason text per rule id (e.g. button, bpm, spike, gyro). */
  reasons: Record<string, string>;
  acknowledged: boolean;
}

export type RescueStage =
  | 'idle'
  | 'alert'
  | 'dispatched'
  | 'enroute'
  | 'ontarget'
  | 'released'
  | 'delivered'
  | 'returning';

export type EventKind = 'alert' | 'detection' | 'command' | 'dry-run' | 'rescue' | 'link' | 'info' | 'error';

export interface LogEvent {
  t: number;
  kind: EventKind;
  message: string;
  lat?: number | null;
  lng?: number | null;
  bpm?: number | null;
  spo2?: number | null;
  conf?: number | null;
}
