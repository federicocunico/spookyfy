import type { TrackDto } from '@spookyfy/shared';
import { trackAudioUrl, trackCoverUrl } from '@spookyfy/shared';
import type { Toasts } from '../stores/toasts.svelte';
import type { Db } from './db';
import type { WakeLockController } from './wakelock';

/** Nomi condivisi con il Service Worker (sw.ts). */
export const AUDIO_CACHE = 'spk-audio-v1';
export const OFFLINE_COVER_CACHE = 'spk-covers-offline-v1';

export type DownloadStatus = 'none' | 'queued' | 'downloading' | 'downloaded';

interface Entry {
  status: DownloadStatus;
  /** Da 0 a 1 durante il download. */
  progress: number;
}

export interface BulkState {
  total: number;
  done: number;
  failed: number;
  currentTitle: string | null;
  /** Modalità schermo scuro a basso consumo. */
  dim: boolean;
}

export interface DownloadsDeps {
  db: () => Promise<Db>;
  toasts: Toasts;
  wakeLock: WakeLockController;
  caches?: CacheStorage;
  fetch?: typeof fetch;
  doc?: Document;
  now?: () => number;
}

const absolute = (url: string) => new URL(url, globalThis.location?.href ?? 'http://localhost').href;

class DownloadAborted extends Error {
  constructor() {
    super('Download annullato');
    this.name = 'AbortError';
  }
}

export class Downloads {
  entries = $state<Record<string, Entry>>({});
  bulk = $state<BulkState | null>(null);
  /** Il browser non permette di tenere acceso lo schermo durante i download massivi. */
  wakeLockUnsupported = $state(false);
  downloadedCount = $derived(Object.values(this.entries).filter((e) => e.status === 'downloaded').length);

  private readonly aborts = new Map<string, AbortController>();
  private running = false;
  private cancelRequested = false;
  private readonly caches: CacheStorage;
  private readonly fetch: typeof fetch;
  private readonly doc: Document;
  private readonly now: () => number;

  constructor(private readonly deps: DownloadsDeps) {
    this.caches = deps.caches ?? globalThis.caches;
    this.fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.doc = deps.doc ?? document;
    this.now = deps.now ?? Date.now;
  }

  status(trackId: string): DownloadStatus {
    return this.entries[trackId]?.status ?? 'none';
  }

  progress(trackId: string): number {
    return this.entries[trackId]?.progress ?? 0;
  }

  isDownloaded(trackId: string): boolean {
    return this.status(trackId) === 'downloaded';
  }

  private set(trackId: string, status: DownloadStatus, progress = status === 'downloaded' ? 1 : 0): void {
    if (status === 'none') {
      const { [trackId]: _removed, ...rest } = this.entries;
      this.entries = rest;
    } else {
      this.entries = { ...this.entries, [trackId]: { status, progress } };
    }
  }

  async init(): Promise<void> {
    const db = await this.deps.db();
    const records = await db.getAll('downloads');
    const queued = await db.getAll('downloadQueue');
    const next: Record<string, Entry> = {};
    for (const r of records) next[r.trackId] = { status: 'downloaded', progress: 1 };
    for (const q of queued) if (!next[q.trackId]) next[q.trackId] = { status: 'queued', progress: 0 };
    this.entries = next;
    await this.reconcile();
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    if (queued.length > 0 && !this.doc.hidden) void this.processQueue();
  }

  /** Ritorno in primo piano: riconcilia la cache e riprende i download in sospeso. */
  private onVisibility = () => {
    if (this.doc.hidden) return;
    void this.reconcile();
    void this.resumeIfPending();
  };

  private async resumeIfPending(): Promise<void> {
    if (this.running) return;
    const db = await this.deps.db();
    if ((await db.count('downloadQueue')) > 0) void this.processQueue();
  }

  /**
   * Il sistema operativo può eliminare la cache (iOS con poco spazio): i brani
   * mancanti tornano "non scaricati" e verranno riprodotti in streaming.
   */
  async reconcile(): Promise<string[]> {
    const db = await this.deps.db();
    const cache = await this.caches.open(AUDIO_CACHE);
    const missing: string[] = [];
    for (const r of await db.getAll('downloads')) {
      if (!(await cache.match(absolute(trackAudioUrl(r.trackId))))) {
        missing.push(r.trackId);
        await db.delete('downloads', r.trackId);
        if (this.status(r.trackId) === 'downloaded') this.set(r.trackId, 'none');
      }
    }
    return missing;
  }

  /** Verifica puntuale prima della riproduzione offline. */
  async isAvailableOffline(trackId: string): Promise<boolean> {
    if (!this.isDownloaded(trackId)) return false;
    const cache = await this.caches.open(AUDIO_CACHE);
    if (await cache.match(absolute(trackAudioUrl(trackId)))) return true;
    await this.reconcile();
    return false;
  }

  /** Scarica un brano completo; viene salvato in cache solo se integro. */
  async download(track: TrackDto, opts: { silent?: boolean } = {}): Promise<void> {
    if (this.isDownloaded(track.id) || this.status(track.id) === 'downloading') return;
    const abort = new AbortController();
    this.aborts.set(track.id, abort);
    this.set(track.id, 'downloading', 0);
    try {
      await this.fetchToCache(track, abort.signal);
      this.set(track.id, 'downloaded');
    } catch (err) {
      this.set(track.id, 'none');
      const cache = await this.caches.open(AUDIO_CACHE);
      await cache.delete(absolute(track.audioUrl));
      if (!abort.signal.aborted && !opts.silent) {
        this.deps.toasts.error(`Download di «${track.title}» non riuscito. Riprova quando sei online.`);
      }
      throw abort.signal.aborted ? new DownloadAborted() : err;
    } finally {
      this.aborts.delete(track.id);
    }
  }

  private async fetchToCache(track: TrackDto, signal: AbortSignal): Promise<void> {
    const res = await this.fetch(track.audioUrl, { credentials: 'same-origin', signal, cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || track.sizeBytes;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastReported = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const p = total > 0 ? received / total : 0;
      if (p - lastReported >= 0.02) {
        lastReported = p;
        this.set(track.id, 'downloading', Math.min(0.99, p));
      }
    }
    if (signal.aborted) throw new DownloadAborted();
    if (total > 0 && received !== total) throw new Error(`Download incompleto (${received}/${total} byte)`);

    const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
    const audioCache = await this.caches.open(AUDIO_CACHE);
    await audioCache.put(
      absolute(track.audioUrl),
      new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size) } }),
    );
    // Copertina grande per player e lockscreen offline (non bloccante).
    try {
      const cover = await this.fetch(track.coverUrl, { credentials: 'same-origin', signal });
      if (cover.ok) await (await this.caches.open(OFFLINE_COVER_CACHE)).put(absolute(track.coverUrl), cover);
    } catch {}
    const db = await this.deps.db();
    await db.put('tracks', $state.snapshot(track) as TrackDto);
    await db.put('downloads', { trackId: track.id, sizeBytes: blob.size, downloadedAt: this.now() });
  }

  async remove(trackId: string): Promise<void> {
    this.aborts.get(trackId)?.abort();
    const db = await this.deps.db();
    await db.delete('downloads', trackId);
    await db.delete('downloadQueue', trackId);
    await (await this.caches.open(AUDIO_CACHE)).delete(absolute(trackAudioUrl(trackId)));
    await (await this.caches.open(OFFLINE_COVER_CACHE)).delete(absolute(trackCoverUrl(trackId, 512)));
    this.set(trackId, 'none');
  }

  // ---------- download di playlist ----------

  /** Accoda tutti i brani (saltando quelli già scaricati) e li scarica uno alla volta. */
  async downloadAll(tracks: TrackDto[]): Promise<void> {
    const unique = [...new Map(tracks.map((t) => [t.id, t])).values()];
    const missing = unique.filter((t) => !this.isDownloaded(t.id));
    const already = unique.length - missing.length;
    if (missing.length === 0) {
      this.deps.toasts.show('Tutti i brani sono già scaricati');
      return;
    }
    const db = await this.deps.db();
    const batchId = Math.random().toString(36).slice(2);
    const base = this.now();
    const tx = db.transaction(['downloadQueue', 'tracks'], 'readwrite');
    await Promise.all([
      ...missing.map((t, i) =>
        tx.objectStore('downloadQueue').put({ trackId: t.id, enqueuedAt: base + i, batchId }),
      ),
      ...missing.map((t) => tx.objectStore('tracks').put($state.snapshot(t) as TrackDto)),
      tx.done,
    ]);
    for (const t of missing) if (this.status(t.id) === 'none') this.set(t.id, 'queued');
    if (this.bulk) {
      this.bulk = { ...this.bulk, total: this.bulk.total + missing.length };
    } else {
      this.bulk = { total: unique.length, done: already, failed: 0, currentTitle: null, dim: false };
    }
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelRequested = false;
    const db = await this.deps.db();
    if (!this.bulk) {
      // Ripresa dopo un riavvio dell'app.
      this.bulk = {
        total: await db.count('downloadQueue'),
        done: 0,
        failed: 0,
        currentTitle: null,
        dim: false,
      };
    }
    const locked = await this.deps.wakeLock.acquire();
    this.wakeLockUnsupported = !locked;
    if (!locked)
      this.deps.toasts.show('Tieni lo schermo acceso fino al termine del download.', { durationMs: 8000 });

    let finished = false;
    try {
      for (;;) {
        if (this.cancelRequested) break;
        if (this.doc.hidden) break; // si riprende al ritorno in primo piano
        const next = (await db.getAllFromIndex('downloadQueue', 'byEnqueued', undefined, 1))[0];
        if (!next) {
          finished = true;
          break;
        }
        const track = await db.get('tracks', next.trackId);
        if (!track || this.isDownloaded(next.trackId)) {
          await db.delete('downloadQueue', next.trackId);
          if (this.bulk) this.bulk = { ...this.bulk, done: this.bulk.done + 1 };
          continue;
        }
        if (this.bulk) this.bulk = { ...this.bulk, currentTitle: track.title };
        try {
          await this.download(track, { silent: true });
        } catch (err) {
          if (this.cancelRequested || this.doc.hidden) break; // resta in coda
          if (this.bulk) this.bulk = { ...this.bulk, failed: this.bulk.failed + 1 };
        }
        await db.delete('downloadQueue', next.trackId);
        if (this.bulk) this.bulk = { ...this.bulk, done: this.bulk.done + 1 };
      }
    } finally {
      this.running = false;
      if (finished || this.cancelRequested) {
        await this.deps.wakeLock.release();
        const failed = this.bulk?.failed ?? 0;
        if (finished && this.bulk) {
          this.deps.toasts.show(
            failed > 0 ? `Download completato, ${failed} brani non riusciti` : 'Download completato',
            { kind: failed > 0 ? 'error' : 'info' },
          );
        }
        this.bulk = null;
      }
    }
  }

  /** Annulla: i brani già scaricati restano, gli altri escono dalla coda. */
  async cancelBulk(): Promise<void> {
    this.cancelRequested = true;
    for (const a of this.aborts.values()) a.abort();
    const db = await this.deps.db();
    const queued = await db.getAllKeys('downloadQueue');
    await db.clear('downloadQueue');
    for (const id of queued) if (this.status(id) !== 'downloaded') this.set(id, 'none');
    await this.deps.wakeLock.release();
    this.bulk = null;
  }

  setDim(dim: boolean): void {
    if (this.bulk) this.bulk = { ...this.bulk, dim };
  }

  destroy(): void {
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }
}
