import { describe, expect, it } from 'vitest';
import { MavlinkParser, SCHEMAS, MSG, crcBytes, encodeV1 } from './mavlink.js';

// CRC_EXTRA values published in the MAVLink common.xml headers.
const KNOWN_CRC_EXTRA = {
  HEARTBEAT: 50,
  SYS_STATUS: 124,
  SET_MODE: 89,
  GPS_RAW_INT: 24,
  GLOBAL_POSITION_INT: 104,
  MISSION_ITEM: 254,
  MISSION_ACK: 153,
  VFR_HUD: 20,
  COMMAND_LONG: 152,
  COMMAND_ACK: 143,
  STATUSTEXT: 83,
};

const KNOWN_LENGTH = {
  HEARTBEAT: 9,
  SYS_STATUS: 31,
  SET_MODE: 6,
  GPS_RAW_INT: 30,
  GLOBAL_POSITION_INT: 28,
  MISSION_ITEM: 37,
  MISSION_ACK: 3,
  VFR_HUD: 20,
  COMMAND_LONG: 33,
  COMMAND_ACK: 3,
  STATUSTEXT: 51,
};

describe('MAVLink schemas', () => {
  it.each(Object.keys(KNOWN_CRC_EXTRA))('%s has the published CRC_EXTRA and length', (name) => {
    const s = SCHEMAS[MSG[name]];
    expect(s.crcExtra).toBe(KNOWN_CRC_EXTRA[name]);
    expect(s.length).toBe(KNOWN_LENGTH[name]);
  });

  it('X.25 CRC matches the standard check value', () => {
    // CRC-16/MCRF4XX of "123456789" is 0x6F91
    expect(crcBytes(Array.from('123456789', (c) => c.charCodeAt(0)))).toBe(0x6f91);
  });
});

describe('encode / parse', () => {
  it('round-trips a COMMAND_LONG', () => {
    const frame = encodeV1('COMMAND_LONG', { target_system: 1, target_component: 1, command: 183, param1: 9, param2: 1900 }, { sysid: 254, compid: 190, seq: 7 });
    expect(frame[0]).toBe(0xfe);
    expect(frame.length).toBe(6 + 33 + 2);
    const [m] = new MavlinkParser().push(frame);
    expect(m).toMatchObject({ name: 'COMMAND_LONG', sysid: 254, compid: 190, seq: 7, version: 1 });
    expect(m.fields).toMatchObject({ command: 183, param1: 9, param2: 1900, target_system: 1 });
  });

  it('round-trips a MISSION_ITEM with float coordinates', () => {
    const frame = encodeV1('MISSION_ITEM', { x: 6.8122982, y: 79.8907368, z: 10, command: 16, frame: 3, current: 2 });
    const [m] = new MavlinkParser().push(frame);
    expect(m.fields.current).toBe(2);
    expect(m.fields.frame).toBe(3);
    expect(m.fields.x).toBeCloseTo(6.8122982, 5);
    expect(m.fields.y).toBeCloseTo(79.8907368, 4);
  });

  it('decodes STATUSTEXT strings', () => {
    const [m] = new MavlinkParser().push(encodeV1('STATUSTEXT', { severity: 3, text: 'PreArm: Bad Velocity' }));
    expect(m.fields).toEqual({ severity: 3, text: 'PreArm: Bad Velocity' });
  });

  it('handles frames split across chunks, junk bytes and several frames per chunk', () => {
    const a = encodeV1('HEARTBEAT', { custom_mode: 4, type: 2, autopilot: 3, base_mode: 128 | 1 });
    const b = encodeV1('VFR_HUD', { groundspeed: 3.5, heading: 270 });
    const all = new Uint8Array([0x00, 0x13, ...a, 0x77, ...b]);
    const p = new MavlinkParser();
    const got = [...p.push(all.subarray(0, 9)), ...p.push(all.subarray(9))];
    expect(got.map((m) => m.name)).toEqual(['HEARTBEAT', 'VFR_HUD']);
    expect(got[0].fields.custom_mode).toBe(4);
    expect(got[1].fields.heading).toBe(270);
  });

  it('rejects a corrupted frame and recovers on the next one', () => {
    const bad = encodeV1('HEARTBEAT', { custom_mode: 5 });
    bad[8] ^= 0xff;
    const good = encodeV1('HEARTBEAT', { custom_mode: 6 });
    const p = new MavlinkParser();
    const got = p.push(new Uint8Array([...bad, ...good]));
    expect(got).toHaveLength(1);
    expect(got[0].fields.custom_mode).toBe(6);
    expect(p.stats.crcErrors).toBeGreaterThan(0);
  });

  it('decodes a v2 frame with a truncated payload', () => {
    // Build a v2 HEARTBEAT by hand: trailing zero bytes are dropped on the wire.
    const s = SCHEMAS[MSG.HEARTBEAT];
    const payload = new Uint8Array(s.length);
    new DataView(payload.buffer).setUint32(0, 6, true); // custom_mode = RTL
    payload[4] = 2; // type
    payload[5] = 3; // autopilot
    payload[6] = 0x81; // base_mode (armed)
    payload[7] = 4; // system_status
    // payload[8] = 0 (mavlink_version) → truncated
    const len = 8;
    const hdr = [0xfd, len, 0, 0, 9, 1, 1, 0, 0, 0];
    let crc = crcBytes([...hdr.slice(1), ...payload.subarray(0, len)]);
    crc = crcBytes([s.crcExtra], crc);
    const frame = new Uint8Array([...hdr, ...payload.subarray(0, len), crc & 0xff, crc >> 8]);
    const [m] = new MavlinkParser().push(frame);
    expect(m).toMatchObject({ version: 2, name: 'HEARTBEAT' });
    expect(m.fields).toMatchObject({ custom_mode: 6, base_mode: 0x81, mavlink_version: 0 });
  });
});
