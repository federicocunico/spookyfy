import {
  ErrorCode,
  type FavoriteDto,
  type ListTracksQuery,
  type Page,
  type PlayEvent,
  type PlaylistDto,
  type PlaylistItemDto,
  type PlaylistSummaryDto,
  type SubmitPlaysResult,
  type TrackDto,
  type UpdateTrackBody,
  playlistNameSchema,
  updateTrackBodySchema,
} from '@spookyfy/shared';
import { ApiError } from '../api';
import type { Db, LocalPlaylistItemRecord, LocalPlaylistRecord, LocalTrackRecord } from '../offline/db';
import { getSettings, patchSettings } from './settings';
import { type SilenceAnalyzer, analyzeSilence } from './silence';

/** Cache dei file della modalità client (condivise con il Service Worker, sw.ts). */
export const DEVICE_AUDIO_CACHE = 'spk-device-audio-v1';
export const DEVICE_COVER_CACHE = 'spk-device-covers-v1';

/**
 * Gli URL /local/* li serve il Service Worker. Se non controlla la pagina (prima visita
 * prima che si attivi, ricarica forzata con Ctrl+F5) andrebbero in rete: in quel caso si
 * legge il file direttamente dalla Cache Storage. null = il Service Worker c'è.
 */
export function localFallbackSrc(url: string): Promise<string | null> | null {
  if (!url.startsWith('/local/') || typeof caches === 'undefined') return null;
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) return null;
  return (async () => {
    const cacheName = url.startsWith('/local/audio/') ? DEVICE_AUDIO_CACHE : DEVICE_COVER_CACHE;
    const res = await (await caches.open(cacheName)).match(absolute(url)).catch(() => undefined);
    return res ? URL.createObjectURL(await res.blob()) : null;
  })();
}

export const localAudioUrl = (id: string) => `/local/audio/${encodeURIComponent(id)}`;
export const localCoverUrl = (id: string, size: 512 | 128 = 512) =>
  `/local/cover/${encodeURIComponent(id)}?size=${size}`;

const absolute = (url: string) => new URL(url, globalThis.location?.href ?? 'http://localhost').href;

/** Minuscole senza accenti, per la ricerca per prefisso. */
export const normalizeText = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => normalizeText(s).match(/[\p{L}\p{N}]+/gu) ?? [];

const notFound = (what: string) => new ApiError(404, ErrorCode.NotFound, `${what} non trovato`);
const invalid = (field: string, message: string) =>
  new ApiError(400, ErrorCode.ValidationFailed, message, { [field]: [message] });

/** Stesse regole del server per il nome delle playlist (1–100 caratteri). */
function validName(name: string): string {
  const r = playlistNameSchema.safeParse(name);
  if (!r.success) throw invalid('name', r.error.issues[0]?.message ?? 'Nome non valido');
  return r.data;
}

export interface NewTrack {
  record: Omit<LocalTrackRecord, 'id' | 'addedAt'> & { id?: string; addedAt?: number };
  audio: Blob;
  cover512: Blob;
  cover128: Blob;
}

export interface DeviceLibraryDeps {
  db: () => Promise<Db>;
  caches?: CacheStorage;
  now?: () => number;
  uuid?: () => string;
  /** Auto-trim: silenzio ai bordi dei brani (predefinito: decodifica nel browser). */
  analyzeSilence?: SilenceAnalyzer;
}

/** Sotto questa distanza fra posizioni vicine si rinumera la playlist (come sul server). */
const MIN_POSITION_GAP = 1e-9;

/**
 * Libreria completamente sul dispositivo (modalità client): metadati in
 * IndexedDB, file audio e copertine in Cache Storage sotto URL `/local/*`
 * serviti dal Service Worker. Un indice in memoria rende immediate ricerche e liste.
 */
export class DeviceLibrary {
  private tracks = new Map<string, LocalTrackRecord>();
  private favorites = new Map<string, number>();
  private playStats = new Map<string, { count: number; last: number }>();
  private loaded: Promise<void> | null = null;
  private readonly caches: CacheStorage;
  private readonly now: () => number;
  private readonly uuid: () => string;
  /** Chiamato quando cambia l'insieme dei brani (aggiunte, eliminazioni, perdite). */
  onChange: (() => void) | null = null;

  constructor(private readonly deps: DeviceLibraryDeps) {
    this.caches = deps.caches ?? globalThis.caches;
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
  }

  ready(): Promise<void> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  private async load(): Promise<void> {
    const db = await this.deps.db();
    this.tracks = new Map((await db.getAll('libTracks')).map((t) => [t.id, t]));
    this.favorites = new Map((await db.getAll('libFavorites')).map((f) => [f.trackId, f.createdAt]));
    this.playStats = new Map();
    for (const p of await db.getAll('libPlays')) this.bumpStats(p);
  }

  private bumpStats(p: PlayEvent) {
    const s = this.playStats.get(p.trackId) ?? { count: 0, last: 0 };
    this.playStats.set(p.trackId, { count: s.count + 1, last: Math.max(s.last, p.playedAt) });
  }

  private changed() {
    this.onChange?.();
  }

  // ---------- brani ----------

  toDto(t: LocalTrackRecord): TrackDto {
    const stats = this.playStats.get(t.id);
    return {
      id: t.id,
      sourceId: t.sourceKey.startsWith('youtube:') ? t.sourceKey.slice(8) : t.sourceKey,
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationMs: t.durationMs,
      ...(t.trimStartMs ? { trimStartMs: t.trimStartMs } : {}),
      ...(t.trimEndMs ? { trimEndMs: t.trimEndMs } : {}),
      sizeBytes: t.sizeBytes,
      dominantColor: t.dominantColor,
      addedAt: t.addedAt,
      audioUrl: localAudioUrl(t.id),
      coverUrl: localCoverUrl(t.id, 512),
      coverThumbUrl: localCoverUrl(t.id, 128),
      isFavorite: this.favorites.has(t.id),
      playCount: stats?.count ?? 0,
      lastPlayedAt: stats?.last ?? null,
    };
  }

  record(id: string): LocalTrackRecord | undefined {
    return this.tracks.get(id);
  }

  bySourceKey(key: string): LocalTrackRecord | undefined {
    for (const t of this.tracks.values()) if (t.sourceKey === key) return t;
    return undefined;
  }

  /** Il brano è riproducibile dal dispositivo (presente e con il file). */
  isLocal(id: string): boolean {
    const t = this.tracks.get(id);
    return Boolean(t && !t.lost);
  }

  lostTracks(): LocalTrackRecord[] {
    return [...this.tracks.values()].filter((t) => t.lost);
  }

  usage(): { count: number; bytes: number } {
    let bytes = 0;
    for (const t of this.tracks.values()) if (!t.lost) bytes += t.sizeBytes;
    return { count: this.tracks.size, bytes };
  }

  async list(q: Partial<ListTracksQuery>): Promise<Page<TrackDto>> {
    await this.ready();
    let items = [...this.tracks.values()];
    const query = q.q?.trim();
    if (query) {
      const needles = words(query);
      if (needles.length === 0) return { items: [], nextCursor: null };
      items = items.filter((t) => {
        const hay = [...words(t.title), ...words(t.artist), ...words(t.album ?? '')];
        return needles.every((n) => hay.some((w) => w.startsWith(n)));
      });
    }
    const sort = q.sort ?? 'added';
    const collator = new Intl.Collator('it', { sensitivity: 'base' });
    items.sort((a, b) =>
      sort === 'title'
        ? collator.compare(a.title, b.title) || a.id.localeCompare(b.id)
        : sort === 'artist'
          ? collator.compare(a.artist, b.artist) || a.id.localeCompare(b.id)
          : b.addedAt - a.addedAt || b.id.localeCompare(a.id),
    );
    const limit = q.limit ?? 50;
    let offset = 0;
    if (q.cursor) {
      try {
        offset = (JSON.parse(atob(q.cursor)) as { o: number }).o;
      } catch {
        throw invalid('cursor', 'Cursore non valido');
      }
    }
    const page = items.slice(offset, offset + limit);
    return {
      items: page.map((t) => this.toDto(t)),
      nextCursor: offset + limit < items.length ? btoa(JSON.stringify({ o: offset + limit })) : null,
    };
  }

  async get(id: string): Promise<TrackDto> {
    await this.ready();
    const t = this.tracks.get(id);
    if (!t) throw notFound('Brano');
    return this.toDto(t);
  }

  /** Salva file e metadati; il brano compare solo quando tutto è stato scritto. */
  async addTrack(n: NewTrack): Promise<TrackDto> {
    await this.ready();
    const id = n.record.id ?? this.uuid();
    // Auto-trim calcolato qui per ogni provenienza (file, YouTube, ponte); un backup lo porta già.
    const trim = n.record.silenceChecked ? null : await this.analyze(n.audio);
    const record: LocalTrackRecord = {
      ...n.record,
      ...(trim ? { ...trim, silenceChecked: true } : {}),
      id,
      addedAt: n.record.addedAt ?? this.now(),
      lost: false,
    };
    const audioCache = await this.caches.open(DEVICE_AUDIO_CACHE);
    const coverCache = await this.caches.open(DEVICE_COVER_CACHE);
    const put = (cache: Cache, url: string, blob: Blob, type: string) =>
      cache.put(
        absolute(url),
        new Response(blob, { headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } }),
      );
    try {
      await put(audioCache, localAudioUrl(id), n.audio, record.mimeType);
      await put(coverCache, localCoverUrl(id, 512), n.cover512, 'image/jpeg');
      await put(coverCache, localCoverUrl(id, 128), n.cover128, 'image/jpeg');
      await (await this.deps.db()).put('libTracks', record);
    } catch (err) {
      await this.deleteFiles(id);
      throw err;
    }
    this.tracks.set(id, record);
    // Per il promemoria di backup: brani aggiunti dall'ultima esportazione.
    const db = await this.deps.db();
    await patchSettings(db, { addedSinceBackup: (await getSettings(db)).addedSinceBackup + 1 }).catch(
      () => {},
    );
    this.changed();
    return this.toDto(record);
  }

  private analyze(audio: Blob) {
    return (this.deps.analyzeSilence ?? analyzeSilence)(audio).catch(() => null);
  }

  /**
   * Auto-trim dei brani mai analizzati (importati prima della funzione o in un browser che
   * non li decodificava): uno alla volta, dai più recenti. Restituisce i brani analizzati.
   */
  async analyzeSilenceBacklog(signal?: AbortSignal): Promise<number> {
    await this.ready();
    const pending = [...this.tracks.values()]
      .filter((t) => !t.silenceChecked && !t.lost)
      .sort((a, b) => b.addedAt - a.addedAt);
    let analyzed = 0;
    let failures = 0;
    const audioCache = await this.caches.open(DEVICE_AUDIO_CACHE);
    for (const t of pending) {
      if (signal?.aborted || failures >= 3) break;
      const res = await audioCache.match(absolute(localAudioUrl(t.id)));
      const trim = res ? await this.analyze(await res.blob()) : null;
      if (!trim) {
        failures++;
        continue;
      }
      failures = 0;
      const current = this.tracks.get(t.id);
      if (!current) continue;
      const { trimStartMs: _s, trimEndMs: _e, ...rest } = current;
      const record: LocalTrackRecord = { ...rest, ...trim, silenceChecked: true };
      await (await this.deps.db()).put('libTracks', record);
      this.tracks.set(t.id, record);
      analyzed++;
    }
    if (analyzed) this.changed();
    return analyzed;
  }

  private async deleteFiles(id: string): Promise<void> {
    await (await this.caches.open(DEVICE_AUDIO_CACHE)).delete(absolute(localAudioUrl(id)));
    const covers = await this.caches.open(DEVICE_COVER_CACHE);
    await covers.delete(absolute(localCoverUrl(id, 512)));
    await covers.delete(absolute(localCoverUrl(id, 128)));
  }

  async updateTrack(id: string, rawBody: UpdateTrackBody): Promise<TrackDto> {
    const parsed = updateTrackBodySchema.safeParse(rawBody);
    if (!parsed.success) throw invalid('_', parsed.error.issues[0]?.message ?? 'Valori non validi');
    const body = parsed.data;
    await this.ready();
    const t = this.tracks.get(id);
    if (!t) throw notFound('Brano');
    const next: LocalTrackRecord = {
      ...t,
      title: body.title ?? t.title,
      artist: body.artist ?? t.artist,
      album: body.album === undefined ? t.album : body.album || null,
    };
    await (await this.deps.db()).put('libTracks', next);
    this.tracks.set(id, next);
    return this.toDto(next);
  }

  /** Elimina il brano, il suo spazio e i riferimenti in preferiti, playlist e ascolti. */
  async deleteTrack(id: string): Promise<void> {
    await this.ready();
    if (!this.tracks.has(id)) throw notFound('Brano');
    const db = await this.deps.db();
    const items = await db.getAllFromIndex('libPlaylistItems', 'byTrack', id);
    const plays = await db.getAllKeysFromIndex('libPlays', 'byTrack', id);
    const tx = db.transaction(['libTracks', 'libFavorites', 'libPlaylistItems', 'libPlays'], 'readwrite');
    await Promise.all([
      tx.objectStore('libTracks').delete(id),
      tx.objectStore('libFavorites').delete(id),
      ...items.map((i) => tx.objectStore('libPlaylistItems').delete(i.id)),
      ...plays.map((k) => tx.objectStore('libPlays').delete(k)),
      tx.done,
    ]);
    await this.deleteFiles(id);
    this.tracks.delete(id);
    this.favorites.delete(id);
    this.playStats.delete(id);
    this.changed();
  }

  /** Sostituisce i file di un brano perso (riscaricamento), mantenendo id e riferimenti. */
  async restoreFiles(
    id: string,
    files: { audio: Blob; cover512: Blob; cover128: Blob; sizeBytes: number; mimeType: string },
  ) {
    const t = this.tracks.get(id);
    if (!t) throw notFound('Brano');
    await this.deleteFiles(id);
    const audioCache = await this.caches.open(DEVICE_AUDIO_CACHE);
    const coverCache = await this.caches.open(DEVICE_COVER_CACHE);
    await audioCache.put(
      absolute(localAudioUrl(id)),
      new Response(files.audio, { headers: { 'Content-Type': files.mimeType } }),
    );
    await coverCache.put(
      absolute(localCoverUrl(id, 512)),
      new Response(files.cover512, { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    await coverCache.put(
      absolute(localCoverUrl(id, 128)),
      new Response(files.cover128, { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    const next = { ...t, lost: false, sizeBytes: files.sizeBytes, mimeType: files.mimeType };
    await (await this.deps.db()).put('libTracks', next);
    this.tracks.set(id, next);
    this.changed();
    return this.toDto(next);
  }

  /**
   * Il sistema può eliminare la cache (iOS con poco spazio): i brani senza file
   * vengono marcati come persi. Restituisce gli id persi in questo controllo.
   */
  async reconcile(): Promise<string[]> {
    await this.ready();
    const cache = await this.caches.open(DEVICE_AUDIO_CACHE);
    const db = await this.deps.db();
    const newlyLost: string[] = [];
    for (const t of this.tracks.values()) {
      if (t.lost) continue;
      if (!(await cache.match(absolute(localAudioUrl(t.id))))) {
        const next = { ...t, lost: true };
        await db.put('libTracks', next);
        this.tracks.set(t.id, next);
        newlyLost.push(t.id);
      }
    }
    if (newlyLost.length) this.changed();
    return newlyLost;
  }

  // ---------- preferiti ----------

  async listFavorites(): Promise<FavoriteDto[]> {
    await this.ready();
    return [...this.favorites.entries()]
      .filter(([id]) => this.tracks.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id, createdAt]) => ({ track: this.toDto(this.tracks.get(id)!), favoritedAt: createdAt }));
  }

  async setFavorite(trackId: string, on: boolean): Promise<void> {
    await this.ready();
    if (!this.tracks.has(trackId)) throw notFound('Brano');
    const db = await this.deps.db();
    if (on) {
      if (this.favorites.has(trackId)) return;
      const createdAt = this.now();
      await db.put('libFavorites', { trackId, createdAt });
      this.favorites.set(trackId, createdAt);
    } else {
      await db.delete('libFavorites', trackId);
      this.favorites.delete(trackId);
    }
  }

  // ---------- ascolti ----------

  /** Idempotente: lo stesso id viene contato una volta. */
  async submitPlays(plays: PlayEvent[]): Promise<SubmitPlaysResult> {
    await this.ready();
    const db = await this.deps.db();
    let recorded = 0;
    for (const p of plays) {
      if (!this.tracks.has(p.trackId) || (await db.get('libPlays', p.id))) continue;
      await db.put('libPlays', p);
      this.bumpStats(p);
      recorded++;
    }
    return { recorded, ignored: plays.length - recorded };
  }

  /** Ascoltati di recente, senza duplicati, dal più recente. */
  async recent(limit: number): Promise<TrackDto[]> {
    await this.ready();
    return [...this.playStats.entries()]
      .filter(([id]) => this.tracks.has(id))
      .sort((a, b) => b[1].last - a[1].last)
      .slice(0, limit)
      .map(([id]) => this.toDto(this.tracks.get(id)!));
  }

  // ---------- playlist ----------

  private async playlist(id: string): Promise<LocalPlaylistRecord> {
    const p = await (await this.deps.db()).get('libPlaylists', id);
    if (!p) throw notFound('Playlist');
    return p;
  }

  private async items(playlistId: string): Promise<LocalPlaylistItemRecord[]> {
    const items = await (await this.deps.db()).getAllFromIndex('libPlaylistItems', 'byPlaylist', playlistId);
    return items.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  private summary(p: LocalPlaylistRecord, items: LocalPlaylistItemRecord[]): PlaylistSummaryDto {
    const present = items.filter((i) => this.tracks.has(i.trackId));
    return {
      id: p.id,
      name: p.name,
      trackCount: present.length,
      durationMs: present.reduce((s, i) => s + this.tracks.get(i.trackId)!.durationMs, 0),
      coverTrackIds: [...new Set(present.map((i) => i.trackId))].slice(0, 4),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  async listPlaylists(): Promise<PlaylistSummaryDto[]> {
    await this.ready();
    const db = await this.deps.db();
    const all = await db.getAll('libPlaylists');
    const out = await Promise.all(all.map(async (p) => this.summary(p, await this.items(p.id))));
    return out.sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  }

  async getPlaylist(id: string): Promise<PlaylistDto> {
    await this.ready();
    const p = await this.playlist(id);
    const items = await this.items(id);
    const dtoItems: PlaylistItemDto[] = items
      .filter((i) => this.tracks.has(i.trackId))
      .map((i) => ({ itemId: i.id, addedAt: i.addedAt, track: this.toDto(this.tracks.get(i.trackId)!) }));
    return { ...this.summary(p, items), items: dtoItems };
  }

  async createPlaylist(
    rawName: string,
    opts: { id?: string; createdAt?: number } = {},
  ): Promise<PlaylistDto> {
    const name = validName(rawName);
    const now = this.now();
    const p: LocalPlaylistRecord = {
      id: opts.id ?? this.uuid(),
      name,
      createdAt: opts.createdAt ?? now,
      updatedAt: now,
    };
    await (await this.deps.db()).put('libPlaylists', p);
    return this.getPlaylist(p.id);
  }

  private async touch(p: LocalPlaylistRecord, name = p.name) {
    await (await this.deps.db()).put('libPlaylists', { ...p, name, updatedAt: this.now() });
  }

  async renamePlaylist(id: string, rawName: string): Promise<PlaylistSummaryDto> {
    const name = validName(rawName);
    const p = await this.playlist(id);
    await this.touch(p, name);
    return this.summary({ ...p, name }, await this.items(id));
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.playlist(id);
    const db = await this.deps.db();
    const items = await this.items(id);
    const tx = db.transaction(['libPlaylists', 'libPlaylistItems'], 'readwrite');
    await Promise.all([
      tx.objectStore('libPlaylists').delete(id),
      ...items.map((i) => tx.objectStore('libPlaylistItems').delete(i.id)),
      tx.done,
    ]);
  }

  async addItem(id: string, trackId: string): Promise<PlaylistItemDto> {
    await this.ready();
    const p = await this.playlist(id);
    const t = this.tracks.get(trackId);
    if (!t) throw notFound('Brano');
    const items = await this.items(id);
    const item: LocalPlaylistItemRecord = {
      id: this.uuid(),
      playlistId: id,
      trackId,
      position: (items.at(-1)?.position ?? 0) + 1,
      addedAt: this.now(),
    };
    await (await this.deps.db()).put('libPlaylistItems', item);
    await this.touch(p);
    return { itemId: item.id, addedAt: item.addedAt, track: this.toDto(t) };
  }

  async removeItem(id: string, itemId: string): Promise<void> {
    const p = await this.playlist(id);
    const db = await this.deps.db();
    const item = await db.get('libPlaylistItems', itemId);
    if (!item || item.playlistId !== id) throw notFound('Elemento');
    await db.delete('libPlaylistItems', itemId);
    await this.touch(p);
  }

  async moveItem(id: string, itemId: string, toIndex: number): Promise<PlaylistDto> {
    const p = await this.playlist(id);
    const db = await this.deps.db();
    let items = await this.items(id);
    const moving = items.find((i) => i.id === itemId);
    if (!moving) throw notFound('Elemento');
    const others = () => items.filter((i) => i.id !== itemId);
    const target = Math.min(toIndex, others().length);
    let [prev, next] = [others()[target - 1], others()[target]];
    if (prev && next && next.position - prev.position < MIN_POSITION_GAP) {
      await Promise.all(items.map((it, i) => db.put('libPlaylistItems', { ...it, position: i + 1 })));
      items = await this.items(id);
      [prev, next] = [others()[target - 1], others()[target]];
    }
    const position =
      prev && next
        ? (prev.position + next.position) / 2
        : prev
          ? prev.position + 1
          : next
            ? next.position - 1
            : 1;
    await db.put('libPlaylistItems', { ...moving, position });
    await this.touch(p);
    return this.getPlaylist(id);
  }

  // ---------- backup ----------

  /** Tutti i dati per l'esportazione (snapshot coerente). */
  async snapshot() {
    await this.ready();
    const db = await this.deps.db();
    return {
      tracks: [...this.tracks.values()],
      favorites: await db.getAll('libFavorites'),
      playlists: await db.getAll('libPlaylists'),
      items: await db.getAll('libPlaylistItems'),
      plays: await db.getAll('libPlays'),
    };
  }

  /** Inserimento diretto usato dall'importazione di un backup. */
  async importRecords(r: {
    tracks?: LocalTrackRecord[];
    favorites?: { trackId: string; createdAt: number }[];
    playlists?: LocalPlaylistRecord[];
    items?: LocalPlaylistItemRecord[];
    plays?: PlayEvent[];
  }): Promise<void> {
    const db = await this.deps.db();
    for (const t of r.tracks ?? []) {
      await db.put('libTracks', t);
      this.tracks.set(t.id, t);
    }
    for (const f of r.favorites ?? []) {
      await db.put('libFavorites', f);
      this.favorites.set(f.trackId, f.createdAt);
    }
    for (const p of r.playlists ?? []) await db.put('libPlaylists', p);
    for (const i of r.items ?? []) await db.put('libPlaylistItems', i);
    for (const p of r.plays ?? []) {
      if (await db.get('libPlays', p.id)) continue;
      await db.put('libPlays', p);
      this.bumpStats(p);
    }
    this.changed();
  }
}
