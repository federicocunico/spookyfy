import { ErrorCode, type JobDto, type TrackDto, type WsServerEvent } from '@spookyfy/shared';
import { ApiError } from '../api';
import type { Db, ImportKind, ImportRecord } from '../offline/db';
import type { WakeLockController } from '../offline/wakelock';
import type { CoverProcessor } from './cover';
import type { DeviceLibrary } from './library';
import type { BridgeClient, GatewayClient } from './remote';

export const IMPORT_CONCURRENCY = 2;
const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Margine sullo spazio stimato prima di avviare un'importazione. */
const SPACE_MARGIN = 1.1;

export interface ImporterDeps {
  db: () => Promise<Db>;
  library: DeviceLibrary;
  gateway: GatewayClient;
  bridge: () => Promise<BridgeClient | null>;
  processCover: CoverProcessor;
  wakeLock: Pick<WakeLockController, 'acquire' | 'release'>;
  storage?: Pick<StorageManager, 'estimate'>;
  doc?: Document;
  now?: () => number;
  uuid?: () => string;
  /** Intervallo di polling dei job sul ponte. */
  bridgePollMs?: number;
  onEvent(e: WsServerEvent): void;
}

class ImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function toJob(r: ImportRecord): JobDto {
  return {
    id: r.id,
    sourceId: r.sourceId,
    status: r.status,
    progress: r.progress,
    error: r.error,
    errorCode: r.errorCode,
    trackId: r.trackId,
    requestedBy: 'device',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Importazioni verso il dispositivo (modalità client): coda persistente in
 * IndexedDB, al massimo due alla volta, ripresa al ritorno in primo piano e
 * schermo tenuto acceso finché la coda non è vuota.
 */
export class DeviceImporter {
  private readonly running = new Map<string, AbortController>();
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly doc: Document;
  private stopped = true;

  constructor(private readonly d: ImporterDeps) {
    this.now = d.now ?? Date.now;
    this.uuid = d.uuid ?? (() => crypto.randomUUID());
    this.doc = d.doc ?? document;
  }

  async init(): Promise<void> {
    const db = await this.d.db();
    // Importazioni interrotte da una chiusura dell'app: si riprendono da capo.
    for (const r of await db.getAll('imports')) {
      if (r.status === 'running') await db.put('imports', { ...r, status: 'queued', progress: 0 });
    }
    this.stopped = false;
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    void this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    for (const a of this.running.values()) a.abort();
  }

  private onVisibility = () => {
    if (!this.doc.hidden) void this.pump();
  };

  async list(): Promise<JobDto[]> {
    const since = this.now() - FINISHED_WINDOW_MS;
    const all = await (await this.d.db()).getAll('imports');
    return all
      .filter((r) => r.status === 'queued' || r.status === 'running' || r.updatedAt >= since)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toJob);
  }

  /** Accoda un'importazione; un video già in coda restituisce il job esistente. */
  async enqueue(kind: ImportKind, sourceId: string, opts: { replaceTrackId?: string } = {}): Promise<JobDto> {
    const db = await this.d.db();
    const active = (await db.getAll('imports')).find(
      (r) => r.sourceId === sourceId && (r.status === 'queued' || r.status === 'running'),
    );
    if (active) return toJob(active);
    const now = this.now();
    const r: ImportRecord = {
      id: this.uuid(),
      kind,
      sourceId,
      status: 'queued',
      progress: 0,
      error: null,
      errorCode: null,
      trackId: null,
      replaceTrackId: opts.replaceTrackId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.put('imports', r);
    this.d.onEvent({ type: 'job.queued', job: toJob(r) });
    void this.pump();
    return toJob(r);
  }

  async retry(id: string): Promise<JobDto> {
    const db = await this.d.db();
    const r = await db.get('imports', id);
    if (!r) throw new ApiError(404, ErrorCode.NotFound, 'Importazione non trovata');
    if (r.status !== 'failed')
      throw new ApiError(409, ErrorCode.Conflict, 'Si può riprovare solo un’importazione fallita');
    const next = {
      ...r,
      status: 'queued' as const,
      progress: 0,
      error: null,
      errorCode: null,
      updatedAt: this.now(),
    };
    await db.put('imports', next);
    this.d.onEvent({ type: 'job.queued', job: toJob(next) });
    void this.pump();
    return toJob(next);
  }

  async cancel(id: string): Promise<void> {
    this.running.get(id)?.abort();
    const db = await this.d.db();
    const r = await db.get('imports', id);
    if (r && r.status !== 'completed') await db.delete('imports', id);
  }

  /** Attende che non ci siano importazioni in corso (per i test). */
  async idle(): Promise<void> {
    for (;;) {
      await new Promise((r) => setTimeout(r, 5));
      const db = await this.d.db();
      const pending = (await db.getAll('imports')).some(
        (r) => r.status === 'queued' || r.status === 'running',
      );
      if (this.running.size === 0 && (!pending || this.doc.hidden)) return;
    }
  }

  private pumping = false;

  private async pump(): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      const db = await this.d.db();
      for (;;) {
        if (this.doc.hidden || this.running.size >= IMPORT_CONCURRENCY) break;
        const next = (await db.getAllFromIndex('imports', 'byCreatedAt')).find(
          (r) => r.status === 'queued' && !this.running.has(r.id),
        );
        if (!next) break;
        const abort = new AbortController();
        this.running.set(next.id, abort);
        void this.d.wakeLock.acquire();
        void this.process(next, abort.signal).finally(() => {
          this.running.delete(next.id);
          if (this.running.size === 0) void this.releaseIfIdle();
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async releaseIfIdle(): Promise<void> {
    const db = await this.d.db();
    if (!(await db.getAll('imports')).some((r) => r.status === 'queued')) await this.d.wakeLock.release();
  }

  private async update(r: ImportRecord, patch: Partial<ImportRecord>): Promise<ImportRecord> {
    const next = { ...r, ...patch, updatedAt: this.now() };
    await (await this.d.db()).put('imports', next);
    return next;
  }

  private lastProgressEmit = new Map<string, number>();

  private async progress(r: ImportRecord, fraction: number): Promise<void> {
    const last = this.lastProgressEmit.get(r.id) ?? -1;
    if (fraction - last < 0.02 && fraction < 1) return;
    this.lastProgressEmit.set(r.id, fraction);
    const job = { ...toJob(r), status: 'running' as const, progress: Math.round(fraction * 1000) / 1000 };
    this.d.onEvent({ type: 'job.progress', job });
  }

  private async assertSpace(bytes: number | null): Promise<void> {
    if (!bytes || !this.d.storage?.estimate) return;
    const est = await this.d.storage.estimate().catch(() => null);
    if (!est?.quota) return;
    const free = est.quota - (est.usage ?? 0);
    if (free < bytes * SPACE_MARGIN) {
      throw new ImportError(
        ErrorCode.InsufficientStorage,
        'Spazio insufficiente sul dispositivo per questo brano',
      );
    }
  }

  private async process(rec: ImportRecord, signal: AbortSignal): Promise<void> {
    let r = await this.update(rec, { status: 'running', progress: 0 });
    void this.progress(r, 0);
    try {
      const track =
        r.kind === 'bridge' ? await this.fromBridge(r, signal) : await this.fromGateway(r, signal);
      r = await this.update(r, { status: 'completed', progress: 1, trackId: track.id });
      this.d.onEvent({ type: 'job.completed', job: toJob(r), track });
    } catch (err) {
      if (signal.aborted && this.stopped) return; // resta in coda per il prossimo avvio
      const code =
        err instanceof ImportError ? err.code : err instanceof ApiError ? err.code : ErrorCode.Internal;
      const message =
        err instanceof ApiError && err.isNetwork
          ? 'Connessione persa durante l’importazione'
          : (err as Error).message || 'Importazione non riuscita';
      r = await this.update(r, { status: 'failed', error: message, errorCode: code });
      this.d.onEvent({ type: 'job.failed', job: toJob(r) });
    } finally {
      this.lastProgressEmit.delete(r.id);
    }
  }

  /** YouTube tramite gateway: metadati → copertina → audio in streaming → salvataggio. */
  private async fromGateway(r: ImportRecord, signal: AbortSignal): Promise<TrackDto> {
    const { library, gateway } = this.d;
    const sourceKey = `youtube:${r.sourceId}`;
    const existing = library.bySourceKey(sourceKey);
    if (existing && !existing.lost && r.kind !== 'redownload') return library.toDto(existing);

    const meta = await gateway.meta(r.sourceId);
    await this.assertSpace(meta.sizeBytes);
    const cover = await this.d.processCover(await gateway.cover(r.sourceId, signal));
    const audio = await gateway.audio(r.sourceId, (f) => void this.progress(r, f * 0.97), signal);
    if (meta.sizeBytes && audio.size !== meta.sizeBytes) {
      throw new ImportError(ErrorCode.Internal, 'Il file audio ricevuto è incompleto');
    }
    const mimeType = meta.mimeType || audio.type || 'audio/mp4';
    const replace = r.replaceTrackId ?? (existing?.lost ? existing.id : null);
    if (replace) {
      return library.restoreFiles(replace, {
        audio,
        cover512: cover.large,
        cover128: cover.thumb,
        sizeBytes: audio.size,
        mimeType,
      });
    }
    return library.addTrack({
      record: {
        sourceKey,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        durationMs: meta.durationMs,
        sizeBytes: audio.size,
        mimeType,
        dominantColor: cover.dominantColor,
      },
      audio,
      cover512: cover.large,
      cover128: cover.thumb,
    });
  }

  /** Server on-premise come ponte: importazione lì, poi copia sul dispositivo. */
  private async fromBridge(r: ImportRecord, signal: AbortSignal): Promise<TrackDto> {
    const bridge = await this.d.bridge();
    if (!bridge)
      throw new ImportError('BRIDGE_NOT_CONFIGURED', 'Il ponte verso il server di casa non è configurato');
    const sourceKey = `youtube:${r.sourceId}`;
    const existing = this.d.library.bySourceKey(sourceKey);
    if (existing && !existing.lost) return this.d.library.toDto(existing);

    const res = await bridge.ingest(r.sourceId);
    let remoteTrackId: string;
    if (res.kind === 'track') {
      remoteTrackId = res.track.id;
    } else {
      remoteTrackId = await this.waitBridgeJob(bridge, res.job.id, r, signal);
    }
    const remote = await bridge.track(remoteTrackId);
    await this.assertSpace(remote.sizeBytes);
    const audio = await bridge.audio(remote, (f) => void this.progress(r, 0.5 + f * 0.48), signal);
    const [cover512, cover128] = await Promise.all([
      bridge.cover(remote, 512, signal),
      bridge.cover(remote, 128, signal),
    ]);
    const fields = { audio, cover512, cover128, sizeBytes: audio.size, mimeType: audio.type || 'audio/mpeg' };
    if (existing?.lost) return this.d.library.restoreFiles(existing.id, fields);
    return this.d.library.addTrack({
      record: {
        sourceKey,
        title: remote.title,
        artist: remote.artist,
        album: remote.album,
        durationMs: remote.durationMs,
        sizeBytes: audio.size,
        mimeType: fields.mimeType,
        dominantColor: remote.dominantColor,
      },
      audio,
      cover512,
      cover128,
    });
  }

  private async waitBridgeJob(
    bridge: BridgeClient,
    jobId: string,
    r: ImportRecord,
    signal: AbortSignal,
  ): Promise<string> {
    const pollMs = this.d.bridgePollMs ?? 2000;
    for (;;) {
      if (signal.aborted) throw new ImportError('ABORTED', 'Importazione annullata');
      const job = (await bridge.jobs()).items.find((j) => j.id === jobId);
      if (!job) throw new ImportError(ErrorCode.NotFound, 'Il server di casa non trova più l’importazione');
      if (job.status === 'completed' && job.trackId) return job.trackId;
      if (job.status === 'failed')
        throw new ImportError(
          ErrorCode.Internal,
          job.error ?? 'Importazione non riuscita sul server di casa',
        );
      void this.progress(r, job.progress * 0.5);
      await new Promise((ok) => setTimeout(ok, pollMs));
    }
  }
}
