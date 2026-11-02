import type { LatLng } from './config';

const R = 6_371_000; // mean Earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing a → b in degrees (0 = north, clockwise). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `dist` metres from `a` along `bearing` degrees. */
export function destination(a: LatLng, bearing: number, dist: number): LatLng {
  const d = dist / R;
  const b = rad(bearing);
  const lat1 = rad(a.lat);
  const lng1 = rad(a.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lng2) };
}

/**
 * Highest zoom at which every point stays inside a w×h viewport centred on `center`,
 * keeping `padding` px clear of each edge. Uses Web-Mercator pixel maths (256 px tiles).
 * Returns null when there are no points to fit.
 */
export function fitZoomAroundCenter(
  center: LatLng,
  points: LatLng[],
  w: number,
  h: number,
  padding: number,
): number | null {
  const project = (p: LatLng) => {
    const s = Math.sin(rad(Math.max(-85, Math.min(85, p.lat))));
    return {
      x: (256 * (p.lng + 180)) / 360,
      y: 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)),
    };
  };
  const c = project(center);
  const halfW = Math.max(1, w / 2 - padding);
  const halfH = Math.max(1, h / 2 - padding);
  let best = Infinity;
  for (const p of points) {
    const q = project(p);
    const dx = Math.abs(q.x - c.x);
    const dy = Math.abs(q.y - c.y);
    // At zoom z the offset is d * 2^z; it must stay ≤ half the viewport.
    if (dx > 0) best = Math.min(best, Math.log2(halfW / dx));
    if (dy > 0) best = Math.min(best, Math.log2(halfH / dy));
  }
  return points.length === 0 ? null : best;
}
