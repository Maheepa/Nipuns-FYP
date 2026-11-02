// Minimal MAVLink codec for the base-station bridge.
//
// Decodes v1 (0xFE) and v2 (0xFD) frames, encodes v1 only — ArduCopter 3.2.1 speaks v1.
// Messages are declared with their fields in XML order; the wire order (stable sort by
// type size) and CRC_EXTRA are derived from that, exactly like pymavlink does, so a
// typo in a field list shows up as a CRC_EXTRA mismatch in the tests.

const TYPE_SIZE = { uint64_t: 8, int64_t: 8, double: 8, uint32_t: 4, int32_t: 4, float: 4, uint16_t: 2, int16_t: 2, uint8_t: 1, int8_t: 1, char: 1 };

/** [name, type, arrayLength?] in XML order (base fields only — no v2 extensions). */
const DEFS = {
  0: ['HEARTBEAT', [['type', 'uint8_t'], ['autopilot', 'uint8_t'], ['base_mode', 'uint8_t'], ['custom_mode', 'uint32_t'], ['system_status', 'uint8_t'], ['mavlink_version', 'uint8_t']]],
  1: ['SYS_STATUS', [
    ['onboard_control_sensors_present', 'uint32_t'], ['onboard_control_sensors_enabled', 'uint32_t'], ['onboard_control_sensors_health', 'uint32_t'],
    ['load', 'uint16_t'], ['voltage_battery', 'uint16_t'], ['current_battery', 'int16_t'], ['battery_remaining', 'int8_t'],
    ['drop_rate_comm', 'uint16_t'], ['errors_comm', 'uint16_t'], ['errors_count1', 'uint16_t'], ['errors_count2', 'uint16_t'], ['errors_count3', 'uint16_t'], ['errors_count4', 'uint16_t'],
  ]],
  11: ['SET_MODE', [['target_system', 'uint8_t'], ['base_mode', 'uint8_t'], ['custom_mode', 'uint32_t']]],
  24: ['GPS_RAW_INT', [
    ['time_usec', 'uint64_t'], ['fix_type', 'uint8_t'], ['lat', 'int32_t'], ['lon', 'int32_t'], ['alt', 'int32_t'],
    ['eph', 'uint16_t'], ['epv', 'uint16_t'], ['vel', 'uint16_t'], ['cog', 'uint16_t'], ['satellites_visible', 'uint8_t'],
  ]],
  33: ['GLOBAL_POSITION_INT', [
    ['time_boot_ms', 'uint32_t'], ['lat', 'int32_t'], ['lon', 'int32_t'], ['alt', 'int32_t'], ['relative_alt', 'int32_t'],
    ['vx', 'int16_t'], ['vy', 'int16_t'], ['vz', 'int16_t'], ['hdg', 'uint16_t'],
  ]],
  39: ['MISSION_ITEM', [
    ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['seq', 'uint16_t'], ['frame', 'uint8_t'], ['command', 'uint16_t'],
    ['current', 'uint8_t'], ['autocontinue', 'uint8_t'], ['param1', 'float'], ['param2', 'float'], ['param3', 'float'], ['param4', 'float'],
    ['x', 'float'], ['y', 'float'], ['z', 'float'],
  ]],
  47: ['MISSION_ACK', [['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['type', 'uint8_t']]],
  74: ['VFR_HUD', [['airspeed', 'float'], ['groundspeed', 'float'], ['heading', 'int16_t'], ['throttle', 'uint16_t'], ['alt', 'float'], ['climb', 'float']]],
  76: ['COMMAND_LONG', [
    ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['command', 'uint16_t'], ['confirmation', 'uint8_t'],
    ['param1', 'float'], ['param2', 'float'], ['param3', 'float'], ['param4', 'float'], ['param5', 'float'], ['param6', 'float'], ['param7', 'float'],
  ]],
  77: ['COMMAND_ACK', [['command', 'uint16_t'], ['result', 'uint8_t']]],
  253: ['STATUSTEXT', [['severity', 'uint8_t'], ['text', 'char', 50]]],
};

export const MSG = Object.fromEntries(Object.entries(DEFS).map(([id, [name]]) => [name, Number(id)]));

// ------------------------------------------------------------------ CRC (X.25 / MCRF4XX)
export function crcAccumulate(byte, crc) {
  let tmp = (byte ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export function crcBytes(bytes, crc = 0xffff) {
  for (const b of bytes) crc = crcAccumulate(b, crc);
  return crc;
}

const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));

/** Builds the per-message schema: wire-ordered fields with offsets, payload length and CRC_EXTRA. */
function buildSchema(id, name, fields) {
  const indexed = fields.map((f, i) => ({ name: f[0], type: f[1], len: f[2] ?? 0, i }));
  const wire = [...indexed].sort((a, b) => TYPE_SIZE[b.type] - TYPE_SIZE[a.type] || a.i - b.i);
  let crc = crcBytes(ascii(`${name} `));
  let offset = 0;
  for (const f of wire) {
    crc = crcBytes(ascii(`${f.type} `), crc);
    crc = crcBytes(ascii(`${f.name} `), crc);
    if (f.len) crc = crcAccumulate(f.len, crc);
    f.offset = offset;
    offset += TYPE_SIZE[f.type] * (f.len || 1);
  }
  return { id, name, wire, length: offset, crcExtra: (crc & 0xff) ^ (crc >> 8) };
}

export const SCHEMAS = Object.fromEntries(Object.entries(DEFS).map(([id, [name, fields]]) => [id, buildSchema(Number(id), name, fields)]));

// ------------------------------------------------------------------ field read / write
function readField(view, f) {
  const o = f.offset;
  switch (f.type) {
    case 'uint64_t': return Number(view.getBigUint64(o, true));
    case 'int64_t': return Number(view.getBigInt64(o, true));
    case 'double': return view.getFloat64(o, true);
    case 'uint32_t': return view.getUint32(o, true);
    case 'int32_t': return view.getInt32(o, true);
    case 'float': return view.getFloat32(o, true);
    case 'uint16_t': return view.getUint16(o, true);
    case 'int16_t': return view.getInt16(o, true);
    case 'uint8_t': return view.getUint8(o);
    case 'int8_t': return view.getInt8(o);
    case 'char': {
      let s = '';
      for (let i = 0; i < f.len; i++) {
        const c = view.getUint8(o + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
  }
  throw new Error(`unsupported type ${f.type}`);
}

function writeField(view, f, v) {
  const o = f.offset;
  switch (f.type) {
    case 'uint64_t': return view.setBigUint64(o, BigInt(v), true);
    case 'int64_t': return view.setBigInt64(o, BigInt(v), true);
    case 'double': return view.setFloat64(o, v, true);
    case 'uint32_t': return view.setUint32(o, v >>> 0, true);
    case 'int32_t': return view.setInt32(o, v | 0, true);
    case 'float': return view.setFloat32(o, v, true);
    case 'uint16_t': return view.setUint16(o, v & 0xffff, true);
    case 'int16_t': return view.setInt16(o, v, true);
    case 'uint8_t': return view.setUint8(o, v & 0xff);
    case 'int8_t': return view.setInt8(o, v);
    case 'char': {
      const s = String(v ?? '');
      for (let i = 0; i < f.len; i++) view.setUint8(o + i, i < s.length ? s.charCodeAt(i) & 0xff : 0);
      return;
    }
  }
  throw new Error(`unsupported type ${f.type}`);
}

export function decodePayload(msgid, payload) {
  const schema = SCHEMAS[msgid];
  if (!schema) return null;
  // v2 truncates trailing zero bytes; pad back to full length.
  const buf = new Uint8Array(schema.length);
  buf.set(payload.subarray(0, schema.length));
  const view = new DataView(buf.buffer);
  const out = {};
  for (const f of schema.wire) out[f.name] = readField(view, f);
  return out;
}

// ------------------------------------------------------------------ encoder (v1)
let txSeq = 0;

/**
 * Encode a MAVLink v1 frame.
 * @param {string} name   message name, e.g. 'COMMAND_LONG'
 * @param {object} fields field values (missing ones are 0)
 * @param {{sysid?: number, compid?: number, seq?: number}} [hdr]
 */
export function encodeV1(name, fields, hdr = {}) {
  const schema = SCHEMAS[MSG[name]];
  if (!schema) throw new Error(`unknown message ${name}`);
  const frame = new Uint8Array(6 + schema.length + 2);
  const view = new DataView(frame.buffer, 6, schema.length);
  frame[0] = 0xfe;
  frame[1] = schema.length;
  frame[2] = hdr.seq ?? (txSeq = (txSeq + 1) & 0xff);
  frame[3] = hdr.sysid ?? 255;
  frame[4] = hdr.compid ?? 190; // MAV_COMP_ID_MISSIONPLANNER
  frame[5] = schema.id;
  for (const f of schema.wire) writeField(view, f, fields[f.name] ?? 0);
  let crc = crcBytes(frame.subarray(1, 6 + schema.length));
  crc = crcAccumulate(schema.crcExtra, crc);
  frame[6 + schema.length] = crc & 0xff;
  frame[7 + schema.length] = crc >> 8;
  return frame;
}

// ------------------------------------------------------------------ stream parser
/**
 * Incremental parser: feed it UDP datagrams or serial chunks; it emits decoded messages.
 * Frames with unknown ids are skipped (their CRC cannot be checked without CRC_EXTRA).
 */
export class MavlinkParser {
  constructor() {
    this.buf = new Uint8Array(0);
    this.stats = { frames: 0, crcErrors: 0, unknown: 0 };
  }

  /** @returns {{msgid:number,name:string,sysid:number,compid:number,seq:number,version:1|2,fields:object}[]} */
  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    let b = merged;
    const out = [];
    let i = 0;
    while (i < b.length) {
      const stx = b[i];
      if (stx !== 0xfe && stx !== 0xfd) {
        i++;
        continue;
      }
      const v2 = stx === 0xfd;
      const hdrLen = v2 ? 10 : 6;
      if (b.length - i < hdrLen) break; // need more bytes
      const len = b[i + 1];
      const incompat = v2 ? b[i + 2] : 0;
      const sigLen = v2 && incompat & 0x01 ? 13 : 0;
      const total = hdrLen + len + 2 + sigLen;
      if (b.length - i < total) break;

      const seq = b[i + (v2 ? 4 : 2)];
      const sysid = b[i + (v2 ? 5 : 3)];
      const compid = b[i + (v2 ? 6 : 4)];
      const msgid = v2 ? b[i + 7] | (b[i + 8] << 8) | (b[i + 9] << 16) : b[i + 5];
      const schema = SCHEMAS[msgid];
      if (!schema) {
        this.stats.unknown++;
        i += total; // trust the length; a false STX just costs one resync
        continue;
      }
      let crc = crcBytes(b.subarray(i + 1, i + hdrLen + len));
      crc = crcAccumulate(schema.crcExtra, crc);
      const rx = b[i + hdrLen + len] | (b[i + hdrLen + len + 1] << 8);
      if (crc !== rx) {
        this.stats.crcErrors++;
        i++; // resync on the next STX
        continue;
      }
      this.stats.frames++;
      const payload = b.subarray(i + hdrLen, i + hdrLen + len);
      out.push({ msgid, name: schema.name, sysid, compid, seq, version: v2 ? 2 : 1, fields: decodePayload(msgid, payload) });
      i += total;
    }
    this.buf = b.slice(i);
    if (this.buf.length > 4096) this.buf = new Uint8Array(0);
    return out;
  }
}
