// Single entry point for receiver lines. Both the real serial port and the
// simulator feed raw text through here, so simulation exercises the real parser.

import { useStore } from '../store/useStore';
import type { WatchPacket } from '../types';
import { parseSerialLine } from './packetParser';

type PacketListener = (p: WatchPacket, now: number) => void;
const packetListeners = new Set<PacketListener>();

/** Subscribe to every successfully parsed packet (used by alerts/detection). */
export function onPacket(fn: PacketListener): () => void {
  packetListeners.add(fn);
  return () => packetListeners.delete(fn);
}

export function handleSerialLine(line: string, now = Date.now()): void {
  const r = parseSerialLine(line);
  const store = useStore.getState();
  switch (r.kind) {
    case 'packet':
      store.ingestPacket(r.packet, now);
      for (const fn of packetListeners) fn(r.packet, now);
      break;
    case 'ready':
      store.setLink({ receiverReady: r.loraOk, lastHbAt: now });
      break;
    case 'heartbeat':
      store.setLink({ lastHbAt: now });
      break;
    case 'bad':
      store.countBad();
      if (import.meta.env.DEV) console.debug('[lora] bad line:', r.reason, JSON.stringify(r.raw));
      break;
    case 'ignored':
      break;
  }
}
