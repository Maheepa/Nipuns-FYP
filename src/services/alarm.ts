// Alarm tone generated with Web Audio (no sound file needed, works offline).
// Browsers only allow audio after a user gesture; the first click anywhere unlocks it
// (pressing Connect or Simulate counts).

import { config } from '../config';

let ctx: AudioContext | null = null;
let timer: number | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function unlockAudioOnFirstGesture(): void {
  const unlock = () => {
    void audio()?.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function beep(c: AudioContext, at: number, freq: number, dur: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Two-tone "hi-lo" pattern, repeated every second while active. */
export function setAlarm(on: boolean): void {
  if (on && timer == null) {
    const play = () => {
      const c = audio();
      if (!c || c.state !== 'running') return;
      const t = c.currentTime + 0.02;
      const f = config.alerts.alarmFreqHz;
      beep(c, t, f, 0.22);
      beep(c, t + 0.28, f * 0.75, 0.22);
    };
    play();
    timer = window.setInterval(play, 1000);
  } else if (!on && timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}
