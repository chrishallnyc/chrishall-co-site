// Fixed-size object pool. Grow never allocates mid-flight beyond capacity —
// callers must size for worst case; overflow reuses the oldest live item.

export class Pool {
  constructor(capacity, factory) {
    this.items = new Array(capacity);
    this.live = new Array(capacity).fill(false);
    this.order = [];            // indices in acquisition order (oldest first)
    for (let i = 0; i < capacity; i++) this.items[i] = factory(i);
  }

  acquire() {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.live[i]) {
        this.live[i] = true;
        this.order.push(i);
        return { index: i, item: this.items[i] };
      }
    }
    const oldest = this.order.shift(); // steal the oldest
    this.order.push(oldest);
    return { index: oldest, item: this.items[oldest] };
  }

  release(index) {
    if (!this.live[index]) return;
    this.live[index] = false;
    const k = this.order.indexOf(index);
    if (k !== -1) this.order.splice(k, 1);
  }

  forEachLive(fn) {
    for (let i = 0; i < this.items.length; i++) if (this.live[i]) fn(this.items[i], i);
  }

  get liveCount() { return this.order.length; }
}
