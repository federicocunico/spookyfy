import type { Clock } from '../clock.js';

interface Entry {
  count: number;
  firstAt: number;
}

/**
 * Limita i tentativi falliti per chiave: dopo `max` fallimenti la chiave resta
 * bloccata fino a `windowMs` dal primo fallimento della finestra.
 * In memoria: un solo processo, e un riavvio che azzera i contatori è accettabile.
 */
export class FailureRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  private current(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (e && this.clock.now() - e.firstAt >= this.windowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  /** Millisecondi di attesa se la chiave è bloccata, altrimenti 0. */
  retryAfterMs(key: string): number {
    const e = this.current(key);
    if (!e || e.count < this.max) return 0;
    return e.firstAt + this.windowMs - this.clock.now();
  }

  recordFailure(key: string): void {
    const e = this.current(key);
    if (e) e.count += 1;
    else this.entries.set(key, { count: 1, firstAt: this.clock.now() });
    if (this.entries.size > 10_000) this.sweep();
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private sweep(): void {
    const now = this.clock.now();
    for (const [k, e] of this.entries) if (now - e.firstAt >= this.windowMs) this.entries.delete(k);
  }
}
