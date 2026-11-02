import { describe, expect, it } from 'vitest';
import { bearingDeg, destination, distanceM, fitZoomAroundCenter } from './geo';

const base = { lat: 6.8122982, lng: 79.8907368 };

describe('geo helpers', () => {
  it('distance and destination round-trip', () => {
    const p = destination(base, 45, 150);
    expect(distanceM(base, p)).toBeCloseTo(150, 3);
    expect(bearingDeg(base, p)).toBeCloseTo(45, 3);
  });

  it('fit zoom: farther points need a lower zoom', () => {
    const near = fitZoomAroundCenter(base, [destination(base, 90, 50)], 1000, 400, 50)!;
    const far = fitZoomAroundCenter(base, [destination(base, 90, 400)], 1000, 400, 50)!;
    expect(far).toBeLessThan(near);
    // 8× the distance → 3 zoom levels lower
    expect(near - far).toBeCloseTo(3, 1);
  });

  it('fit zoom: the tighter axis wins', () => {
    const east = fitZoomAroundCenter(base, [destination(base, 90, 100)], 1000, 400, 0)!;
    const north = fitZoomAroundCenter(base, [destination(base, 0, 100)], 1000, 400, 0)!;
    expect(north).toBeLessThan(east); // viewport is shorter than it is wide
  });

  it('fit zoom: no points → null', () => {
    expect(fitZoomAroundCenter(base, [], 800, 400, 40)).toBeNull();
  });
});
