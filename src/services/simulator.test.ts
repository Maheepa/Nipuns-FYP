import { describe, expect, it } from 'vitest';
import { parseSerialLine } from './packetParser';
import { SIM_SCENARIOS, generatePacket, setSimScenario, summarise } from './simulator';

describe('simulator output', () => {
  it.each(SIM_SCENARIOS.map((s) => s.id))('scenario %s produces packets the parser accepts', (id) => {
    setSimScenario(id);
    for (let i = 0; i < 20; i++) {
      const r = parseSerialLine(`RX|${generatePacket(i % 5 ? 'DATA' : 'ALERT')}|RSSI:-70|SNR:5.50`);
      expect(r.kind).toBe('packet');
      if (r.kind === 'packet' && id === 'no-gps') expect(r.packet.gpsNoFix).toBe(true);
      if (r.kind === 'packet' && id === 'no-finger') expect(r.packet.stat).toBe(0);
      if (r.kind === 'packet') expect(r.packet).toMatchObject({ n: 50, amax: expect.any(Number), astd: expect.any(Number), gmax: expect.any(Number) });
    }
  });
});

describe('per-second IMU summary', () => {
  it('computes peak |a|, vector spread and peak |ω|', () => {
    const r = summarise([
      [0, 0, 9, 0, 0, 10],
      [0, 0, 11, 0, 30, 40],
    ]);
    expect(r.amax).toBeCloseTo(11);
    expect(r.astd).toBeCloseTo(1); // z alternates 9/11 → σ = 1
    expect(r.gmax).toBeCloseTo(50);
  });
});
