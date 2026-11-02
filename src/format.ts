/** Formatting helpers shared by the panels. */

export function fmt(v: number | null | undefined, digits = 1, fallback = '—'): string {
  return v == null || !Number.isFinite(v) ? fallback : v.toFixed(digits);
}

export function ago(t: number | null, now: number): string {
  if (t == null) return 'never';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 10) return `${s.toFixed(1)} s ago`;
  if (s < 120) return `${Math.round(s)} s ago`;
  return `${Math.round(s / 60)} min ago`;
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

export function metres(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
