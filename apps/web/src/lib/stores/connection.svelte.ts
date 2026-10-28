const PROBE_INTERVAL_MS = 10_000;

/**
 * Stato della connessione: rete del dispositivo (navigator.onLine) e
 * raggiungibilità del server (ultima richiesta API riuscita o fallita).
 */
export class Connection {
  online = $state(true);
  reachable = $state(true);
  offline = $derived(!this.online || !this.reachable);
  private probe: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<() => void>();

  constructor(private readonly win: Window = window) {
    this.online = win.navigator.onLine;
    win.addEventListener('online', this.handleOnline);
    win.addEventListener('offline', this.handleOffline);
  }

  private handleOnline = () => {
    this.online = true;
    void this.check();
  };

  private handleOffline = () => {
    this.online = false;
  };

  markReachable(): void {
    const wasOffline = this.offline;
    this.reachable = true;
    if (this.probe) {
      clearInterval(this.probe);
      this.probe = undefined;
    }
    if (wasOffline && !this.offline) for (const l of this.listeners) l();
  }

  markUnreachable(): void {
    this.reachable = false;
    this.probe ??= setInterval(() => void this.check(), PROBE_INTERVAL_MS);
  }

  /** Verifica il server con la health check pubblica. */
  async check(): Promise<boolean> {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) {
        this.markReachable();
        return true;
      }
    } catch {}
    this.markUnreachable();
    return false;
  }

  /** Chiamato quando l'app torna online (es. per inviare gli ascolti in attesa). */
  onBackOnline(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Per i test e le demo. */
  set(state: { online?: boolean; reachable?: boolean }): void {
    const wasOffline = this.offline;
    if (state.online !== undefined) this.online = state.online;
    if (state.reachable !== undefined) this.reachable = state.reachable;
    if (wasOffline && !this.offline) for (const l of this.listeners) l();
  }

  destroy(): void {
    this.win.removeEventListener('online', this.handleOnline);
    this.win.removeEventListener('offline', this.handleOffline);
    if (this.probe) clearInterval(this.probe);
  }
}
