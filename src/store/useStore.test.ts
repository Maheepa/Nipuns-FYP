import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore';

describe('alert state', () => {
  beforeEach(() => useStore.setState({ alert: null, rescue: { stage: 'idle', target: null, dispatchedAt: null, stageAt: null } }));

  it('raises, refreshes text without re-raising, and escalates', () => {
    const st = () => useStore.getState();
    expect(st().raiseAlert('detection', 'warning', { gyro: 'Erratic 3/5' })).toBe(true);
    expect(st().rescue.stage).toBe('alert');
    st().acknowledgeAlert();

    // same rule, new numbers → text refreshed, still acknowledged, no change reported
    expect(st().raiseAlert('detection', 'warning', { gyro: 'Erratic 4/5' })).toBe(false);
    expect(st().alert!.reasons).toEqual({ gyro: 'Erratic 4/5' });
    expect(st().alert!.acknowledged).toBe(true);

    // emergency button escalates and re-sounds the alarm
    expect(st().raiseAlert('button', 'drowning', { button: 'pressed' })).toBe(true);
    expect(st().alert).toMatchObject({ level: 'drowning', source: 'button', acknowledged: false });
    expect(Object.keys(st().alert!.reasons)).toEqual(['gyro', 'button']);

    // a later warning never downgrades
    st().raiseAlert('detection', 'warning', { bpm: 'High' });
    expect(st().alert!.level).toBe('drowning');
  });

  it('clearing before dispatch ends the rescue; after dispatch it stays', () => {
    const st = () => useStore.getState();
    st().raiseAlert('button', 'drowning', { button: 'x' });
    st().clearAlert();
    expect(st().rescue.stage).toBe('idle');

    st().raiseAlert('button', 'drowning', { button: 'x' });
    st().setRescue({ stage: 'dispatched' });
    st().clearAlert();
    expect(st().alert).toBeNull();
    expect(st().rescue.stage).toBe('dispatched');
  });
});
