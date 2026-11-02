// Type 2 — automatic drowning detection.
//
// Detectors implement a small interface so the threshold rules below can be swapped
// for the Random Forest model later (e.g. a detector that calls a model exported to
// JS/ONNX, or a local Python service) without touching the alert or UI code.

import { config } from '../config';
import type { Sample } from '../types';

export type DetectionLevel = 'none' | 'warning' | 'drowning';

export interface DetectionResult {
  level: DetectionLevel;
  /** Human-readable reasons shown in the alert banner and event log. */
  reasons: string[];
  /** Stable ids of the rules that fired (used for cooldowns). */
  rules: string[];
}

export interface Detector {
  readonly name: string;
  /**
   * Called once per received packet. `history` holds the last 60 s of samples,
   * oldest first, and already includes `sample` as its last element.
   */
  evaluate(sample: Sample, history: Sample[]): DetectionResult;
  reset(): void;
}

export type DetectionConfig = typeof config.detection;

const G = 9.81;
const NONE: DetectionResult = { level: 'none', reasons: [], rules: [] };

const accelMag = (s: Sample) =>
  s.ax != null && s.ay != null && s.az != null ? Math.hypot(s.ax, s.ay, s.az) : null;
const gyroMag = (s: Sample) =>
  s.gx != null && s.gy != null && s.gz != null ? Math.hypot(s.gx, s.gy, s.gz) : null;

// Newer watch firmware samples the IMU at 50 Hz and sends a per-second summary
// (AMAX, ASTD, GMAX). Use it when present; otherwise fall back to the one instant
// sample per packet.

/** Largest deviation of |a| from 1 g seen in this sample's second. */
const accelPeakDev = (s: Sample) => {
  if (s.amax != null) return Math.abs(s.amax - G);
  const m = accelMag(s);
  return m == null ? null : Math.abs(m - G);
};
/** Strongest rotation seen in this sample's second. */
const gyroPeak = (s: Sample) => s.gmax ?? gyroMag(s);

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Total standard deviation of the acceleration vector (√(σx²+σy²+σz²)). Catches direction changes that |a| hides. */
function vectorSpread(xs: Sample[]): number | null {
  const v = xs.filter((s) => s.ax != null && s.ay != null && s.az != null);
  if (v.length < 2) return null;
  return Math.hypot(stdDev(v.map((s) => s.ax!)), stdDev(v.map((s) => s.ay!)), stdDev(v.map((s) => s.az!)));
}

/**
 * How much the wrist moved over these samples. With ASTD on every sample, the worst
 * second counts (each second must be still); otherwise the spread of the instant values.
 */
function movement(xs: Sample[]): number | null {
  if (xs.length >= 2 && xs.every((s) => s.astd != null)) return Math.max(...xs.map((s) => s.astd!));
  return vectorSpread(xs);
}

/**
 * Threshold rules (literature-style baseline, see proposal Table 1):
 *  - bpm:      valid heart rate outside [bpmLow, bpmHigh] continuously for N seconds
 *  - spike:    |a| jumps ≥ accelSpike away from 1 g, then the acceleration vector barely changes for ≥ stillSeconds
 *  - gyro:     |ω| above gyroErratic in ≥ gyroCount of the last gyroWindow samples
 * One rule → "warning" (possible drowning); two or more → "drowning".
 *
 * With the 50 Hz firmware the rules use AMAX / ASTD / GMAX (peaks and spread within each second);
 * with the older firmware only one instant IMU sample per second exists, so short spikes can be missed.
 */
export class ThresholdDetector implements Detector {
  readonly name = 'Threshold rules';
  private abnormalSince: number | null = null;

  constructor(private readonly cfg: DetectionConfig = config.detection) {}

  reset(): void {
    this.abnormalSince = null;
  }

  private validBpm(s: Sample): number | null {
    if (s.bpm == null) return null;
    if (s.conf == null || s.conf < this.cfg.minConfidence) return null;
    if (this.cfg.requireFinger && s.stat != null && s.stat !== 3) return null;
    return s.bpm;
  }

  evaluate(sample: Sample, history: Sample[]): DetectionResult {
    const reasons: string[] = [];
    const rules: string[] = [];
    const c = this.cfg;

    // ---- heart rate out of range for N seconds
    const bpm = this.validBpm(sample);
    if (bpm != null && (bpm < c.bpmLow || bpm > c.bpmHigh)) {
      this.abnormalSince ??= sample.t;
      const secs = (sample.t - this.abnormalSince) / 1000;
      if (secs >= c.abnormalBpmSeconds) {
        rules.push('bpm');
        reasons.push(
          `Heart rate ${Math.round(bpm)} BPM ${bpm < c.bpmLow ? `below ${c.bpmLow}` : `above ${c.bpmHigh}`} for ${Math.round(secs)} s`,
        );
      }
    } else if (bpm != null) {
      this.abnormalSince = null; // back in range
    } else {
      this.abnormalSince = null; // no trustworthy reading — do not accumulate
    }

    // ---- acceleration spike followed by little movement
    const windowStart = sample.t - (c.stillSeconds + 15) * 1000;
    const recent = history.filter((s) => s.t >= windowStart);
    let spikeIdx = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      const dev = accelPeakDev(recent[i]);
      if (dev != null && dev >= c.accelSpikeMs2) {
        spikeIdx = i;
        break;
      }
    }
    if (spikeIdx >= 0) {
      const after = recent.slice(spikeIdx + 1);
      const span = after.length ? (after[after.length - 1].t - recent[spikeIdx].t) / 1000 : 0;
      const spread = movement(after);
      if (span >= c.stillSeconds && spread != null && spread < c.stillStdDevMs2) {
        rules.push('spike');
        reasons.push(`Violent movement then almost no motion for ${Math.round(span)} s`);
      }
    }

    // ---- erratic gyro
    const last = history.slice(-c.gyroWindow);
    const hits = last.filter((s) => {
      const g = gyroPeak(s);
      return g != null && g > c.gyroErraticDps;
    }).length;
    if (last.length >= c.gyroWindow && hits >= c.gyroCount) {
      rules.push('gyro');
      reasons.push(`Erratic rotation: ${hits}/${last.length} samples above ${c.gyroErraticDps} °/s`);
    }

    if (rules.length === 0) return NONE;
    return { level: rules.length >= 2 ? 'drowning' : 'warning', reasons, rules };
  }
}

/** The active detector. Replace with your model: `setDetector(new RandomForestDetector(...))`. */
let active: Detector = new ThresholdDetector();
export const getDetector = (): Detector => active;
export function setDetector(d: Detector): void {
  active = d;
  active.reset();
}
