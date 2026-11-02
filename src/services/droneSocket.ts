// WebSocket client for the Node bridge (bridge/server.js).
// Telemetry is merged into the store; commands return a promise with the bridge's verdict.

import { config } from '../config';
import { useStore } from '../store/useStore';
import type { DroneState } from '../types';
import type { DroneCommand } from './droneCommands';

export interface CommandResult {
  ok: boolean;
  /** true only when the frame actually left the bridge towards the drone. */
  sent: boolean;
  dryRun?: boolean;
  summary?: string;
  hex?: string;
  error?: string;
  ackFor?: number | 'mission' | null;
}

export interface BridgeAck {
  kind: 'command' | 'mission';
  command: number;
  result: string;
}

let ws: WebSocket | null = null;
let retry: number | null = null;
let stopped = true;
let seq = 0;
let everConnected = false;
const waiting = new Map<string, (r: CommandResult) => void>();
const ackListeners = new Set<(a: BridgeAck) => void>();

export function onAck(fn: (a: BridgeAck) => void): () => void {
  ackListeners.add(fn);
  return () => ackListeners.delete(fn);
}

function simulating() {
  return useStore.getState().settings.simulate;
}

function handle(msg: { type: string; [k: string]: unknown }) {
  const st = useStore.getState();
  switch (msg.type) {
    case 'status':
      if (!simulating()) st.setDroneLink({ mavlinkSeen: Boolean(msg.mavlinkSeen) });
      break;
    case 'telemetry':
      if (!simulating()) st.updateDrone(msg.patch as Partial<DroneState>);
      break;
    case 'statustext':
      if (!simulating()) st.addStatusText(msg.severity as number, msg.text as string, msg.t as number);
      break;
    case 'ack': {
      const a = msg as unknown as BridgeAck;
      ackListeners.forEach((fn) => fn(a));
      break;
    }
    case 'cmdResult': {
      const fn = waiting.get(msg.id as string);
      if (fn) {
        waiting.delete(msg.id as string);
        fn(msg as unknown as CommandResult);
      }
      break;
    }
  }
}

function open() {
  if (stopped) return;
  let sock: WebSocket;
  try {
    sock = ws = new WebSocket(config.bridge.wsUrl);
  } catch {
    schedule();
    return;
  }
  sock.onopen = () => {
    if (!simulating()) useStore.getState().setDroneLink({ wsConnected: true });
    useStore.getState().logEvent({ kind: 'link', message: 'Drone bridge connected' });
    everConnected = true;
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    try {
      handle(JSON.parse(String(e.data)));
    } catch {
      /* ignore malformed */
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return; // an older socket closing after a restart
    ws = null;
    if (!simulating()) useStore.getState().setDroneLink({ wsConnected: false, mavlinkSeen: false });
    // log only the drop, not every reconnect attempt while the bridge is off
    if (everConnected) useStore.getState().logEvent({ kind: 'link', message: 'Drone bridge connection lost' });
    everConnected = false;
    for (const [, fn] of waiting) fn({ ok: false, sent: false, error: 'bridge connection lost' });
    waiting.clear();
    schedule();
  };
}

function schedule() {
  if (stopped || retry != null) return;
  retry = window.setTimeout(() => {
    retry = null;
    open();
  }, 2000);
}

/** Connect (and keep reconnecting) to the bridge. Returns a stop function. */
export function startDroneSocket(): () => void {
  stopped = false;
  open();
  return () => {
    stopped = true;
    if (retry != null) window.clearTimeout(retry);
    retry = null;
    ws?.close();
  };
}

export function bridgeConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

/** Send a command through the bridge. The bridge re-checks limits and honours dryRun. */
export function sendToBridge(
  cmd: DroneCommand,
  opts: { dryRun: boolean; home: { lat: number; lng: number }; maxDistanceFromHomeM: number },
): Promise<CommandResult> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, sent: false, error: 'bridge not connected' });
  const id = `c${++seq}`;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    ws!.send(
      JSON.stringify({
        type: 'command',
        id,
        cmd,
        dryRun: opts.dryRun,
        limits: { home: opts.home, maxDistanceFromHomeM: opts.maxDistanceFromHomeM },
      }),
    );
    window.setTimeout(() => {
      if (waiting.delete(id)) resolve({ ok: false, sent: false, error: 'no reply from bridge (timeout)' });
    }, 5000);
  });
}
