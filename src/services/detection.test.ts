import { describe, expect, it } from 'vitest';
import type { Sample } from '../types';
import { ThresholdDetector } from './detection';

const T0 = 1_000_000;
function s(i: number, over: Partial<Sample> = {}): Sample {
  return {
    t: T0 + i * 1000,
    type: 'DATA',
    ax: 0.2,
    ay: -1,
    az: 9.7,
    gx: 2,
    gy: 1,
    gz: 0.5,
    amax: null,
    astd: null,
    gmax: null,
    bpm: 80,
    conf: 95,
    stat: 3,
    ...over,
  };
}

/** Feed samples one by one, like packets arriving; return the last result. */
function run(samples: Sample[]) {
  const d = new ThresholdDetector();
  const hist: Sample[] = [];
  return samples.map((x) => {
    hist.push(x);
    return d.evaluate(x, hist);
  })[samples.length - 1];
}

describe('ThresholdDetector', () => {
  it('normal swimming → nothing', () => {
    expect(run(Array.from({ length: 30 }, (_, i) => s(i))).level).toBe('none');
  });

  it('high BPM only after it lasts N seconds', () => {
    const short = Array.from({ length: 6 }, (_, i) => s(i, { bpm: 140 }));
    expect(run(short).level).toBe('none');
    const long = Array.from({ length: 12 }, (_, i) => s(i, { bpm: 140 }));
    const r = run(long);
    expect(r.rules).toContain('bpm');
    expect(r.level).toBe('warning');
  });

  it('ignores low-confidence or no-finger heart rate', () => {
    expect(run(Array.from({ length: 15 }, (_, i) => s(i, { bpm: 30, conf: 10 }))).level).toBe('none');
    expect(run(Array.from({ length: 15 }, (_, i) => s(i, { bpm: 30, stat: 0 }))).level).toBe('none');
  });

  it('a gap in valid readings restarts the BPM timer', () => {
    const xs = [
      ...Array.from({ length: 8 }, (_, i) => s(i, { bpm: 140 })),
      s(8, { bpm: null }),
      ...Array.from({ length: 5 }, (_, i) => s(9 + i, { bpm: 140 })),
    ];
    expect(run(xs).level).toBe('none');
  });

  it('spike then stillness', () => {
    const xs = [
      ...Array.from({ length: 5 }, (_, i) => s(i)),
      s(5, { ax: 30, az: 20 }),
      ...Array.from({ length: 7 }, (_, i) => s(6 + i)),
    ];
    expect(run(xs).rules).toContain('spike');
  });

  it('spike followed by continued movement is not flagged', () => {
    const xs = [
      s(0, { ax: 30, az: 20 }),
      ...Array.from({ length: 8 }, (_, i) => s(1 + i, { ax: i % 2 ? 6 : -6 })),
    ];
    expect(run(xs).rules).not.toContain('spike');
  });

  it('erratic gyro', () => {
    const xs = Array.from({ length: 6 }, (_, i) => s(i, { gx: i % 2 ? 300 : -320, gy: 100 }));
    expect(run(xs).rules).toContain('gyro');
  });

  it('two rules → drowning', () => {
    const xs = Array.from({ length: 12 }, (_, i) => s(i, { bpm: 150, gx: 400 }));
    const r = run(xs);
    expect(r.level).toBe('drowning');
    expect(r.reasons.length).toBe(2);
  });

  describe('with the 50 Hz per-second summary (AMAX / ASTD / GMAX)', () => {
    it('finds a spike that only shows in AMAX', () => {
      // Instant values look calm; the peak happened between packets.
      const xs = [
        ...Array.from({ length: 3 }, (_, i) => s(i, { amax: 10, astd: 0.6, gmax: 20 })),
        s(3, { amax: 38, astd: 9, gmax: 300 }),
        ...Array.from({ length: 7 }, (_, i) => s(4 + i, { amax: 9.9, astd: 0.1, gmax: 3 })),
      ];
      expect(run(xs).rules).toContain('spike');
    });

    it('uses ASTD for stillness: one restless second breaks it', () => {
      const xs = [
        s(0, { amax: 38, astd: 9, gmax: 300 }),
        ...Array.from({ length: 7 }, (_, i) => s(1 + i, { amax: 10, astd: i === 3 ? 2.5 : 0.1, gmax: 5 })),
      ];
      expect(run(xs).rules).not.toContain('spike');
    });

    it('uses GMAX for erratic rotation even when the instant gyro is calm', () => {
      const xs = Array.from({ length: 6 }, (_, i) => s(i, { amax: 15, astd: 3, gmax: 320 }));
      expect(run(xs).rules).toContain('gyro');
    });

    it('a calm AMAX overrides a noisy instant sample', () => {
      const xs = Array.from({ length: 10 }, (_, i) => s(i, { ax: 30, az: 20, amax: 10.2, astd: 0.2, gmax: 4 }));
      expect(run(xs).rules).not.toContain('spike');
    });
  });
});
