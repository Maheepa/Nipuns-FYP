/** Fixed-capacity FIFO. Pushing past capacity drops the oldest item. Not React state. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private start = 0;
  private count = 0;
  /** Increments on every change, so readers can skip work when nothing is new. */
  version = 0;
  private cache: T[] | null = null;

  constructor(readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    const idx = (this.start + this.count) % this.capacity;
    this.buf[idx] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
    this.version++;
    this.cache = null;
  }

  last(): T | undefined {
    return this.count ? this.buf[(this.start + this.count - 1) % this.capacity] : undefined;
  }

  /** Oldest → newest. The array is cached until the next change; treat it as read-only. */
  toArray(): T[] {
    if (!this.cache) {
      const out = new Array<T>(this.count);
      for (let i = 0; i < this.count; i++) out[i] = this.buf[(this.start + i) % this.capacity] as T;
      this.cache = out;
    }
    return this.cache;
  }

  clear(): void {
    this.buf = new Array(this.capacity);
    this.start = 0;
    this.count = 0;
    this.version++;
    this.cache = null;
  }
}
