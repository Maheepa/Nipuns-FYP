import { describe, expect, it } from 'vitest';
import { fingerStatusText, parsePacket, parseSerialLine } from './packetParser';

const DATA =
  'DATA|BPM:72|SPO2:98|CONF:95|AX:0.12|AY:-0.40|AZ:9.81|GX:1.20|GY:-0.50|GZ:0.03|LAT:6.812298|LNG:79.890736|STAT:3';

function packetOf(line: string) {
  const r = parseSerialLine(line);
  if (r.kind !== 'packet') throw new Error(`expected packet, got ${JSON.stringify(r)}`);
  return r.packet;
}

describe('normal DATA packets', () => {
  it('parses every field of a wrapped DATA packet', () => {
    const p = packetOf(`RX|${DATA}|RSSI:-57|SNR:9.25`);
    expect(p).toMatchObject({
      type: 'DATA',
      bpm: 72,
      spo2: 98,
      conf: 95,
      ax: 0.12,
      ay: -0.4,
      az: 9.81,
      gx: 1.2,
      gy: -0.5,
      gz: 0.03,
      lat: 6.812298,
      lng: 79.890736,
      gpsNoFix: false,
      stat: 3,
      rssi: -57,
      snr: 9.25,
      extra: {},
    });
    expect(p.raw).toBe(DATA);
  });

  it('accepts a bare packet without the RX wrapper', () => {
    const p = packetOf(DATA);
    expect(p.bpm).toBe(72);
    expect(p.rssi).toBeNull();
    expect(p.snr).toBeNull();
  });

  it('tolerates a trailing carriage return', () => {
    expect(packetOf(`RX|${DATA}|RSSI:-100|SNR:-7.5\r`).snr).toBe(-7.5);
  });

  it('parses by key, not position', () => {
    const p = packetOf('DATA|STAT:1|LNG:79.1|LAT:6.5|BPM:60|CONF:80');
    expect(p).toMatchObject({ stat: 1, lat: 6.5, lng: 79.1, bpm: 60, conf: 80 });
  });

  it('keeps BPM 0 / CONF 0 as zero (the store treats them as "no reading")', () => {
    const p = packetOf('DATA|BPM:0|SPO2:0|CONF:0|STAT:0');
    expect(p).toMatchObject({ bpm: 0, spo2: 0, conf: 0, stat: 0 });
  });
});

describe('ALERT packets', () => {
  it('parses ALERT with the same fields', () => {
    const p = packetOf(`RX|${DATA.replace('DATA', 'ALERT')}|RSSI:-80|SNR:2.0`);
    expect(p.type).toBe('ALERT');
    expect(p.bpm).toBe(72);
    expect(p.lat).toBe(6.812298);
  });
});

describe('LAT:NA (no GPS fix)', () => {
  it('reports no position and flags the missing fix', () => {
    const p = packetOf(DATA.replace('LAT:6.812298|LNG:79.890736', 'LAT:NA|LNG:NA'));
    expect(p.lat).toBeNull();
    expect(p.lng).toBeNull();
    expect(p.gpsNoFix).toBe(true);
    expect(p.bpm).toBe(72);
  });

  it('treats a half-NA position as no fix', () => {
    const p = packetOf('DATA|BPM:70|CONF:90|LAT:NA|LNG:79.89');
    expect(p.lat).toBeNull();
    expect(p.gpsNoFix).toBe(true);
  });
});

describe('missing fields', () => {
  it('returns null for absent fields instead of failing', () => {
    const p = packetOf('DATA|BPM:70|CONF:90');
    expect(p.bpm).toBe(70);
    expect(p.ax).toBeNull();
    expect(p.stat).toBeNull();
    expect(p.lat).toBeNull();
    expect(p.gpsNoFix).toBe(false); // missing ≠ NA
  });

  it('accepts packets from older firmware without STAT', () => {
    const p = packetOf(DATA.replace('|STAT:3', ''));
    expect(p.stat).toBeNull();
    expect(p.lng).toBe(79.890736);
  });

  it('rejects a packet with LAT but no LNG', () => {
    expect(parseSerialLine('DATA|BPM:70|LAT:6.8').kind).toBe('bad');
  });

  it('rejects a type with no fields', () => {
    expect(parseSerialLine('DATA').kind).toBe('bad');
    expect(parseSerialLine('ALERT|').kind).toBe('bad');
  });
});

describe('extra unknown fields', () => {
  it('keeps unknown fields in extra and still parses known ones', () => {
    const p = packetOf(`${DATA}|BATT:3.91|DEPTH:0.42`);
    expect(p.extra).toEqual({ BATT: '3.91', DEPTH: '0.42' });
    expect(p.stat).toBe(3);
  });

  it('rejects a packet that only has unknown fields', () => {
    expect(parseSerialLine('DATA|FOO:1|BAR:2').kind).toBe('bad');
  });
});

describe('garbage lines', () => {
  const garbage = [
    'hello world',
    'DTA|BPM:72',
    'DATA|BPM72|CONF:90',
    'DATA|BPM:7x2|CONF:90',
    'DATA|BPM:72|BPM:73',
    'DATA|BPM:|CONF:90',
    'DATA|bpm:72',
    'DATA|BPM:72|LAT:95.0|LNG:79.0',
    '\u0000ÿþ garbage',
    'RX|DATA|BPM:72|RSSI:abc|SNR:1',
    'RX|DATA|BPM:72',
    'READY|MAYBE',
    'HB|soon',
    'HR:104.1|IR:109886|RED:67851|CONTACT:YES', // old firmware format, no type token
  ];
  it.each(garbage)('marks %j as bad', (line) => {
    expect(parseSerialLine(line).kind).toBe('bad');
  });

  it('ignores blank lines and # debug lines', () => {
    expect(parseSerialLine('').kind).toBe('ignored');
    expect(parseSerialLine('   \r').kind).toBe('ignored');
    expect(parseSerialLine('# LoRa init done').kind).toBe('ignored');
  });

  it('parsePacket reports a reason', () => {
    const r = parsePacket('nonsense');
    expect(r.ok).toBe(false);
  });
});

describe('receiver control lines', () => {
  it('parses READY and HB', () => {
    expect(parseSerialLine('READY|LORA_OK')).toEqual({ kind: 'ready', loraOk: true });
    expect(parseSerialLine('READY|LORA_FAIL')).toEqual({ kind: 'ready', loraOk: false });
    expect(parseSerialLine('HB|123456')).toEqual({ kind: 'heartbeat', millis: 123456 });
  });
});

describe('finger status text', () => {
  it('maps MAX32664 status codes', () => {
    expect(fingerStatusText(0)).toBe('No object');
    expect(fingerStatusText(3)).toBe('Finger detected');
    expect(fingerStatusText(null)).toBe('Unknown');
    expect(fingerStatusText(7)).toBe('Unknown (7)');
  });
});
