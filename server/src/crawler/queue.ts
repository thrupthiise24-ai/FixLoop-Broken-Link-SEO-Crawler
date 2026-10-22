export interface QueueItem {
  url: string;
  depth: number;
  priority: number;
  priorityReason: string;
  inboundCount: number;
  isNav: boolean;
  discoveredFrom?: string;
}

export class CrawlQueue {
  private queue: QueueItem[] = [];
  private enqueuedUrls: Map<string, QueueItem> = new Map();
  private visitedUrls: Set<string> = new Set();

  /**
   * Pushes an item to the queue or updates priority/inbound count if already pending.
   */
  public push(item: QueueItem): boolean {
    const normalized = item.url;

    if (this.visitedUrls.has(normalized)) {
      return false;
    }

    const existing = this.enqueuedUrls.get(normalized);
    if (existing) {
      // If found again via another link, increase inbound count
      existing.inboundCount += 1;
      // Upgrade priority if found with a higher priority or shallower depth
      if (item.priority > existing.priority) {
        existing.priority = item.priority;
        existing.priorityReason = item.priorityReason;
      }
      if (item.depth < existing.depth) {
        existing.depth = item.depth;
      }
      if (item.isNav) {
        existing.isNav = true;
      }
      this.reSort();
      return false;
    }

    this.queue.push(item);
    this.enqueuedUrls.set(normalized, item);
    this.reSort();
    return true;
  }

  /**
   * Sorts queue in descending order of priority (highest score first).
   * Tie-breaker: shallower depth first, then higher inbound count.
   */
  private reSort(): void {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return b.inboundCount - a.inboundCount;
    });
  }

  /**
   * Pops the highest priority item from the queue and marks it as visited.
   */
  public pop(): QueueItem | undefined {
    const item = this.queue.shift();
    if (item) {
      this.enqueuedUrls.delete(item.url);
      this.visitedUrls.add(item.url);
    }
    return item;
  }

  public peek(): QueueItem | undefined {
    return this.queue[0];
  }

  public isVisited(url: string): boolean {
    return this.visitedUrls.has(url);
  }

  public isEnqueued(url: string): boolean {
    return this.enqueuedUrls.has(url);
  }

  public size(): number {
    return this.queue.length;
  }

  public visitedCount(): number {
    return this.visitedUrls.size;
  }

  public getPendingItems(): QueueItem[] {
    return [...this.queue];
  }

  public clear(): void {
    this.queue = [];
    this.enqueuedUrls.clear();
    this.visitedUrls.clear();
  }
}
