import type { MeDto, RegisterBody } from '@spookyfy/shared';
import { type Api, ApiError } from '../api';
import { type Db, clearPersonalData, getMeta, setMeta } from '../offline/db';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface SessionDeps {
  api: Api;
  db: () => Promise<Db>;
  /** Dopo login/registrazione (es. richiesta di storage persistente). */
  onAuthenticated?: () => void;
  /** Prima del logout (es. invio degli ascolti in attesa). */
  beforeLogout?: () => Promise<void>;
}

export class Session {
  user = $state<MeDto | null>(null);
  status = $state<SessionStatus>('unknown');
  /** true se l'utente è "ricordato" ma il server non è raggiungibile. */
  offlineMode = $state(false);

  constructor(private readonly deps: SessionDeps) {}

  private async setUser(user: MeDto): Promise<void> {
    this.user = user;
    this.status = 'authenticated';
    this.offlineMode = false;
    try {
      await setMeta(await this.deps.db(), 'user', user);
    } catch {}
  }

  /** All'avvio: verifica la sessione; offline usa l'ultimo utente noto. */
  async init(): Promise<void> {
    try {
      await this.setUser(await this.deps.api.auth.me());
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        const cached = await getMeta(await this.deps.db(), 'user').catch(() => undefined);
        if (cached) {
          this.user = cached;
          this.status = 'authenticated';
          this.offlineMode = true;
          return;
        }
      }
      this.user = null;
      this.status = 'anonymous';
    }
  }

  async login(username: string, password: string): Promise<void> {
    await this.setUser(await this.deps.api.auth.login(username, password));
    this.deps.onAuthenticated?.();
  }

  async register(body: RegisterBody): Promise<void> {
    await this.setUser(await this.deps.api.auth.register(body));
    this.deps.onAuthenticated?.();
  }

  async logout(): Promise<void> {
    await this.deps.beforeLogout?.().catch(() => {});
    try {
      await this.deps.api.auth.logout();
    } finally {
      await clearPersonalData(await this.deps.db()).catch(() => {});
      this.user = null;
      this.status = 'anonymous';
    }
  }

  /** Il server ha rifiutato la sessione (scaduta o revocata). */
  expire(): void {
    if (this.status !== 'authenticated') return;
    this.user = null;
    this.status = 'anonymous';
  }
}
