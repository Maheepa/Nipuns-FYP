import { describe, expect, it } from 'vitest';
import { eventsToCsv } from './eventLog';

describe('eventsToCsv', () => {
  it('writes a header and escapes commas and quotes', () => {
    const csv = eventsToCsv([
      { t: Date.UTC(2026, 10, 2, 12, 0, 0), kind: 'alert', message: 'Button, "pressed"', lat: 6.8122982, lng: 79.8907368, bpm: 120 },
      { t: Date.UTC(2026, 10, 2, 12, 0, 1), kind: 'info', message: 'ok' },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('iso_time,local_time,kind,message,lat,lng,bpm,spo2,conf');
    expect(lines[1]).toContain('2026-11-02T12:00:00.000Z');
    expect(lines[1]).toContain('"Button, ""pressed"""');
    expect(lines[1]).toContain('6.8122982,79.8907368,120,,');
    expect(lines[2].endsWith('info,ok,,,,,')).toBe(true);
  });
});
