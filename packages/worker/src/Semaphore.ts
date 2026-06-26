/**
 * Counting semaphore that resolves permits in FIFO order.
 *
 * acquireTimeout prevents indefinite starvation: if a permit is not available
 * within timeoutMs, the acquire rejects. This guarantees the semaphore can
 * never become permanently deadlocked even if a job hangs or leaks its permit.
 */
export class Semaphore {
  private permits                              : number;
  private readonly queue: Array<() => void>   = [];
  private readonly acquireTimeoutMs           : number;

  constructor(maxConcurrency: number, acquireTimeoutMs = 60_000) {
    if (maxConcurrency < 1) throw new RangeError('maxConcurrency must be >= 1');
    this.permits           = maxConcurrency;
    this.acquireTimeoutMs  = acquireTimeoutMs;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const resolver = (): void => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      timer = setTimeout(() => {
        // Remove from queue to reclaim the slot — whoever called us timed out
        const idx = this.queue.indexOf(resolver);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Semaphore.acquire timed out after ${this.acquireTimeoutMs}ms`));
      }, this.acquireTimeoutMs);

      this.queue.push(resolver);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Number of available permits (0 means fully saturated) */
  get available(): number { return this.permits; }

  /** Number of callers waiting for a permit */
  get queued(): number { return this.queue.length; }
}
