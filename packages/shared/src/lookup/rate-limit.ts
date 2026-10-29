/**
 * Distanzia le chiamate di almeno `intervalMs` (MusicBrainz: una richiesta al secondo per IP).
 * Le chiamate vengono eseguite in ordine di arrivo; un errore non blocca le successive.
 */
export interface RateLimiter {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}

export function createRateLimiter(
  intervalMs: number,
  clock: { now(): number; sleep(ms: number): Promise<void> } = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): RateLimiter {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(async () => {
        const wait = lastStart + intervalMs - clock.now();
        if (wait > 0) await clock.sleep(wait);
        lastStart = clock.now();
        return fn();
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
