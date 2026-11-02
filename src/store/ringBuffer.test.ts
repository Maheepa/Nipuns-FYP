import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ringBuffer';

describe('RingBuffer', () => {
  it('keeps the newest items in order and drops the oldest', () => {
    const r = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => r.push(n));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.last()).toBe(5);
    expect(r.size).toBe(3);
  });

  it('bumps the version and refreshes the cached array on change', () => {
    const r = new RingBuffer<number>(2);
    r.push(1);
    const a = r.toArray();
    expect(r.toArray()).toBe(a); // cached
    const v = r.version;
    r.push(2);
    expect(r.version).toBe(v + 1);
    expect(r.toArray()).not.toBe(a);
    r.clear();
    expect(r.toArray()).toEqual([]);
    expect(r.last()).toBeUndefined();
  });
});
