import { playThresholdMs } from '@spookyfy/shared';

/** Oltre questo salto fra due aggiornamenti si tratta di un seek, non di ascolto. */
const MAX_TICK_SEC = 2;

/**
 * Conta il tempo effettivamente ascoltato di una riproduzione (i seek non
 * contano) e segnala una sola volta il superamento della soglia d'ascolto.
 */
export class PlayTracker {
  private trackId: string | null = null;
  private thresholdSec = Number.POSITIVE_INFINITY;
  private listenedSec = 0;
  private lastTime: number | null = null;
  private reported = false;

  constructor(private readonly onThreshold: (trackId: string) => void) {}

  /** Nuova riproduzione (anche dello stesso brano, es. "ripeti brano"). */
  start(trackId: string, durationMs: number): void {
    this.trackId = trackId;
    this.thresholdSec = playThresholdMs(durationMs) / 1000;
    this.listenedSec = 0;
    this.lastTime = null;
    this.reported = false;
  }

  /** Da chiamare a ogni `timeupdate` mentre l'audio è in riproduzione. */
  tick(currentTimeSec: number): void {
    if (this.lastTime !== null) {
      const delta = currentTimeSec - this.lastTime;
      if (delta > 0 && delta <= MAX_TICK_SEC) this.listenedSec += delta;
    }
    this.lastTime = currentTimeSec;
    if (!this.reported && this.trackId && this.listenedSec >= this.thresholdSec) {
      this.reported = true;
      this.onThreshold(this.trackId);
    }
  }

  /** Pausa o seek: il prossimo tick riparte da qui senza contare il salto. */
  resync(): void {
    this.lastTime = null;
  }

  get listened(): number {
    return this.listenedSec;
  }
}
