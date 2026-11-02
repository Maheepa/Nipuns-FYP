// Stands in for "Mission Planner MAVLink mirror + APM" so the bridge can be tested on a
// laptop with no drone: streams ArduCopter-like telemetry to the bridge over UDP and
// prints every command the bridge sends back.
//
//   node bridge/fake-vehicle.js            (start the bridge first: npm run dev:bridge)

import dgram from 'node:dgram';
import { MavlinkParser, encodeV1 } from './mavlink.js';

const BRIDGE = { host: '127.0.0.1', port: Number(process.env.BRIDGE_UDP_PORT ?? 14550) };
const HOME = { lat: 6.8122982, lng: 79.8907368 };
const sock = dgram.createSocket('udp4');
const parser = new MavlinkParser();
const hdr = { sysid: 1, compid: 1 };
const send = (name, fields) => sock.send(encodeV1(name, fields, hdr), BRIDGE.port, BRIDGE.host);

let mode = 0; // STABILIZE
let armed = false;
let t = 0;

sock.on('message', (buf) => {
  for (const m of parser.push(new Uint8Array(buf))) {
    console.log(`<- ${m.name} from ${m.sysid}/${m.compid}`, m.fields);
    if (m.name === 'SET_MODE') mode = m.fields.custom_mode;
    if (m.name === 'COMMAND_LONG') {
      if (m.fields.command === 400) armed = m.fields.param1 === 1;
      send('COMMAND_ACK', { command: m.fields.command, result: 0 });
    }
    if (m.name === 'MISSION_ITEM') send('MISSION_ACK', { target_system: m.sysid, target_component: m.compid, type: 0 });
  }
});

sock.bind(() => {
  console.log(`fake vehicle → udp://${BRIDGE.host}:${BRIDGE.port}`);
  setInterval(() => {
    t++;
    send('HEARTBEAT', { type: 2, autopilot: 3, base_mode: 1 | (armed ? 128 : 0), custom_mode: mode, system_status: armed ? 4 : 3, mavlink_version: 3 });
    send('SYS_STATUS', { voltage_battery: 12400, current_battery: -1, battery_remaining: 87 });
    send('GPS_RAW_INT', { fix_type: 3, lat: Math.round(HOME.lat * 1e7), lon: Math.round(HOME.lng * 1e7), eph: 140, epv: 200, satellites_visible: 14 });
    send('GLOBAL_POSITION_INT', {
      lat: Math.round((HOME.lat - 0.0001) * 1e7),
      lon: Math.round((HOME.lng - 0.00005) * 1e7),
      relative_alt: -12890, // the screenshot showed -12.89 m on the bench
      hdg: 30000,
    });
    send('VFR_HUD', { airspeed: 0.6, groundspeed: 0.6, heading: 300, throttle: 0, alt: 3, climb: 0 });
    if (t % 30 === 1) send('STATUSTEXT', { severity: 2, text: 'PreArm: Bad Velocity' });
  }, 1000);
});
