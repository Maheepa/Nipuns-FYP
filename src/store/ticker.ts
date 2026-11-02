// One UI refresh loop for the whole app. High-rate data lives in plain buffers (live.ts);
// components re-render from this ticker at a fixed rate instead of on every packet.

import { create } from 'zustand';

export const TICK_HZ = 8;

const useTicker = create<{ tick: number }>(() => ({ tick: 0 }));
let timer: number | null = null;

/** Start the shared 8 Hz loop (idempotent). */
export function startTicker(): () => void {
  if (timer == null) timer = window.setInterval(() => useTicker.setState((s) => ({ tick: s.tick + 1 })), 1000 / TICK_HZ);
  return () => {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };
}

/**
 * Re-render the caller at most `hz` times per second (8, 4, 2 or 1) and return the current time.
 * Components read live buffers directly during render.
 */
export function useFrame(hz: 8 | 4 | 2 | 1 = TICK_HZ): number {
  const div = TICK_HZ / hz;
  useTicker((s) => Math.floor(s.tick / div));
  return Date.now();
}
