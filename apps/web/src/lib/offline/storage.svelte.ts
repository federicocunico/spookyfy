/** Storage persistente e stima dello spazio (API StorageManager del browser). */
export class StorageStatus {
  /** null finché non è stato verificato. */
  persisted = $state<boolean | null>(null);
  usage = $state<number | null>(null);
  quota = $state<number | null>(null);

  constructor(private readonly storage: StorageManager | undefined = globalThis.navigator?.storage) {}

  get supported(): boolean {
    return typeof this.storage?.persist === 'function';
  }

  /** Chiede che i dati dell'app non vengano eliminati dal sistema quando lo spazio scarseggia. */
  async requestPersistence(): Promise<boolean> {
    if (!this.storage || !this.supported) {
      this.persisted = false;
      return false;
    }
    try {
      const already = (await this.storage.persisted?.()) ?? false;
      this.persisted = already || (await this.storage.persist());
    } catch {
      this.persisted = false;
    }
    return this.persisted;
  }

  async refresh(): Promise<void> {
    if (!this.storage) return;
    try {
      if (this.persisted === null && this.storage.persisted) this.persisted = await this.storage.persisted();
      const est = await this.storage.estimate?.();
      this.usage = est?.usage ?? null;
      this.quota = est?.quota ?? null;
    } catch {}
  }
}
