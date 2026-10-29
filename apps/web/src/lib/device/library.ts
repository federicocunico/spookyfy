import {
  ALBUM_COVER_MAX_BYTES,
  ALBUM_COVER_TYPES,
  ALBUM_DEFAULT_ARTIST,
  type AlbumDto,
  type AlbumSort,
  type AlbumSummaryDto,
  type CreateAlbumBody,
  ErrorCode,
  type FavoriteDto,
  type GenreDetailDto,
  type GenreDto,
  type ListTracksQuery,
  type Page,
  type PlayEvent,
  type PlaylistDto,
  type PlaylistItemDto,
  type PlaylistSummaryDto,
  type SubmitPlaysResult,
  type TrackDto,
  type UpdateAlbumBody,
  type UpdateTrackBody,
  albumGenresBodySchema,
  albumKey,
  commonGenres,
  createAlbumBodySchema,
  genreKey,
  normalizeGenres,
  playlistNameSchema,
  trackGenresBodySchema,
  updateAlbumBodySchema,
  updateTrackBodySchema,
} from '@spookyfy/shared';
import { ApiError } from '../api';
import type {
  Db,
  LocalAlbumRecord,
  LocalPlaylistItemRecord,
  LocalPlaylistRecord,
  LocalTrackRecord,
} from '../offline/db';
import { type CoverProcessor, processCover as defaultProcessCover } from './cover';
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
/** Copertina assegnata a un album; `v` cambia a ogni nuova copertina. */
export const localAlbumCoverUrl = (id: string, size: 512 | 128, version: number) =>
  `/local/album-cover/${encodeURIComponent(id)}?size=${size}&v=${version}`;
const albumRecordKey = (title: string, artist: string) => `${albumKey(title)}\u0000${albumKey(artist)}`;
/** Colore della copertina segnaposto di un album vuoto. */
const PLACEHOLDER_COLOR = '#b69cff';

const absolute = (url: string) => new URL(url, globalThis.location?.href ?? 'http://localhost').href;

/** Minuscole senza accenti, per la ricerca per prefisso. */
export const normalizeText = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => normalizeText(s).match(/[\p{L}\p{N}]+/gu) ?? [];

const notFound = (what: string) => new ApiError(404, ErrorCode.NotFound, `${what} non trovato`);
const conflict = () =>
  new ApiError(409, ErrorCode.Conflict, 'Esiste già un album con questo titolo e artista');
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
  /** Artista dell'album dai tag (per il raggruppamento); assente = artista del brano. */
  albumArtist?: string | null;
  /** Numero di traccia dai tag: posizione nell'album. */
  trackNo?: number | null;
}

export interface DeviceLibraryDeps {
  db: () => Promise<Db>;
  caches?: CacheStorage;
  now?: () => number;
  uuid?: () => string;
  /** Auto-trim: silenzio ai bordi dei brani (predefinito: decodifica nel browser). */
  analyzeSilence?: SilenceAnalyzer;
  /** Copertine assegnate agli album: ritaglio quadrato e colore dominante. */
  processCover?: CoverProcessor;
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
  private albums = new Map<string, LocalAlbumRecord>();
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

  /** Database del dispositivo (impostazioni della ricerca online). */
  database(): Promise<Db> {
    return this.deps.db();
  }

  ready(): Promise<void> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  private async load(): Promise<void> {
    const db = await this.deps.db();
    this.tracks = new Map((await db.getAll('libTracks')).map((t) => [t.id, t]));
    this.albums = new Map((await db.getAll('libAlbums')).map((a) => [a.id, a]));
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
    // Una copertina assegnata all'album prende il posto di quella del brano.
    const album = t.albumId ? this.albums.get(t.albumId) : undefined;
    const albumCover = album?.hasCover ? album : undefined;
    return {
      id: t.id,
      sourceId: t.sourceKey.startsWith('youtube:') ? t.sourceKey.slice(8) : t.sourceKey,
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumId: album ? album.id : null,
      genres: t.genres ?? [],
      durationMs: t.durationMs,
      ...(t.trimStartMs ? { trimStartMs: t.trimStartMs } : {}),
      ...(t.trimEndMs ? { trimEndMs: t.trimEndMs } : {}),
      sizeBytes: t.sizeBytes,
      dominantColor: albumCover?.coverColor ?? t.dominantColor,
      addedAt: t.addedAt,
      audioUrl: localAudioUrl(t.id),
      coverUrl: albumCover
        ? localAlbumCoverUrl(albumCover.id, 512, albumCover.coverVersion)
        : localCoverUrl(t.id, 512),
      coverThumbUrl: albumCover
        ? localAlbumCoverUrl(albumCover.id, 128, albumCover.coverVersion)
        : localCoverUrl(t.id, 128),
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
        const hay = [
          ...words(t.title),
          ...words(t.artist),
          ...words(t.album ?? ''),
          ...(t.genres ?? []).flatMap(words),
        ];
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
      genres: normalizeGenres(n.record.genres ?? [], this.genreNames()),
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
    // Raggruppamento automatico: il brano entra nell'album indicato dai metadati.
    if (record.album?.trim() && !record.albumId)
      await this.assignByMetadata(id, record.album, n.albumArtist?.trim() || record.artist, n.trackNo);
    // Per il promemoria di backup: brani aggiunti dall'ultima esportazione.
    const db = await this.deps.db();
    await patchSettings(db, { addedSinceBackup: (await getSettings(db)).addedSinceBackup + 1 }).catch(
      () => {},
    );
    this.changed();
    return this.toDto(this.tracks.get(id)!);
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
    await this.putTrack(next);
    // Il campo album sposta il brano nell'album con quel titolo (creato se manca).
    if (body.album !== undefined) await this.moveByTitle(id, next.album);
    return this.toDto(this.tracks.get(id)!);
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
    const albumId = this.tracks.get(id)?.albumId;
    this.tracks.delete(id);
    this.favorites.delete(id);
    this.playStats.delete(id);
    if (albumId) await this.dropIfEmptyAuto(albumId);
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

  // ---------- album ----------

  private async putTrack(t: LocalTrackRecord): Promise<void> {
    await (await this.deps.db()).put('libTracks', t);
    this.tracks.set(t.id, t);
  }

  private async putAlbum(a: LocalAlbumRecord): Promise<void> {
    await (await this.deps.db()).put('libAlbums', a);
    this.albums.set(a.id, a);
  }

  private album(id: string): LocalAlbumRecord {
    const a = this.albums.get(id);
    if (!a) throw notFound('Album');
    return a;
  }

  /** Brani dell'album nell'ordine dell'album. */
  private albumTracks(id: string): LocalTrackRecord[] {
    return [...this.tracks.values()]
      .filter((t) => t.albumId === id)
      .sort((a, b) => (a.albumPosition ?? 0) - (b.albumPosition ?? 0) || a.id.localeCompare(b.id));
  }

  private albumSummary(a: LocalAlbumRecord): AlbumSummaryDto {
    const tracks = this.albumTracks(a.id);
    const first = tracks[0];
    const cover = (size: 512 | 128) =>
      a.hasCover
        ? localAlbumCoverUrl(a.id, size, a.coverVersion)
        : first
          ? localCoverUrl(first.id, size)
          : localAlbumCoverUrl(a.id, size, 0);
    return {
      id: a.id,
      title: a.title,
      artist: a.artist,
      year: a.year,
      origin: a.origin,
      trackCount: tracks.length,
      durationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
      coverUrl: cover(512),
      coverThumbUrl: cover(128),
      dominantColor: (a.hasCover && a.coverColor) || first?.dominantColor || PLACEHOLDER_COLOR,
      hasCustomCover: a.hasCover,
      addedAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  async listAlbums(sort: AlbumSort = 'added', q?: string): Promise<AlbumSummaryDto[]> {
    await this.ready();
    const collator = new Intl.Collator('it', { sensitivity: 'base' });
    const needles = q?.trim() ? words(q) : null;
    return [...this.albums.values()]
      .filter((a) => {
        if (!needles) return true;
        const hay = [...words(a.title), ...words(a.artist)];
        return needles.length > 0 && needles.every((n) => hay.some((w) => w.startsWith(n)));
      })
      .sort((a, b) =>
        sort === 'title'
          ? collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist)
          : sort === 'artist'
            ? collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title)
            : b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      )
      .map((a) => this.albumSummary(a));
  }

  async getAlbum(id: string): Promise<AlbumDto> {
    await this.ready();
    const a = this.album(id);
    const tracks = this.albumTracks(id).map((t) => this.toDto(t));
    return { ...this.albumSummary(a), genres: commonGenres(tracks.map((t) => t.genres)), tracks };
  }

  /** Album con lo stesso titolo e artista (normalizzati), creato se manca. */
  async findOrCreateAlbum(title: string, artist: string, origin: 'auto' | 'manual'): Promise<string> {
    await this.ready();
    const key = albumRecordKey(title, artist);
    for (const a of this.albums.values()) if (a.key === key) return a.id;
    const now = this.now();
    const a: LocalAlbumRecord = {
      id: this.uuid(),
      title: title.trim(),
      artist: artist.trim(),
      year: null,
      key,
      origin,
      hasCover: false,
      coverColor: null,
      coverVersion: 0,
      lookupStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await this.putAlbum(a);
    this.onAlbumCreated?.(a.id);
    return a.id;
  }

  /** Un album nuovo senza copertina: da cercare online (vedi services). */
  onAlbumCreated: ((albumId: string) => void) | null = null;

  /**
   * Unico punto in cui un brano entra o esce da un album: allinea il campo `album` ed
   * elimina gli album automatici rimasti vuoti. `position` assoluta (numero di traccia);
   * assente = in coda.
   */
  async setTrackAlbum(trackId: string, albumId: string | null, position?: number): Promise<void> {
    await this.ready();
    const t = this.tracks.get(trackId);
    if (!t) throw notFound('Brano');
    const prev = t.albumId ?? null;
    if (albumId === null) {
      await this.putTrack({ ...t, albumId: null, albumPosition: null, album: null });
    } else {
      const a = this.album(albumId);
      const pos =
        prev === albumId && position === undefined
          ? (t.albumPosition ?? 1)
          : (position ??
            Math.max(
              0,
              ...this.albumTracks(albumId)
                .filter((o) => o.id !== trackId)
                .map((o) => o.albumPosition ?? 0),
            ) + 1);
      await this.putTrack({ ...t, albumId, albumPosition: pos, album: a.title });
      await this.putAlbum({ ...a, updatedAt: this.now() });
    }
    if (prev && prev !== albumId) await this.dropIfEmptyAuto(prev);
  }

  /** Inserisce il brano nell'album indicato dai metadati (titolo e artista dell'album). */
  async assignByMetadata(
    trackId: string,
    album: string | null,
    albumArtist: string,
    trackNo?: number | null,
  ): Promise<void> {
    const title = album?.trim();
    if (!title) return this.setTrackAlbum(trackId, null);
    const id = await this.findOrCreateAlbum(title, albumArtist.trim() || ALBUM_DEFAULT_ARTIST, 'auto');
    await this.setTrackAlbum(trackId, id, trackNo && trackNo > 0 ? trackNo : undefined);
  }

  /** Cambio del campo "album" di un brano: lo sposta nell'album con quel titolo e lo stesso artista. */
  private async moveByTitle(trackId: string, album: string | null): Promise<void> {
    const t = this.tracks.get(trackId)!;
    const current = t.albumId ? this.albums.get(t.albumId) : undefined;
    if (album && current && albumKey(current.title) === albumKey(album)) {
      await this.putTrack({ ...t, album: current.title });
      return;
    }
    await this.assignByMetadata(trackId, album, current?.artist ?? t.artist);
  }

  private async dropIfEmptyAuto(id: string): Promise<void> {
    const a = this.albums.get(id);
    if (!a || a.origin !== 'auto' || this.albumTracks(id).length > 0) return;
    await (await this.deps.db()).delete('libAlbums', id);
    this.albums.delete(id);
    if (a.hasCover) await this.deleteAlbumCoverFiles(id);
  }

  async createAlbum(raw: CreateAlbumBody): Promise<AlbumDto> {
    const r = createAlbumBodySchema.safeParse(raw);
    if (!r.success) throw invalid(String(r.error.issues[0]?.path[0] ?? '_'), r.error.issues[0]!.message);
    await this.ready();
    const artist = r.data.artist ?? ALBUM_DEFAULT_ARTIST;
    const key = albumRecordKey(r.data.title, artist);
    if ([...this.albums.values()].some((a) => a.key === key)) throw conflict();
    const id = await this.findOrCreateAlbum(r.data.title, artist, 'manual');
    if (r.data.year != null) await this.putAlbum({ ...this.album(id), year: r.data.year });
    return this.getAlbum(id);
  }

  async updateAlbum(id: string, raw: UpdateAlbumBody): Promise<AlbumDto> {
    const r = updateAlbumBodySchema.safeParse(raw);
    if (!r.success) throw invalid(String(r.error.issues[0]?.path[0] ?? '_'), r.error.issues[0]!.message);
    await this.ready();
    const a = this.album(id);
    const title = r.data.title ?? a.title;
    const artist = r.data.artist ?? a.artist;
    const key = albumRecordKey(title, artist);
    if ([...this.albums.values()].some((o) => o.key === key && o.id !== id)) throw conflict();
    const year = r.data.year === undefined ? a.year : r.data.year;
    await this.putAlbum({ ...a, title, artist, year, key, updatedAt: this.now() });
    for (const t of this.albumTracks(id)) if (t.album !== title) await this.putTrack({ ...t, album: title });
    this.changed();
    return this.getAlbum(id);
  }

  /** Elimina l'album e la sua copertina; i brani restano in libreria, senza album. */
  async deleteAlbum(id: string): Promise<void> {
    await this.ready();
    const a = this.album(id);
    for (const t of this.albumTracks(id))
      await this.putTrack({ ...t, albumId: null, albumPosition: null, album: null });
    await (await this.deps.db()).delete('libAlbums', id);
    this.albums.delete(id);
    if (a.hasCover) await this.deleteAlbumCoverFiles(id);
    this.changed();
  }

  async addAlbumTracks(id: string, trackIds: string[], toIndex?: number): Promise<AlbumDto> {
    await this.ready();
    this.album(id);
    const unique = [...new Set(trackIds)];
    for (const trackId of unique) if (!this.tracks.has(trackId)) throw notFound('Brano');
    for (const [i, trackId] of unique.entries()) {
      await this.setTrackAlbum(trackId, id);
      if (toIndex !== undefined) await this.moveAlbumTrack(id, trackId, toIndex + i);
    }
    this.changed();
    return this.getAlbum(id);
  }

  /** Toglie il brano dall'album; null se l'album (automatico) è sparito perché vuoto. */
  async removeAlbumTrack(id: string, trackId: string): Promise<AlbumDto | null> {
    await this.ready();
    this.album(id);
    if (this.tracks.get(trackId)?.albumId !== id) throw notFound('Brano');
    await this.setTrackAlbum(trackId, null);
    this.changed();
    return this.albums.has(id) ? this.getAlbum(id) : null;
  }

  async moveAlbumTrack(id: string, trackId: string, toIndex: number): Promise<AlbumDto> {
    await this.ready();
    const a = this.album(id);
    let items = this.albumTracks(id);
    const moving = items.find((t) => t.id === trackId);
    if (!moving) throw notFound('Brano');
    const others = () => items.filter((t) => t.id !== trackId);
    const target = Math.min(toIndex, others().length);
    let [prev, next] = [others()[target - 1], others()[target]];
    const pos = (t: LocalTrackRecord | undefined) => t?.albumPosition ?? 0;
    if (prev && next && pos(next) - pos(prev) < MIN_POSITION_GAP) {
      for (const [i, t] of items.entries()) await this.putTrack({ ...t, albumPosition: i + 1 });
      items = this.albumTracks(id);
      [prev, next] = [others()[target - 1], others()[target]];
    }
    const position =
      prev && next ? (pos(prev) + pos(next)) / 2 : prev ? pos(prev) + 1 : next ? pos(next) - 1 : 1;
    await this.putTrack({ ...this.tracks.get(trackId)!, albumPosition: position });
    await this.putAlbum({ ...a, updatedAt: this.now() });
    return this.getAlbum(id);
  }

  /** Imposta la copertina assegnata da un'immagine (ritaglio quadrato, 512 e 128, colore dominante). */
  async setAlbumCover(id: string, image: Blob): Promise<AlbumDto> {
    await this.ready();
    const a = this.album(id);
    if (!(ALBUM_COVER_TYPES as readonly string[]).includes(image.type))
      throw new ApiError(
        400,
        ErrorCode.InvalidImage,
        'Formato non supportato: scegli un’immagine JPEG, PNG o WebP',
      );
    if (image.size > ALBUM_COVER_MAX_BYTES)
      throw new ApiError(400, ErrorCode.InvalidImage, 'L’immagine è troppo grande (massimo 10 MB)');
    let cover: Awaited<ReturnType<CoverProcessor>>;
    try {
      // La copertina deve essere un'immagine leggibile: niente segnaposto al posto di un file rovinato.
      if (typeof createImageBitmap === 'function') (await createImageBitmap(image)).close();
      cover = await (this.deps.processCover ?? defaultProcessCover)(image);
    } catch {
      throw new ApiError(400, ErrorCode.InvalidImage, 'Il file scelto non è un’immagine valida');
    }
    const version = a.coverVersion + 1;
    await this.deleteAlbumCoverFiles(id);
    const covers = await this.caches.open(DEVICE_COVER_CACHE);
    for (const [size, blob] of [
      [512, cover.large],
      [128, cover.thumb],
    ] as const)
      await covers.put(
        absolute(localAlbumCoverUrl(id, size, version)),
        new Response(blob, {
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(blob.size) },
        }),
      );
    await this.putAlbum({
      ...a,
      hasCover: true,
      coverColor: cover.dominantColor,
      coverVersion: version,
      lookupStatus: 'done',
      updatedAt: this.now(),
    });
    this.changed();
    return this.getAlbum(id);
  }

  async removeAlbumCover(id: string): Promise<AlbumDto> {
    await this.ready();
    const a = this.album(id);
    if (a.hasCover) {
      await this.putAlbum({
        ...a,
        hasCover: false,
        coverColor: null,
        coverVersion: a.coverVersion + 1,
        updatedAt: this.now(),
      });
      await this.deleteAlbumCoverFiles(id);
      this.changed();
    }
    return this.getAlbum(id);
  }

  /** Copertina assegnata dell'album, per il backup. */
  async albumCoverBlob(id: string): Promise<Blob | null> {
    const a = this.albums.get(id);
    if (!a?.hasCover) return null;
    const res = await (await this.caches.open(DEVICE_COVER_CACHE)).match(
      absolute(localAlbumCoverUrl(id, 512, a.coverVersion)),
    );
    return res ? res.blob() : null;
  }

  private async deleteAlbumCoverFiles(id: string): Promise<void> {
    const covers = await this.caches.open(DEVICE_COVER_CACHE);
    for (const req of await covers.keys())
      if (new URL(req.url).pathname === `/local/album-cover/${encodeURIComponent(id)}`)
        await covers.delete(req);
  }

  /** Campi di un album ripristinato da un backup. */
  async restoreAlbumFields(
    id: string,
    f: { year: number | null; createdAt: number; lookupDone: boolean },
  ): Promise<void> {
    const a = this.album(id);
    await this.putAlbum({
      ...a,
      year: f.year,
      createdAt: f.createdAt,
      lookupStatus: f.lookupDone ? 'done' : a.lookupStatus,
    });
  }

  /** Album da cercare online, dal più recente. */
  nextPendingLookup(exclude: string[]): LocalAlbumRecord | undefined {
    return [...this.albums.values()]
      .filter((a) => a.lookupStatus === 'pending' && !a.hasCover && !exclude.includes(a.id))
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
  }

  async markLookupDone(id: string): Promise<void> {
    const a = this.albums.get(id);
    if (a) await this.putAlbum({ ...a, lookupStatus: 'done' });
  }

  // ---------- generi ----------

  /** Generi in uso in libreria (grafia canonica). */
  private genreNames(): string[] {
    const out = new Map<string, string>();
    for (const t of this.tracks.values())
      for (const g of t.genres ?? []) if (!out.has(genreKey(g))) out.set(genreKey(g), g);
    return [...out.values()];
  }

  async setTrackGenres(trackId: string, genres: string[]): Promise<TrackDto> {
    const r = trackGenresBodySchema.safeParse({ genres });
    if (!r.success) throw invalid('genres', r.error.issues[0]!.message);
    await this.ready();
    const t = this.tracks.get(trackId);
    if (!t) throw notFound('Brano');
    const others = this.genreNamesExcept(trackId);
    await this.putTrack({ ...t, genres: normalizeGenres(r.data.genres, others) });
    this.changed();
    return this.toDto(this.tracks.get(trackId)!);
  }

  private genreNamesExcept(trackId: string): string[] {
    const out = new Map<string, string>();
    for (const t of this.tracks.values())
      if (t.id !== trackId)
        for (const g of t.genres ?? []) if (!out.has(genreKey(g))) out.set(genreKey(g), g);
    return [...out.values()];
  }

  /** Aggiunge o toglie generi a tutti i brani dell'album. */
  async updateAlbumGenres(id: string, add: string[] = [], remove: string[] = []): Promise<AlbumDto> {
    const r = albumGenresBodySchema.safeParse({ add, remove });
    if (!r.success) throw invalid('genres', r.error.issues[0]!.message);
    await this.ready();
    this.album(id);
    const removeKeys = new Set((r.data.remove ?? []).map(genreKey));
    for (const t of this.albumTracks(id)) {
      const kept = (t.genres ?? []).filter((g) => !removeKeys.has(genreKey(g)));
      await this.putTrack({
        ...t,
        genres: normalizeGenres([...kept, ...(r.data.add ?? [])], this.genreNames()),
      });
    }
    this.changed();
    return this.getAlbum(id);
  }

  async listGenres(): Promise<GenreDto[]> {
    await this.ready();
    const counts = new Map<string, GenreDto>();
    for (const t of this.tracks.values())
      for (const g of t.genres ?? []) {
        const c = counts.get(genreKey(g)) ?? { name: g, trackCount: 0 };
        c.trackCount++;
        counts.set(genreKey(g), c);
      }
    const collator = new Intl.Collator('it', { sensitivity: 'base' });
    return [...counts.values()].sort((a, b) => collator.compare(a.name, b.name));
  }

  async getGenre(name: string): Promise<GenreDetailDto> {
    await this.ready();
    const key = genreKey(name);
    const has = (t: LocalTrackRecord) => (t.genres ?? []).some((g) => genreKey(g) === key);
    const tracks = [...this.tracks.values()].filter(has);
    if (tracks.length === 0) throw notFound('Genere');
    const canonical = tracks[0]!.genres!.find((g) => genreKey(g) === key)!;
    const collator = new Intl.Collator('it', { sensitivity: 'base' });
    tracks.sort(
      (a, b) =>
        collator.compare(a.artist, b.artist) ||
        collator.compare(a.album ?? '', b.album ?? '') ||
        (a.albumPosition ?? 0) - (b.albumPosition ?? 0) ||
        collator.compare(a.title, b.title),
    );
    const albums = [...this.albums.values()]
      .filter((a) => {
        const ts = this.albumTracks(a.id);
        return ts.length > 0 && ts.every(has);
      })
      .sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title))
      .map((a) => this.albumSummary(a));
    return { name: canonical, trackCount: tracks.length, tracks: tracks.map((t) => this.toDto(t)), albums };
  }

  // ---------- backup ----------

  /** Tutti i dati per l'esportazione (snapshot coerente). */
  async snapshot() {
    await this.ready();
    const db = await this.deps.db();
    return {
      albums: [...this.albums.values()],
      tracks: [...this.tracks.values()],
      favorites: await db.getAll('libFavorites'),
      playlists: await db.getAll('libPlaylists'),
      items: await db.getAll('libPlaylistItems'),
      plays: await db.getAll('libPlays'),
    };
  }

  /** Inserimento diretto usato dall'importazione di un backup. */
  async importRecords(r: {
    albums?: LocalAlbumRecord[];
    tracks?: LocalTrackRecord[];
    favorites?: { trackId: string; createdAt: number }[];
    playlists?: LocalPlaylistRecord[];
    items?: LocalPlaylistItemRecord[];
    plays?: PlayEvent[];
  }): Promise<void> {
    const db = await this.deps.db();
    for (const a of r.albums ?? []) await this.putAlbum(a);
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
