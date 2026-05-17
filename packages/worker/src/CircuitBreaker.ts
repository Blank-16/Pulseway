/**
 * Per-host circuit breaker. Transitions:
 *   CLOSED  → OPEN   after N consecutive timeouts/errors
 *   OPEN    → HALF_OPEN after cooldownMs
 *   HALF_OPEN → CLOSED   on first success
 *   HALF_OPEN → OPEN     on first failure
 */
type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface HostState {
  state     : State;
  failures  : number;
  openedAt  : number;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS       = 30_000;

export class CircuitBreaker {
  private readonly hosts          = new Map<string, HostState>();
  private readonly failureThreshold: number;
  private readonly cooldownMs      : number;

  constructor(opts?: { failureThreshold?: number; cooldownMs?: number }) {
    this.failureThreshold = opts?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs       = opts?.cooldownMs       ?? DEFAULT_COOLDOWN_MS;
  }

  isOpen(host: string): boolean {
    const s = this.hosts.get(host);
    if (!s || s.state === 'CLOSED') return false;

    if (s.state === 'OPEN') {
      if (Date.now() - s.openedAt >= this.cooldownMs) {
        s.state = 'HALF_OPEN';
        return false; // allow one probe
      }
      return true;
    }

    return false; // HALF_OPEN — allow the probe through
  }

  recordSuccess(host: string): void {
    const s = this.hosts.get(host);
    if (!s) return;
    s.state    = 'CLOSED';
    s.failures = 0;
  }

  recordFailure(host: string): void {
    const s = this.hosts.get(host) ?? { state: 'CLOSED' as State, failures: 0, openedAt: 0 };
    s.failures++;
    if (s.state === 'HALF_OPEN' || s.failures >= this.failureThreshold) {
      s.state   = 'OPEN';
      s.openedAt = Date.now();
    }
    this.hosts.set(host, s);
  }

  getState(host: string): State {
    return this.hosts.get(host)?.state ?? 'CLOSED';
  }
}

export const globalCircuitBreaker = new CircuitBreaker();
