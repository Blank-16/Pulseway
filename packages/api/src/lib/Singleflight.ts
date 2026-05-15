/**
 * Singleflight — coalesces concurrent calls for the same key into one in-flight
 * promise. All callers that arrive while a key is in-flight receive the same
 * result without triggering additional work (DB query, HTTP call, etc.).
 */
export class Singleflight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
