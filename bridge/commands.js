// Translates UI drone commands into ArduCopter 3.2-compatible MAVLink v1 frames,
// after server-side safety checks. Pure functions — no sockets — so they are unit tested.

import { encodeV1 } from './mavlink.js';

export const COPTER_MODES = {
  STABILIZE: 0, ACRO: 1, ALT_HOLD: 2, AUTO: 3, GUIDED: 4, LOITER: 5, RTL: 6, CIRCLE: 7,
  LAND: 9, DRIFT: 11, SPORT: 13, FLIP: 14, AUTOTUNE: 15, POSHOLD: 16,
};
export const MODE_NAMES = Object.fromEntries(Object.entries(COPTER_MODES).map(([k, v]) => [v, k]));

const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
const MAV_CMD = {
  NAV_WAYPOINT: 16,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_TAKEOFF: 22,
  DO_SET_SERVO: 183,
  COMPONENT_ARM_DISARM: 400,
};

export const MAV_RESULT = ['ACCEPTED', 'TEMPORARILY_REJECTED', 'DENIED', 'UNSUPPORTED', 'FAILED', 'IN_PROGRESS'];
export const MAV_MISSION_RESULT = [
  'ACCEPTED', 'ERROR', 'UNSUPPORTED_FRAME', 'UNSUPPORTED', 'NO_SPACE', 'INVALID', 'INVALID_PARAM1', 'INVALID_PARAM2',
  'INVALID_PARAM3', 'INVALID_PARAM4', 'INVALID_PARAM5_X', 'INVALID_PARAM6_Y', 'INVALID_PARAM7', 'INVALID_SEQUENCE', 'DENIED',
];

/** Hard limits the bridge enforces no matter what the UI sends. */
export const LIMITS = {
  minAltM: 2,
  maxAltM: 40,
  maxDistanceFromHomeM: 1000, // absolute ceiling; the UI's (smaller) setting is also applied
  servoChannelMin: 1,
  servoChannelMax: 16,
  pwmMin: 800,
  pwmMax: 2200,
};

export function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const finite = (...xs) => xs.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * Validate a command and build its frame.
 * @param {object} cmd      DroneCommand from the UI
 * @param {{sysid:number, compid:number}} target  vehicle ids learned from its HEARTBEAT
 * @param {{home?: {lat:number,lng:number}, maxDistanceFromHomeM?: number}} limits
 * @param {{sysid:number, compid:number}} self    our MAVLink ids
 * @returns {{ok:true, frame:Uint8Array, summary:string, ackFor:number|'mission'|null} | {ok:false, error:string}}
 */
export function buildCommand(cmd, target, limits = {}, self = { sysid: 254, compid: 190 }) {
  if (!cmd || typeof cmd.type !== 'string') return { ok: false, error: 'malformed command' };
  if (!target || !finite(target.sysid, target.compid)) return { ok: false, error: 'no vehicle heartbeat seen yet' };
  const ts = target.sysid;
  const tc = target.compid;
  const hdr = { sysid: self.sysid, compid: self.compid };
  const long = (command, p = []) =>
    encodeV1(
      'COMMAND_LONG',
      {
        target_system: ts, target_component: tc, command, confirmation: 0,
        param1: p[0] ?? 0, param2: p[1] ?? 0, param3: p[2] ?? 0, param4: p[3] ?? 0, param5: p[4] ?? 0, param6: p[5] ?? 0, param7: p[6] ?? 0,
      },
      hdr,
    );

  switch (cmd.type) {
    case 'setMode': {
      const mode = COPTER_MODES[cmd.mode];
      if (mode == null) return { ok: false, error: `unknown mode ${cmd.mode}` };
      // SET_MODE is the message ArduCopter 3.2 handles for mode changes.
      const frame = encodeV1('SET_MODE', { target_system: ts, base_mode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, custom_mode: mode }, hdr);
      return { ok: true, frame, summary: `SET_MODE ${cmd.mode} (${mode})`, ackFor: null };
    }
    case 'arm':
      return { ok: true, frame: long(MAV_CMD.COMPONENT_ARM_DISARM, [1]), summary: 'COMMAND_LONG ARM', ackFor: MAV_CMD.COMPONENT_ARM_DISARM };
    case 'disarm':
      return { ok: true, frame: long(MAV_CMD.COMPONENT_ARM_DISARM, [0]), summary: 'COMMAND_LONG DISARM', ackFor: MAV_CMD.COMPONENT_ARM_DISARM };
    case 'takeoff': {
      if (!finite(cmd.altM) || cmd.altM < LIMITS.minAltM || cmd.altM > LIMITS.maxAltM)
        return { ok: false, error: `takeoff altitude must be ${LIMITS.minAltM}–${LIMITS.maxAltM} m` };
      return { ok: true, frame: long(MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, cmd.altM]), summary: `COMMAND_LONG NAV_TAKEOFF ${cmd.altM} m`, ackFor: MAV_CMD.NAV_TAKEOFF };
    }
    case 'goto': {
      if (!finite(cmd.lat, cmd.lng, cmd.altM)) return { ok: false, error: 'go-to needs numeric lat, lng and altitude' };
      if (Math.abs(cmd.lat) > 90 || Math.abs(cmd.lng) > 180 || (cmd.lat === 0 && cmd.lng === 0))
        return { ok: false, error: 'go-to position is invalid' };
      if (cmd.altM < LIMITS.minAltM || cmd.altM > LIMITS.maxAltM)
        return { ok: false, error: `altitude must be ${LIMITS.minAltM}–${LIMITS.maxAltM} m` };
      const home = limits.home;
      if (!home || !finite(home.lat, home.lng)) return { ok: false, error: 'no home / base-station position to check the distance against' };
      const max = Math.min(LIMITS.maxDistanceFromHomeM, finite(limits.maxDistanceFromHomeM) ? limits.maxDistanceFromHomeM : Infinity);
      const d = distanceM(home, { lat: cmd.lat, lng: cmd.lng });
      if (d > max) return { ok: false, error: `target is ${Math.round(d)} m from home, limit is ${Math.round(max)} m` };
      // GUIDED go-to for Copter 3.2: MISSION_ITEM with current = 2.
      const frame = encodeV1(
        'MISSION_ITEM',
        {
          target_system: ts, target_component: tc, seq: 0, frame: MAV_FRAME_GLOBAL_RELATIVE_ALT, command: MAV_CMD.NAV_WAYPOINT,
          current: 2, autocontinue: 0, param1: 0, param2: 0, param3: 0, param4: 0, x: cmd.lat, y: cmd.lng, z: cmd.altM,
        },
        hdr,
      );
      return { ok: true, frame, summary: `MISSION_ITEM(current=2) ${cmd.lat.toFixed(7)},${cmd.lng.toFixed(7)} @${cmd.altM} m (${Math.round(d)} m from home)`, ackFor: 'mission' };
    }
    case 'servo': {
      if (!Number.isInteger(cmd.channel) || cmd.channel < LIMITS.servoChannelMin || cmd.channel > LIMITS.servoChannelMax)
        return { ok: false, error: `servo channel must be ${LIMITS.servoChannelMin}–${LIMITS.servoChannelMax}` };
      if (!Number.isInteger(cmd.pwm) || cmd.pwm < LIMITS.pwmMin || cmd.pwm > LIMITS.pwmMax)
        return { ok: false, error: `PWM must be ${LIMITS.pwmMin}–${LIMITS.pwmMax} µs` };
      return { ok: true, frame: long(MAV_CMD.DO_SET_SERVO, [cmd.channel, cmd.pwm]), summary: `COMMAND_LONG DO_SET_SERVO ch${cmd.channel}=${cmd.pwm}`, ackFor: MAV_CMD.DO_SET_SERVO };
    }
    case 'rtl':
      return { ok: true, frame: long(MAV_CMD.NAV_RETURN_TO_LAUNCH), summary: 'COMMAND_LONG NAV_RETURN_TO_LAUNCH', ackFor: MAV_CMD.NAV_RETURN_TO_LAUNCH };
    default:
      return { ok: false, error: `unknown command ${cmd.type}` };
  }
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
