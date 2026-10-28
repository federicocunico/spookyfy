import type { PlayEvent } from '@spookyfy/shared';
import { type Api, ApiError } from '../api';
import type { Db } from '../offline/db';

const BATCH = 500;

/**
 * Gli ascolti vengono prima salvati sul dispositivo e poi inviati in blocco:
 * offline restano in attesa e partono al ritorno della connessione, con l'orario
 * originale. L'id generato qui rende innocui i reinvii.
 */
export class PlayReporter {
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      api: Api;
      db: () => Promise<Db>;
      now?: () => number;
      uuid?: () => string;
    },
  ) {}

  async record(trackId: string): Promise<PlayEvent> {
    const event: PlayEvent = {
      id: (this.deps.uuid ?? (() => crypto.randomUUID()))(),
      trackId,
      playedAt: (this.deps.now ?? Date.now)(),
    };
    await (await this.deps.db()).put('pendingPlays', event);
    void this.flush();
    return event;
  }

  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const db = await this.deps.db();
    for (;;) {
      const batch = (await db.getAll('pendingPlays')).slice(0, BATCH);
      if (batch.length === 0) return;
      try {
        await this.deps.api.plays.submit(batch);
      } catch (err) {
        // Offline o sessione scaduta: si riprova più tardi. Un 400 invece non si
        // risolverebbe riprovando: quegli eventi vengono scartati.
        if (err instanceof ApiError && err.status === 400) {
          await Promise.all(batch.map((p) => db.delete('pendingPlays', p.id)));
          continue;
        }
        return;
      }
      const tx = db.transaction('pendingPlays', 'readwrite');
      await Promise.all([...batch.map((p) => tx.store.delete(p.id)), tx.done]);
    }
  }

  async pendingCount(): Promise<number> {
    return (await this.deps.db()).count('pendingPlays');
  }
}
