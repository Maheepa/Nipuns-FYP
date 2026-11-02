import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The services use window timers; in the node test environment window = globalThis.
beforeAll(() => {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
});

import { destination, distanceM } from '../geo';
import { live } from '../store/live';
import { useStore } from '../store/useStore';
import { startDroneSim, stopDroneSim } from './droneSim';
import { dispatchDrone, initRescueTracker, releaseRing, returnToLaunch, runCommands } from './rescue';

const st = () => useStore.getState();

describe('rescue flow against the simulated drone', () => {
  let stopTracker: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState((s) => ({
      settings: { ...s.settings, simulate: true, dryRun: false },
      events: [],
      alert: null,
      rescue: { stage: 'idle', target: null, dispatchedAt: null, stageAt: null },
    }));
    startDroneSim();
    stopTracker = initRescueTracker();
  });

  afterEach(() => {
    stopTracker();
    stopDroneSim();
    vi.useRealTimers();
  });

  it('dry-run never moves the drone', async () => {
    useStore.setState((s) => ({ settings: { ...s.settings, dryRun: true } }));
    expect(await runCommands('Test', [{ type: 'setMode', mode: 'GUIDED' }, { type: 'arm' }])).toBe('dry-run');
    vi.advanceTimersByTime(1000);
    expect(live.drone.armed).toBe(false);
    expect(live.drone.mode).toBe('STABILIZE');
    expect(st().events.filter((e) => e.kind === 'dry-run')).toHaveLength(2);
  });

  it('refuses a victim beyond the max distance', async () => {
    const far = destination(st().settings.baseStation, 90, st().settings.rescue.maxDistanceFromHomeM + 50);
    st().raiseAlert('button', 'drowning', { button: 'x' });
    await dispatchDrone(far);
    expect(st().rescue.stage).toBe('alert');
    expect(st().events.some((e) => e.kind === 'error' && /beyond/.test(e.message))).toBe(true);
  });

  it('goes alert → dispatched → en route → on target → delivered → returning → done', async () => {
    const victim = destination(st().settings.baseStation, 45, 80);
    st().raiseAlert('button', 'drowning', { button: 'Emergency button pressed' });
    expect(st().rescue.stage).toBe('alert');

    // Operator arms and takes off explicitly — nothing arms automatically.
    await runCommands('Prep', [{ type: 'setMode', mode: 'GUIDED' }, { type: 'arm' }, { type: 'takeoff', altM: 10 }]);
    vi.advanceTimersByTime(6000);
    expect(live.drone.armed).toBe(true);
    expect(live.drone.relAltM).toBeGreaterThan(9);

    await dispatchDrone(victim);
    expect(st().rescue.stage).toBe('dispatched');
    vi.advanceTimersByTime(2000);
    expect(st().rescue.stage).toBe('enroute');

    vi.advanceTimersByTime(15000);
    expect(st().rescue.stage).toBe('ontarget');
    expect(distanceM(live.drone.position!, victim)).toBeLessThanOrEqual(st().settings.rescue.onTargetRadiusM);

    await releaseRing();
    expect(st().rescue.stage).toBe('delivered');

    await returnToLaunch();
    expect(st().rescue.stage).toBe('returning');
    vi.advanceTimersByTime(40000);
    expect(live.drone.armed).toBe(false);
    expect(st().rescue.stage).toBe('alert'); // rescue finished; the alert itself is still open until cleared
    expect(st().events.map((e) => e.message).join('\n')).toMatch(/rescue complete/);
  });
});
