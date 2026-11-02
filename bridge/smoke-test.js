// End-to-end check: connects to the running bridge like the web app does, waits for
// telemetry from the fake vehicle, then sends one dry-run and one live command.
//   npm run bridge  &  node bridge/fake-vehicle.js  &  node bridge/smoke-test.js

import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8787', { origin: 'http://localhost:5173' });
const home = { lat: 6.8122982, lng: 79.8907368 };
const seen = new Set();
let step = 0;

const send = (id, cmd, dryRun) => ws.send(JSON.stringify({ type: 'command', id, cmd, dryRun, limits: { home, maxDistanceFromHomeM: 300 } }));

ws.on('message', (data) => {
  const m = JSON.parse(String(data));
  seen.add(m.type);
  if (m.type === 'telemetry' && step === 0 && m.patch.position) {
    console.log('telemetry ok:', JSON.stringify(m.patch));
    step = 1;
    send('a', { type: 'setMode', mode: 'GUIDED' }, true);
    send('b', { type: 'goto', lat: 6.8125, lng: 79.8909, altM: 10 }, false);
    send('c', { type: 'goto', lat: 6.9, lng: 79.8909, altM: 10 }, false);
  }
  if (m.type === 'statustext') console.log('statustext:', m.text);
  if (m.type === 'cmdResult') console.log('cmdResult:', JSON.stringify(m));
  if (m.type === 'ack') console.log('ack:', JSON.stringify(m));
});

setTimeout(() => {
  console.log('message types seen:', [...seen].join(', '));
  process.exit(seen.has('telemetry') && seen.has('cmdResult') ? 0 : 1);
}, 6000);
