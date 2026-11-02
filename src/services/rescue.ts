// Drone commands and the rescue flow.
//
// Safety rules implemented here (the bridge re-checks the distance limit and dry-run):
//  - every command goes through a confirmation dialog in the UI before it reaches this module
//  - dry-run (ON by default) logs commands but sends nothing
//  - targets farther than maxDistanceFromHomeM from the base station are refused
//  - nothing ever arms the drone automatically; arming is its own explicit, confirmed action
//  - in Simulate mode commands go to the simulated drone, never to the bridge

import type { LatLng } from '../config';
import { distanceM } from '../geo';
import { metres } from '../format';
import { live, onDroneUpdate } from '../store/live';
import { useStore } from '../store/useStore';
import { toast } from '../store/useUi';
import { describeCommand, type DroneCommand } from './droneCommands';
import { simDroneCommand } from './droneSim';
import { onAck, sendToBridge } from './droneSocket';

export type RunOutcome = 'sent' | 'dry-run' | 'failed';

/** Run commands in order; stops at the first failure. */
export async function runCommands(label: string, cmds: DroneCommand[]): Promise<RunOutcome> {
  const st = useStore.getState();
  const { dryRun, simulate, baseStation, rescue } = st.settings;
  const prefix = simulate ? '[SIM] ' : '';

  for (const cmd of cmds) {
    const text = describeCommand(cmd);
    if (dryRun) {
      // Still ask the bridge to validate and encode it, so dry-run exercises the real path.
      if (!simulate) {
        const r = await sendToBridge(cmd, { dryRun: true, home: baseStation, maxDistanceFromHomeM: rescue.maxDistanceFromHomeM });
        if (!r.ok && r.error !== 'bridge not connected') {
          st.logEvent({ kind: 'error', message: `${label}: ${text} REFUSED by bridge: ${r.error}` });
          toast(`Refused: ${r.error}`, 'error', 8000);
          return 'failed';
        }
        st.logEvent({ kind: 'dry-run', message: `${label}: ${text} (not sent)${r.hex ? ` · ${r.hex}` : ''}` });
      } else {
        st.logEvent({ kind: 'dry-run', message: `${prefix}${label}: ${text} (not sent)` });
      }
      continue;
    }

    if (simulate) {
      const err = simDroneCommand(cmd);
      if (err) {
        st.logEvent({ kind: 'error', message: `${prefix}${label}: ${text} failed: ${err}` });
        toast(err, 'error', 8000);
        return 'failed';
      }
      st.logEvent({ kind: 'command', message: `${prefix}${label}: ${text}` });
      continue;
    }

    const r = await sendToBridge(cmd, { dryRun: false, home: baseStation, maxDistanceFromHomeM: rescue.maxDistanceFromHomeM });
    if (!r.ok || !r.sent) {
      st.logEvent({ kind: 'error', message: `${label}: ${text} NOT sent: ${r.error ?? 'unknown error'}` });
      toast(`Not sent: ${r.error ?? 'unknown error'}`, 'error', 8000);
      return 'failed';
    }
    st.logEvent({ kind: 'command', message: `${label}: SENT ${r.summary ?? text}` });
  }

  if (dryRun) {
    toast(`DRY-RUN — ${label} logged, nothing sent to the drone`, 'warn');
    return 'dry-run';
  }
  toast(`${label}: sent`, 'ok');
  return 'sent';
}

/** Why a go-to target cannot be used, or null when it is fine. */
export function targetProblem(target: LatLng | null): string | null {
  if (!target) return 'The swimmer has no GPS position yet.';
  const st = useStore.getState();
  const d = distanceM(st.settings.baseStation, target);
  const max = st.settings.rescue.maxDistanceFromHomeM;
  if (d > max) return `Victim is ${metres(d)} from the base station — beyond the ${metres(max)} limit.`;
  return null;
}

// ------------------------------------------------------------------ rescue actions

export async function dispatchDrone(target: LatLng): Promise<void> {
  const problem = targetProblem(target);
  if (problem) {
    toast(problem, 'error', 8000);
    useStore.getState().logEvent({ kind: 'error', message: `Dispatch refused: ${problem}` });
    return;
  }
  const alt = useStore.getState().settings.rescue.altitudeM;
  const outcome = await runCommands('Dispatch', [
    { type: 'setMode', mode: 'GUIDED' },
    { type: 'goto', lat: target.lat, lng: target.lng, altM: alt },
  ]);
  if (outcome === 'sent') {
    const st = useStore.getState();
    st.setRescue({ stage: 'dispatched', target, dispatchedAt: Date.now() });
    st.logEvent({ kind: 'rescue', message: `Drone dispatched to ${target.lat.toFixed(7)}, ${target.lng.toFixed(7)} at ${alt} m`, lat: target.lat, lng: target.lng });
  }
}

/** Re-send the go-to when the swimmer has drifted from the original target. */
export async function updateTarget(target: LatLng): Promise<void> {
  const problem = targetProblem(target);
  if (problem) {
    toast(problem, 'error', 8000);
    return;
  }
  const alt = useStore.getState().settings.rescue.altitudeM;
  const outcome = await runCommands('Update target', [{ type: 'goto', lat: target.lat, lng: target.lng, altM: alt }]);
  if (outcome === 'sent') {
    const st = useStore.getState();
    st.setRescue({ target, stage: st.rescue.stage === 'ontarget' ? 'enroute' : st.rescue.stage });
    st.logEvent({ kind: 'rescue', message: 'Rescue target updated to the swimmer\'s latest position', lat: target.lat, lng: target.lng });
  }
}

export async function releaseRing(): Promise<void> {
  const { releaseServoChannel, releasePwm } = useStore.getState().settings.rescue;
  const outcome = await runCommands('Release life ring', [{ type: 'servo', channel: releaseServoChannel, pwm: releasePwm }]);
  if (outcome === 'sent') {
    const st = useStore.getState();
    st.setRescue({ stage: 'delivered' });
    st.logEvent({ kind: 'rescue', message: 'Life ring released', lat: live.drone.position?.lat, lng: live.drone.position?.lng });
  }
}

export async function returnToLaunch(): Promise<void> {
  const outcome = await runCommands('Return to launch', [{ type: 'rtl' }]);
  if (outcome === 'sent') {
    const st = useStore.getState();
    if (st.rescue.stage !== 'idle') st.setRescue({ stage: 'returning' });
    st.logEvent({ kind: 'rescue', message: 'Drone returning to launch' });
  }
}

export function finishRescue(reason = 'Rescue closed by operator'): void {
  const st = useStore.getState();
  st.setRescue({ stage: st.alert ? 'alert' : 'idle', target: null, dispatchedAt: null });
  st.logEvent({ kind: 'rescue', message: reason });
}

// ------------------------------------------------------------------ progress tracking

/**
 * Advances the rescue stage from drone telemetry:
 * dispatched → en route (moving) → on target (within radius) and returning → done (landed & disarmed).
 * Returns an unsubscribe function.
 */
export function initRescueTracker(): () => void {
  let startDist: number | null = null;
  const unsubDrone = onDroneUpdate((drone, prev) => {
    const s = useStore.getState();
    const { stage, target } = s.rescue;
    const pos = drone.position;
    if (!pos) return;

    if ((stage === 'dispatched' || stage === 'enroute') && target) {
      const d = distanceM(pos, target);
      if (stage === 'dispatched') startDist ??= d;
      if (d <= s.settings.rescue.onTargetRadiusM && (drone.relAltM ?? 0) > 1) {
        s.setRescue({ stage: 'ontarget' });
        s.logEvent({ kind: 'rescue', message: `Drone on target (${metres(d)} from victim)`, lat: pos.lat, lng: pos.lng });
        toast('Drone is over the victim — release the life ring', 'ok', 8000);
        startDist = null;
      } else if (stage === 'dispatched' && ((drone.groundSpeed ?? 0) > 1 || (startDist != null && startDist - d > 3))) {
        s.setRescue({ stage: 'enroute' });
        s.logEvent({ kind: 'rescue', message: `Drone en route, ${metres(d)} to go` });
      }
    }

    if (stage === 'returning' && prev.armed && !drone.armed) {
      finishRescue('Drone landed and disarmed — rescue complete');
    }
  });

  // Command acknowledgements from the autopilot (real drone only).
  const unsubAck = onAck((a) => {
    const ok = a.result === 'ACCEPTED';
    const what = a.kind === 'mission' ? 'Go-to (MISSION_ITEM)' : `Command ${a.command}`;
    useStore.getState().logEvent({ kind: ok ? 'command' : 'error', message: `Drone ACK: ${what} → ${a.result}` });
    if (!ok) toast(`Drone rejected ${what}: ${a.result}`, 'error', 10000);
  });

  return () => {
    unsubDrone();
    unsubAck();
  };
}
