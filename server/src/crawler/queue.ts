export interface QueueItem {
  url: string;
  depth: number;
  priority: number;
  priorityReason: string;
  isNavigation?: boolean;
}

/** Small priority queue: highest score first, then shallower depth, then URL. */
export class PriorityQueue<T extends QueueItem> {
  private readonly items = new Map<string, T>();

  get size(): number {
    return this.items.size;
  }

  has(url: string): boolean {
    return this.items.has(url);
  }

  push(item: T): void {
    const existing = this.items.get(item.url);
    if (!existing || item.priority > existing.priority) {
      this.items.set(item.url, item);
    }
  }

  pop(): T | undefined {
    let best: T | undefined;
    for (const item of this.items.values()) {
      if (!best || this.compare(item, best) < 0) best = item;
    }
    if (best) this.items.delete(best.url);
    return best;
  }

  values(): T[] {
    return Array.from(this.items.values()).sort((left, right) => this.compare(left, right));
  }

  private compare(left: T, right: T): number {
    return right.priority - left.priority || left.depth - right.depth || left.url.localeCompare(right.url);
  }
}
