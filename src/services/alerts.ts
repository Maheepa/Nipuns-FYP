// Alert pipeline: Type 1 (ALERT packet from the watch button) and Type 2 (detector).

import { config } from '../config';
import { live, recentSamples, validBpm } from '../store/live';
import { useStore } from '../store/useStore';
import type { LogEvent, WatchPacket } from '../types';
import { getDetector } from './detection';
import { onPacket } from './telemetry';

let clearedAt = 0;

function vitals(p: WatchPacket): Partial<LogEvent> {
  const pos = live.watch.position;
  return { lat: pos?.lat ?? null, lng: pos?.lng ?? null, bpm: validBpm(p), spo2: p.spo2 || null, conf: p.conf };
}

function handlePacket(p: WatchPacket, now: number) {
  const st = useStore.getState();

  // ---- Type 1: emergency button
  if (p.type === 'ALERT') {
    const isNew = !st.alert;
    st.raiseAlert('button', 'drowning', { button: 'Emergency button pressed on the watch' }, now);
    st.logEvent({
      t: now,
      kind: 'alert',
      message: isNew ? 'ALERT packet: emergency button pressed' : 'ALERT packet (button pressed again)',
      ...vitals(p),
    });
  }

  // ---- Type 2: automatic detection on every packet
  const samples = recentSamples(undefined, now);
  const last = samples[samples.length - 1];
  if (!last) return;
  const r = getDetector().evaluate(last, samples);
  st.setDetection({ level: r.level, reasons: r.reasons });
  if (r.level === 'none') return;
  if (now - clearedAt < config.detection.cooldownMs) return; // operator just cleared it
  const byRule = Object.fromEntries(r.rules.map((id, i) => [id, r.reasons[i]]));
  const changed = st.raiseAlert('detection', r.level, byRule, now);
  if (changed) {
    st.logEvent({
      t: now,
      kind: 'detection',
      message: `${r.level === 'drowning' ? 'Drowning detected' : 'Possible drowning'} (${getDetector().name}): ${r.reasons.join('; ')}`,
      ...vitals(p),
    });
  }
}

/** Wire the alert pipeline to incoming packets. Returns an unsubscribe function. */
export function initAlerts(): () => void {
  return onPacket(handlePacket);
}

export function acknowledgeAlert(): void {
  const st = useStore.getState();
  if (!st.alert || st.alert.acknowledged) return;
  st.acknowledgeAlert();
  st.logEvent({ kind: 'info', message: 'Alert acknowledged (alarm silenced)' });
}

export function clearAlert(): void {
  const st = useStore.getState();
  if (!st.alert) return;
  clearedAt = Date.now();
  getDetector().reset();
  st.clearAlert();
  st.logEvent({ kind: 'info', message: 'Alert cleared by operator' });
}
