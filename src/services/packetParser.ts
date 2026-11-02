// Parser for the LoRa receiver's serial output and the watch packet format.
//
// Receiver lines (firmware/lora_receiver):
//   RX|<raw packet>|RSSI:<int>|SNR:<float>
//   READY|LORA_OK   or   READY|LORA_FAIL
//   HB|<millis>
//   # debug text (ignored)
//
// Watch packet (reference/transmission-new.ino):
//   DATA|BPM:72|SPO2:98|CONF:95|AX:0.12|...|LAT:6.812298|LNG:79.890736|STAT:3
//   ALERT|... same fields ...
// Fields are parsed by key, so new fields or a different order do not break anything.

import type { PacketType, WatchPacket } from '../types';

export type SerialLine =
  | { kind: 'packet'; packet: WatchPacket }
  | { kind: 'ready'; loraOk: boolean }
  | { kind: 'heartbeat'; millis: number }
  | { kind: 'ignored' }
  | { kind: 'bad'; raw: string; reason: string };

export type PacketResult = { ok: true; packet: WatchPacket } | { ok: false; reason: string };

const NUM_RE = /^-?\d+(\.\d+)?$/;
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const RX_RE = /^RX\|(.*)\|RSSI:(-?\d+)\|SNR:(-?\d+(?:\.\d+)?)$/;

const NUMERIC_KEYS = ['BPM', 'SPO2', 'CONF', 'AX', 'AY', 'AZ', 'GX', 'GY', 'GZ', 'STAT'] as const;
type NumericKey = (typeof NUMERIC_KEYS)[number];
const KNOWN_KEYS = new Set<string>([...NUMERIC_KEYS, 'LAT', 'LNG']);

export const FINGER_STATUS: Record<number, string> = {
  0: 'No object',
  1: 'Object detected',
  2: 'Not a finger',
  3: 'Finger detected',
};

export function fingerStatusText(stat: number | null): string {
  if (stat == null) return 'Unknown';
  return FINGER_STATUS[stat] ?? `Unknown (${stat})`;
}

/** Parse one watch packet (without the RX| wrapper). */
export function parsePacket(text: string, rssi: number | null = null, snr: number | null = null): PacketResult {
  const raw = text.trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const parts = raw.split('|');
  const type = parts[0];
  if (type !== 'DATA' && type !== 'ALERT') return { ok: false, reason: `unknown packet type "${type.slice(0, 12)}"` };
  if (parts.length < 2) return { ok: false, reason: 'no fields' };

  const fields = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const idx = part.indexOf(':');
    if (idx <= 0) return { ok: false, reason: `malformed field "${part.slice(0, 16)}"` };
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!KEY_RE.test(key)) return { ok: false, reason: `bad key "${key.slice(0, 16)}"` };
    if (value === '') return { ok: false, reason: `empty value for ${key}` };
    if (fields.has(key)) return { ok: false, reason: `duplicate field ${key}` };
    fields.set(key, value);
  }

  const nums: Partial<Record<NumericKey, number>> = {};
  for (const key of NUMERIC_KEYS) {
    const v = fields.get(key);
    if (v == null) continue;
    if (!NUM_RE.test(v)) return { ok: false, reason: `non-numeric ${key}` };
    nums[key] = Number(v);
  }

  // GPS: number, "NA" (no fix) or missing. LAT and LNG must agree.
  const latS = fields.get('LAT');
  const lngS = fields.get('LNG');
  let lat: number | null = null;
  let lng: number | null = null;
  let gpsNoFix = false;
  if (latS != null || lngS != null) {
    if (latS === 'NA' || lngS === 'NA') {
      gpsNoFix = true;
    } else if (latS != null && lngS != null && NUM_RE.test(latS) && NUM_RE.test(lngS)) {
      lat = Number(latS);
      lng = Number(lngS);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'GPS out of range' };
    } else {
      return { ok: false, reason: 'bad GPS fields' };
    }
  }

  const extra: Record<string, string> = {};
  for (const [k, v] of fields) if (!KNOWN_KEYS.has(k)) extra[k] = v;

  const known = [...fields.keys()].filter((k) => KNOWN_KEYS.has(k)).length;
  if (known === 0) return { ok: false, reason: 'no known fields' };

  const n = (k: NumericKey) => nums[k] ?? null;
  return {
    ok: true,
    packet: {
      type: type as PacketType,
      raw,
      bpm: n('BPM'),
      spo2: n('SPO2'),
      conf: n('CONF'),
      ax: n('AX'),
      ay: n('AY'),
      az: n('AZ'),
      gx: n('GX'),
      gy: n('GY'),
      gz: n('GZ'),
      lat,
      lng,
      gpsNoFix,
      stat: n('STAT'),
      extra,
      rssi,
      snr,
    },
  };
}

/** Parse one line from the receiver's USB serial output. */
export function parseSerialLine(line: string): SerialLine {
  const s = line.replace(/\r$/, '').trim();
  if (!s || s.startsWith('#')) return { kind: 'ignored' };

  if (s.startsWith('READY|')) {
    const v = s.slice(6);
    if (v === 'LORA_OK') return { kind: 'ready', loraOk: true };
    if (v === 'LORA_FAIL') return { kind: 'ready', loraOk: false };
    return { kind: 'bad', raw: s, reason: 'bad READY line' };
  }

  if (s.startsWith('HB|')) {
    const v = s.slice(3);
    return /^\d+$/.test(v) ? { kind: 'heartbeat', millis: Number(v) } : { kind: 'bad', raw: s, reason: 'bad HB line' };
  }

  if (s.startsWith('RX|')) {
    const m = RX_RE.exec(s);
    if (!m) return { kind: 'bad', raw: s, reason: 'bad RX wrapper' };
    const r = parsePacket(m[1], Number(m[2]), Number(m[3]));
    return r.ok ? { kind: 'packet', packet: r.packet } : { kind: 'bad', raw: s, reason: r.reason };
  }

  // Bare packet (e.g. receiver flashed with a plain "print packet" sketch).
  const r = parsePacket(s);
  return r.ok ? { kind: 'packet', packet: r.packet } : { kind: 'bad', raw: s, reason: r.reason };
}
