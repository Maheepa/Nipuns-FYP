import type { ReactNode } from 'react';
import { distanceM } from '../geo';
import { clock, metres } from '../format';
import { useNow } from '../hooks/useNow';
import { acknowledgeAlert, clearAlert } from '../services/alerts';
import { useStore, validBpm } from '../store/useStore';
import type { RescueStage } from '../types';

const STEPS: { stage: RescueStage; label: string }[] = [
  { stage: 'alert', label: 'Alert' },
  { stage: 'dispatched', label: 'Drone dispatched' },
  { stage: 'enroute', label: 'En route' },
  { stage: 'ontarget', label: 'On target' },
  { stage: 'delivered', label: 'Life ring delivered' },
  { stage: 'returning', label: 'Returning' },
];
// 'released' is shown as part of the "delivered" step.
const ORDER: RescueStage[] = ['idle', 'alert', 'dispatched', 'enroute', 'ontarget', 'released', 'delivered', 'returning'];

function since(t: number, now: number) {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  /** Rescue / drone buttons, rendered on the right of the banner. */
  actions?: ReactNode;
}

/** Full-width alert banner with the rescue progress, shown during an alert or an active rescue. */
export function AlertBanner({ actions }: Props) {
  const now = useNow(500);
  const alert = useStore((s) => s.alert);
  const rescue = useStore((s) => s.rescue);
  const base = useStore((s) => s.settings.baseStation);
  const watchPos = useStore((s) => s.watch.position);
  const stale = useStore((s) => s.watch.positionStale);
  const latest = useStore((s) => s.watch.latest);
  const drone = useStore((s) => s.drone);
  const onTargetM = useStore((s) => s.settings.rescue.onTargetRadiusM);

  if (!alert && rescue.stage === 'idle') return null;

  const level = alert?.level ?? 'drowning';
  const title = !alert
    ? 'RESCUE IN PROGRESS'
    : alert.level === 'drowning'
      ? alert.source === 'button'
        ? 'DROWNING ALERT · emergency button'
        : 'DROWNING DETECTED · automatic'
      : 'POSSIBLE DROWNING · automatic detection';

  const bpm = latest ? validBpm(latest) : null;
  const target = rescue.target ?? watchPos;
  const droneToTarget = drone.position && target ? distanceM(drone.position, target) : null;
  const stageIdx = ORDER.indexOf(rescue.stage === 'released' ? 'delivered' : rescue.stage);

  return (
    <div className={`alert-banner ${level} ${alert && !alert.acknowledged ? 'flash' : ''}`} role="alert">
      <div className="ab-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="42" height="42">
          <circle cx="24" cy="24" r="15" fill="none" stroke="#fff" strokeWidth="8" />
          <circle cx="24" cy="24" r="15" fill="none" stroke="#ff6b1a" strokeWidth="8" strokeDasharray="11.8 11.8" />
        </svg>
      </div>

      <div className="ab-main">
        <div className="ab-title">
          {title}
          {alert && <span className="ab-timer">{since(alert.startedAt, now)}</span>}
          {alert?.acknowledged && <span className="ab-ack">ACKNOWLEDGED</span>}
        </div>
        <div className="ab-sub">
          {alert ? `Started ${clock(alert.startedAt)} · ${Object.values(alert.reasons).join(' · ')}` : 'Alert cleared — drone still on mission'}
        </div>
      </div>

      <div className="ab-info">
        <div>
          <span className="k">Victim</span>
          {watchPos ? (
            <b className="mono">
              {watchPos.lat.toFixed(6)}, {watchPos.lng.toFixed(6)}
            </b>
          ) : (
            <b>no GPS fix yet</b>
          )}
          {watchPos && stale && <span className="ab-stale">last known</span>}
        </div>
        <div>
          <span className="k">From base</span>
          <b>{watchPos ? metres(distanceM(base, watchPos)) : '—'}</b>
          <span className="k">BPM</span>
          <b>{bpm != null ? Math.round(bpm) : '—'}</b>
          {droneToTarget != null && rescue.stage !== 'idle' && rescue.stage !== 'alert' && (
            <>
              <span className="k">Drone → victim</span>
              <b>{metres(droneToTarget)}</b>
            </>
          )}
        </div>
      </div>

      <ol className="ab-steps">
        {STEPS.map((s) => {
          const i = ORDER.indexOf(s.stage);
          const cls = i < stageIdx ? 'done' : i === stageIdx ? 'current' : '';
          const label =
            s.stage === 'enroute' && rescue.stage === 'enroute' && droneToTarget != null
              ? `En route · ${metres(droneToTarget)}`
              : s.stage === 'ontarget'
                ? `On target (≤${onTargetM} m)`
                : s.label;
          return (
            <li key={s.stage} className={cls}>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="ab-actions">
        {actions}
        {alert && !alert.acknowledged && (
          <button className="ab-btn ack" onClick={acknowledgeAlert}>
            Acknowledge
          </button>
        )}
        {alert && (
          <button className="ab-btn clear" onClick={clearAlert}>
            Clear alert
          </button>
        )}
      </div>
    </div>
  );
}
