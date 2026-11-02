// Drone command vocabulary shared by the UI, the simulator and the bridge protocol.
// The bridge translates these into ArduCopter 3.2-compatible MAVLink v1 messages.

export type FlightMode = 'STABILIZE' | 'ALT_HOLD' | 'AUTO' | 'GUIDED' | 'LOITER' | 'RTL' | 'LAND';

/** ArduCopter custom_mode numbers (unchanged since 3.x). */
export const COPTER_MODES: Record<number, FlightMode | string> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  7: 'CIRCLE',
  9: 'LAND',
  11: 'DRIFT',
  13: 'SPORT',
  14: 'FLIP',
  15: 'AUTOTUNE',
  16: 'POSHOLD',
};

export type DroneCommand =
  | { type: 'setMode'; mode: FlightMode }
  | { type: 'arm' }
  | { type: 'disarm' }
  | { type: 'takeoff'; altM: number }
  | { type: 'goto'; lat: number; lng: number; altM: number }
  | { type: 'servo'; channel: number; pwm: number }
  | { type: 'rtl' };

export function describeCommand(c: DroneCommand): string {
  switch (c.type) {
    case 'setMode':
      return `SET_MODE ${c.mode}`;
    case 'arm':
      return 'ARM motors';
    case 'disarm':
      return 'DISARM motors';
    case 'takeoff':
      return `TAKEOFF to ${c.altM} m`;
    case 'goto':
      return `GUIDED go-to ${c.lat.toFixed(7)}, ${c.lng.toFixed(7)} @ ${c.altM} m`;
    case 'servo':
      return `SET_SERVO ch${c.channel} = ${c.pwm} µs`;
    case 'rtl':
      return 'RETURN TO LAUNCH';
  }
}
