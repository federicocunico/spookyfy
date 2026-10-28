/**
 * Tiene lo schermo acceso durante i download massivi (Screen Wake Lock API).
 * Il sistema rilascia il blocco quando la pagina va in background: lo si
 * riacquisisce al ritorno in primo piano finché serve.
 */
export class WakeLockController {
  private sentinel: WakeLockSentinel | undefined;
  private wanted = false;

  constructor(
    private readonly nav: Navigator = navigator,
    private readonly doc: Document = document,
  ) {
    doc.addEventListener('visibilitychange', this.onVisibility);
  }

  get supported(): boolean {
    return 'wakeLock' in this.nav && typeof this.nav.wakeLock?.request === 'function';
  }

  get active(): boolean {
    return this.sentinel !== undefined && !this.sentinel.released;
  }

  private onVisibility = () => {
    if (this.wanted && this.doc.visibilityState === 'visible' && !this.active) void this.request();
  };

  private async request(): Promise<boolean> {
    try {
      const sentinel = await this.nav.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = undefined;
      });
      this.sentinel = sentinel;
      return true;
    } catch {
      return false;
    }
  }

  /** false se l'API non è supportata o il sistema rifiuta (es. batteria scarica). */
  async acquire(): Promise<boolean> {
    this.wanted = true;
    if (!this.supported) return false;
    return this.active || this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = undefined;
    await s?.release().catch(() => {});
  }

  destroy(): void {
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }
}
