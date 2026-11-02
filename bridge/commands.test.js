import { describe, expect, it } from 'vitest';
import { buildCommand } from './commands.js';
import { MavlinkParser } from './mavlink.js';

const vehicle = { sysid: 1, compid: 1 };
const home = { lat: 6.8122982, lng: 79.8907368 };
const decode = (r) => new MavlinkParser().push(r.frame)[0];

describe('buildCommand', () => {
  it('SET_MODE GUIDED uses custom_mode 4 with the custom-mode flag', () => {
    const m = decode(buildCommand({ type: 'setMode', mode: 'GUIDED' }, vehicle));
    expect(m.name).toBe('SET_MODE');
    expect(m.fields).toEqual({ custom_mode: 4, target_system: 1, base_mode: 1 });
    expect(m.sysid).toBe(254);
  });

  it('GUIDED go-to is a MISSION_ITEM with current=2 in the relative-alt frame', () => {
    const r = buildCommand({ type: 'goto', lat: 6.8125, lng: 79.8909, altM: 10 }, vehicle, { home, maxDistanceFromHomeM: 300 });
    expect(r.ok).toBe(true);
    const m = decode(r);
    expect(m.name).toBe('MISSION_ITEM');
    expect(m.fields).toMatchObject({ current: 2, frame: 3, command: 16, seq: 0, autocontinue: 0, z: 10, target_system: 1, target_component: 1 });
  });

  it('refuses a target beyond the max distance from home', () => {
    const r = buildCommand({ type: 'goto', lat: 6.83, lng: 79.8907368, altM: 10 }, vehicle, { home, maxDistanceFromHomeM: 300 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/limit is 300 m/);
  });

  it('refuses go-to without a home position, bad altitude or 0,0', () => {
    expect(buildCommand({ type: 'goto', lat: 6.8125, lng: 79.8909, altM: 10 }, vehicle, {}).ok).toBe(false);
    expect(buildCommand({ type: 'goto', lat: 6.8125, lng: 79.8909, altM: 100 }, vehicle, { home }).ok).toBe(false);
    expect(buildCommand({ type: 'goto', lat: 0, lng: 0, altM: 10 }, vehicle, { home }).ok).toBe(false);
  });

  it('arm / disarm / takeoff / RTL / servo are COMMAND_LONGs with the right ids and params', () => {
    expect(decode(buildCommand({ type: 'arm' }, vehicle)).fields).toMatchObject({ command: 400, param1: 1 });
    expect(decode(buildCommand({ type: 'disarm' }, vehicle)).fields).toMatchObject({ command: 400, param1: 0 });
    expect(decode(buildCommand({ type: 'takeoff', altM: 10 }, vehicle)).fields).toMatchObject({ command: 22, param7: 10 });
    expect(decode(buildCommand({ type: 'rtl' }, vehicle)).fields).toMatchObject({ command: 20 });
    expect(decode(buildCommand({ type: 'servo', channel: 9, pwm: 1900 }, vehicle)).fields).toMatchObject({ command: 183, param1: 9, param2: 1900 });
  });

  it('validates servo channel and PWM', () => {
    expect(buildCommand({ type: 'servo', channel: 0, pwm: 1900 }, vehicle).ok).toBe(false);
    expect(buildCommand({ type: 'servo', channel: 9, pwm: 3000 }, vehicle).ok).toBe(false);
  });

  it('refuses everything before a vehicle heartbeat', () => {
    expect(buildCommand({ type: 'arm' }, null)).toEqual({ ok: false, error: 'no vehicle heartbeat seen yet' });
  });
});
