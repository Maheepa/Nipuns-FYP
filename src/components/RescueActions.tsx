import { distanceM } from '../geo';
import { metres } from '../format';
import { dispatchDrone, finishRescue, releaseRing, returnToLaunch, targetProblem, updateTarget } from '../services/rescue';
import { live } from '../store/live';
import { useFrame } from '../store/ticker';
import { useStore } from '../store/useStore';
import { askConfirm } from '../store/useUi';
import type { LatLng } from '../config';

function TargetDetails({ target }: { target: LatLng }) {
  const st = useStore.getState();
  const base = st.settings.baseStation;
  const drone = live.drone;
  const { altitudeM, maxDistanceFromHomeM } = st.settings.rescue;
  return (
    <table className="kv">
      <tbody>
        <tr>
          <th>Target</th>
          <td className="mono">
            {target.lat.toFixed(7)}, {target.lng.toFixed(7)}
          </td>
        </tr>
        <tr>
          <th>From base station</th>
          <td>
            {metres(distanceM(base, target))} (limit {metres(maxDistanceFromHomeM)})
          </td>
        </tr>
        <tr>
          <th>From drone</th>
          <td>{drone.position ? metres(distanceM(drone.position, target)) : 'drone position unknown'}</td>
        </tr>
        <tr>
          <th>Altitude</th>
          <td>{altitudeM} m above home</td>
        </tr>
        <tr>
          <th>Drone now</th>
          <td>
            {drone.lastMsgAt ? `${drone.armed ? 'ARMED' : 'DISARMED'} · ${drone.mode} · alt ${drone.relAltM?.toFixed(1) ?? '—'} m` : 'no telemetry'}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Rescue buttons inside the alert banner; which ones show depends on the rescue stage. */
export function RescueActions() {
  const stage = useStore((s) => s.rescue.stage);
  const target = useStore((s) => s.rescue.target);
  useFrame(2);
  const victim = live.watch.position;
  const radius = useStore((s) => s.settings.rescue.onTargetRadiusM);
  const drone = live.drone;

  const onDispatch = async () => {
    const v = live.watch.position;
    const problem = targetProblem(v);
    const d = live.drone;
    const grounded = !d.armed || (d.relAltM ?? 0) < 1.5;
    const ok = await askConfirm({
      title: 'Dispatch drone to victim?',
      confirmLabel: 'Dispatch drone',
      tone: 'danger',
      body: (
        <>
          {v && <TargetDetails target={v} />}
          {problem && <p className="warn-text">⚠ {problem} The command will be refused.</p>}
          <p>
            Sends <b>SET_MODE GUIDED</b> then a <b>GUIDED go-to</b> (MISSION_ITEM, current=2).
          </p>
          {grounded && (
            <p className="warn-text">
              ⚠ The drone is not airborne. It will not fly until you arm it and take off (Drone controls on the map) — this
              app never arms automatically.
            </p>
          )}
        </>
      ),
    });
    if (ok && v) await dispatchDrone(v);
  };

  const onUpdate = async () => {
    const v = live.watch.position;
    if (!v) return;
    if (await askConfirm({ title: 'Send the drone to the swimmer\'s new position?', confirmLabel: 'Update target', body: <TargetDetails target={v} /> }))
      await updateTarget(v);
  };

  const onRelease = async () => {
    const { releaseServoChannel, releasePwm } = useStore.getState().settings.rescue;
    if (
      await askConfirm({
        title: 'Release the life ring?',
        confirmLabel: 'Release life ring',
        tone: 'danger',
        body: (
          <p>
            Sends <b>DO_SET_SERVO</b> channel {releaseServoChannel} → {releasePwm} µs. Make sure the drone is directly over the
            swimmer.
          </p>
        ),
      })
    )
      await releaseRing();
  };

  const onRtl = async () => {
    if (await askConfirm({ title: 'Return to launch?', confirmLabel: 'Return to launch', body: <p>Sends <b>NAV_RETURN_TO_LAUNCH</b>. The drone climbs to its RTL altitude, flies home and lands.</p> }))
      await returnToLaunch();
  };

  const drift = target && victim ? distanceM(target, victim) : 0;

  return (
    <>
      {stage === 'alert' && (
        <button className="ab-btn primary" onClick={onDispatch}>
          🚁 Dispatch drone to victim
        </button>
      )}
      {(stage === 'dispatched' || stage === 'enroute' || stage === 'ontarget') && drift > radius * 2 && (
        <button className="ab-btn" onClick={onUpdate} title={`Swimmer moved ${metres(drift)} since dispatch`}>
          Update target ({metres(drift)})
        </button>
      )}
      {(stage === 'ontarget' || stage === 'enroute' || stage === 'dispatched') && (
        // Only enabled once the drone is within the arrive radius of the target.
        <span className="tip-wrap" title={stage === 'ontarget' ? 'Drop the life ring now' : `Enabled when the drone is within ${radius} m of the target`}>
          <button className={`ab-btn ${stage === 'ontarget' ? 'primary' : ''}`} onClick={onRelease} disabled={stage !== 'ontarget'}>
            🛟 Release life ring
          </button>
        </span>
      )}
      {stage !== 'alert' && stage !== 'idle' && stage !== 'returning' && (
        <button className={`ab-btn ${stage === 'delivered' ? 'primary' : ''}`} onClick={onRtl}>
          ↩ Return to launch
        </button>
      )}
      {(stage === 'returning' || stage === 'delivered') && (
        <button className="ab-btn" onClick={() => finishRescue()} title={drone.armed ? 'Drone still armed' : ''}>
          Finish rescue
        </button>
      )}
    </>
  );
}
