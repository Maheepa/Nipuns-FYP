import { describe, expect, it } from 'vitest';
import { parseSerialLine } from './packetParser';
import { SIM_SCENARIOS, generatePacket, setSimScenario } from './simulator';

describe('simulator output', () => {
  it.each(SIM_SCENARIOS.map((s) => s.id))('scenario %s produces packets the parser accepts', (id) => {
    setSimScenario(id);
    for (let i = 0; i < 20; i++) {
      const r = parseSerialLine(`RX|${generatePacket(i % 5 ? 'DATA' : 'ALERT')}|RSSI:-70|SNR:5.50`);
      expect(r.kind).toBe('packet');
      if (r.kind === 'packet' && id === 'no-gps') expect(r.packet.gpsNoFix).toBe(true);
      if (r.kind === 'packet' && id === 'no-finger') expect(r.packet.stat).toBe(0);
    }
  });
});
