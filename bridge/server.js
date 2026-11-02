// Base-station bridge: Mission Planner MAVLink mirror (UDP) <-> web app (WebSocket).
//
//   APM ──COM15──► Mission Planner ──UDP 14550──► this bridge ──ws://localhost:8787──► browser
//                                   ◄── commands (MAVLink v1, needs "Write access" ticked) ──
//
// Environment variables (all optional):
//   BRIDGE_UDP_PORT=14550       port to listen on for the mirror (Mission Planner "UDP Client" → 127.0.0.1:14550)
//   BRIDGE_UDP_HOST=127.0.0.1   interface to bind (keep localhost unless Mission Planner runs on another PC)
//   BRIDGE_MAV_REMOTE=host:port use when the mirror is set to "UDP Host": the bridge sends to it instead of listening
//   BRIDGE_WS_PORT=8787
//   BRIDGE_FORCE_DRY_RUN=1      refuse to transmit any command, whatever the UI says
//   BRIDGE_SYSID=254            our MAVLink system id (Mission Planner itself is 255)

import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { MavlinkParser, encodeV1 } from './mavlink.js';
import { MAV_MISSION_RESULT, MAV_RESULT, MODE_NAMES, buildCommand, toHex } from './commands.js';

const UDP_PORT = Number(process.env.BRIDGE_UDP_PORT ?? 14550);
const UDP_HOST = process.env.BRIDGE_UDP_HOST ?? '127.0.0.1';
const MAV_REMOTE = process.env.BRIDGE_MAV_REMOTE ?? '';
const WS_PORT = Number(process.env.BRIDGE_WS_PORT ?? 8787);
const FORCE_DRY_RUN = process.env.BRIDGE_FORCE_DRY_RUN === '1';
const SELF = { sysid: Number(process.env.BRIDGE_SYSID ?? 254), compid: 190 };
const NO_DATA_MS = 5000;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ------------------------------------------------------------------ state
const parser = new MavlinkParser();
/** Where to send commands: the mirror's address (learned from the first datagram, or BRIDGE_MAV_REMOTE). */
let peer = null;
if (MAV_REMOTE) {
  const [host, port] = MAV_REMOTE.split(':');
  peer = { address: host, port: Number(port) };
}
let vehicle = null; // { sysid, compid }
let lastMsgAt = 0;
let pending = {}; // telemetry patch waiting to be flushed to clients

// ------------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: WS_PORT,
  // Only the local web app may connect — stops any other web page from sending drone commands.
  verifyClient: ({ origin }) => !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin),
});

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

function statusMsg() {
  return {
    type: 'status',
    udp: { port: UDP_PORT, mode: MAV_REMOTE ? 'remote' : 'listen', peer: peer ? `${peer.address}:${peer.port}` : null },
    mavlinkSeen: Date.now() - lastMsgAt < NO_DATA_MS,
    lastMsgAt: lastMsgAt || null,
    vehicle,
    forceDryRun: FORCE_DRY_RUN,
    parser: parser.stats,
  };
}

// ------------------------------------------------------------------ MAVLink in
function handleMessage(m) {
  const f = m.fields;
  const now = Date.now();
  switch (m.name) {
    case 'HEARTBEAT': {
      // Ignore heartbeats from ground stations (type 6 = GCS, autopilot 8 = INVALID).
      if (f.type === 6 || f.autopilot === 8) return;
      if (!vehicle || vehicle.sysid !== m.sysid || vehicle.compid !== m.compid) {
        vehicle = { sysid: m.sysid, compid: m.compid };
        log(`vehicle sysid=${m.sysid} compid=${m.compid} (type ${f.type}, autopilot ${f.autopilot})`);
        broadcast(statusMsg());
      }
      Object.assign(pending, {
        sysid: m.sysid,
        armed: (f.base_mode & 128) !== 0,
        customMode: f.custom_mode,
        mode: MODE_NAMES[f.custom_mode] ?? `MODE ${f.custom_mode}`,
      });
      break;
    }
    case 'SYS_STATUS':
      Object.assign(pending, {
        batteryV: f.voltage_battery === 65535 ? null : f.voltage_battery / 1000,
        batteryPct: f.battery_remaining < 0 ? null : f.battery_remaining,
      });
      break;
    case 'GPS_RAW_INT':
      Object.assign(pending, { gpsFix: f.fix_type, sats: f.satellites_visible === 255 ? null : f.satellites_visible, hdop: f.eph === 65535 ? null : f.eph / 100 });
      break;
    case 'GLOBAL_POSITION_INT':
      // lat/lon 0,0 means "no position yet" on ArduPilot
      if (f.lat !== 0 || f.lon !== 0) pending.position = { lat: f.lat / 1e7, lng: f.lon / 1e7 };
      Object.assign(pending, { relAltM: f.relative_alt / 1000, ...(f.hdg !== 65535 ? { headingDeg: f.hdg / 100 } : {}) });
      break;
    case 'VFR_HUD':
      Object.assign(pending, { groundSpeed: f.groundspeed, airSpeed: f.airspeed, climb: f.climb });
      if (pending.headingDeg == null) pending.headingDeg = f.heading;
      break;
    case 'STATUSTEXT':
      log(`STATUSTEXT [${f.severity}] ${f.text}`);
      broadcast({ type: 'statustext', t: now, severity: f.severity, text: f.text });
      break;
    case 'COMMAND_ACK':
      log(`COMMAND_ACK cmd=${f.command} result=${MAV_RESULT[f.result] ?? f.result}`);
      broadcast({ type: 'ack', t: now, kind: 'command', command: f.command, result: MAV_RESULT[f.result] ?? String(f.result) });
      break;
    case 'MISSION_ACK':
      // Only acks addressed to us (Mission Planner's own uploads also produce these).
      if (f.target_system !== SELF.sysid) return;
      log(`MISSION_ACK ${MAV_MISSION_RESULT[f.type] ?? f.type}`);
      broadcast({ type: 'ack', t: now, kind: 'mission', command: 0, result: MAV_MISSION_RESULT[f.type] ?? String(f.type) });
      break;
    default:
      return;
  }
}

const udp = dgram.createSocket('udp4');
udp.on('message', (buf, rinfo) => {
  if (!MAV_REMOTE && (!peer || peer.address !== rinfo.address || peer.port !== rinfo.port)) {
    peer = { address: rinfo.address, port: rinfo.port };
    log(`MAVLink mirror at ${peer.address}:${peer.port}`);
  }
  const msgs = parser.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  if (msgs.length) {
    const wasSeen = Date.now() - lastMsgAt < NO_DATA_MS;
    lastMsgAt = Date.now();
    if (!wasSeen) broadcast(statusMsg());
  }
  for (const m of msgs) handleMessage(m);
});
udp.on('error', (e) => {
  console.error(`UDP error: ${e.message}`);
  if (e.code === 'EADDRINUSE') console.error(`Port ${UDP_PORT} is busy — is another GCS or bridge already listening?`);
  process.exit(1);
});
udp.bind(MAV_REMOTE ? 0 : UDP_PORT, MAV_REMOTE ? undefined : UDP_HOST, () => {
  const a = udp.address();
  log(MAV_REMOTE ? `UDP client → ${MAV_REMOTE} (local ${a.port})` : `listening for MAVLink on udp://${a.address}:${a.port}`);
});

// In "remote" mode the mirror only starts streaming after it hears from us: send a GCS heartbeat.
if (MAV_REMOTE) {
  setInterval(() => {
    const hb = encodeV1('HEARTBEAT', { type: 6, autopilot: 8, base_mode: 0, custom_mode: 0, system_status: 4, mavlink_version: 3 }, SELF);
    udp.send(hb, peer.port, peer.address);
  }, 1000);
}

// Telemetry to the browser at up to 10 Hz; status once a second.
setInterval(() => {
  if (Object.keys(pending).length) {
    broadcast({ type: 'telemetry', t: Date.now(), patch: pending });
    pending = {};
  }
}, 100);
setInterval(() => broadcast(statusMsg()), 1000);

// ------------------------------------------------------------------ commands from the browser
function handleCommand(ws, msg) {
  const reply = (r) => ws.send(JSON.stringify({ type: 'cmdResult', id: msg.id, ...r }));
  const built = buildCommand(msg.cmd, vehicle, msg.limits ?? {}, SELF);
  if (!built.ok) {
    log(`REFUSED ${JSON.stringify(msg.cmd)}: ${built.error}`);
    return reply({ ok: false, sent: false, error: built.error });
  }
  const hex = toHex(built.frame);
  if (msg.dryRun !== false || FORCE_DRY_RUN) {
    log(`DRY-RUN ${built.summary} | ${hex}`);
    return reply({ ok: true, sent: false, dryRun: true, summary: built.summary, hex });
  }
  if (!peer) return reply({ ok: false, sent: false, error: 'no MAVLink mirror connected (nothing to send to)' });
  if (Date.now() - lastMsgAt > NO_DATA_MS) return reply({ ok: false, sent: false, error: 'no MAVLink data in the last 5 s — link down?' });
  udp.send(built.frame, peer.port, peer.address, (err) => {
    if (err) return reply({ ok: false, sent: false, error: err.message });
    log(`SENT ${built.summary} → ${peer.address}:${peer.port}`);
    reply({ ok: true, sent: true, dryRun: false, summary: built.summary, hex, ackFor: built.ackFor });
  });
}

wss.on('connection', (ws, req) => {
  log(`web app connected (${req.socket.remoteAddress})`);
  ws.send(JSON.stringify(statusMsg()));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg?.type === 'command') handleCommand(ws, msg);
  });
  ws.on('close', () => log('web app disconnected'));
});
wss.on('listening', () => log(`WebSocket for the web app on ws://127.0.0.1:${WS_PORT}${FORCE_DRY_RUN ? '  [FORCED DRY-RUN]' : ''}`));
wss.on('error', (e) => {
  console.error(`WebSocket error: ${e.message}`);
  process.exit(1);
});
