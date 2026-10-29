import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ALBUM_DEFAULT_ARTIST,
  type AlbumDto,
  type AlbumOrigin,
  type AlbumSort,
  type AlbumSummaryDto,
  type CreateAlbumBody,
  ErrorCode,
  type UpdateAlbumBody,
  albumCoverUrl,
  albumKey,
  commonGenres,
  trackCoverUrl,
} from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import { HttpError, notFound } from '../http-errors.js';
import { processCover } from '../ingest/covers.js';
import { COVER_SIZES, type CoverSize, absMediaPath, coverRelPath } from '../media/paths.js';
import { TRACK_SELECT, type TrackRow, toTrackDto } from './tracks.js';

/** Copertine assegnate agli album: `covers/albums/<id>-512.jpg` e `-128.jpg`. */
export const albumCoverPrefix = (albumId: string) => `covers/albums/${albumId}`;

const MIN_POSITION_GAP = 1e-9;
const GROUPED_MARKER = 'albums_grouped';

interface AlbumRow {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  origin: AlbumOrigin;
  cover_path: string | null;
  cover_color: string | null;
  cover_version: number;
  lookup_status: 'pending' | 'done';
  created_at: number;
  updated_at: number;
  track_count: number;
  duration_ms: number;
  first_track_id: string | null;
  first_color: string | null;
}

const ALBUM_SELECT = `
  a.id, a.title, a.artist, a.year, a.origin, a.cover_path, a.cover_color, a.cover_version, a.lookup_status,
  a.created_at, a.updated_at,
  (SELECT count(*) FROM tracks t WHERE t.album_id = a.id) AS track_count,
  (SELECT coalesce(sum(t.duration_ms), 0) FROM tracks t WHERE t.album_id = a.id) AS duration_ms,
  (SELECT t.id FROM tracks t WHERE t.album_id = a.id ORDER BY t.album_position, t.id LIMIT 1) AS first_track_id,
  (SELECT t.dominant_color FROM tracks t WHERE t.album_id = a.id ORDER BY t.album_position, t.id LIMIT 1) AS first_color`;

const ALBUM_SORTS: Record<AlbumSort, string> = {
  added: 'a.created_at DESC, a.id DESC',
  title: 'a.title COLLATE NOCASE, a.artist COLLATE NOCASE, a.id',
  artist: 'a.artist COLLATE NOCASE, a.title COLLATE NOCASE, a.id',
};

/** Colore della copertina segnaposto (come quella dei brani senza miniatura). */
const PLACEHOLDER_COLOR = '#b69cff';

function toSummary(r: AlbumRow): AlbumSummaryDto {
  const cover = (size: CoverSize) =>
    r.cover_path
      ? albumCoverUrl(r.id, size, r.cover_version)
      : r.first_track_id
        ? trackCoverUrl(r.first_track_id, size)
        : albumCoverUrl(r.id, size, 0);
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    year: r.year,
    origin: r.origin,
    trackCount: r.track_count,
    durationMs: r.duration_ms,
    coverUrl: cover(512),
    coverThumbUrl: cover(128),
    dominantColor: (r.cover_path && r.cover_color) || r.first_color || PLACEHOLDER_COLOR,
    hasCustomCover: r.cover_path !== null,
    addedAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Parole (normalizzate) del testo, per la ricerca per prefisso. */
const words = (s: string) => albumKey(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Tutte le parole della ricerca sono prefisso di una parola del testo. */
export function matchesPrefix(text: string, q: string): boolean {
  const have = words(text);
  const want = words(q);
  return want.length > 0 && want.every((w) => have.some((h) => h.startsWith(w)));
}

export interface AlbumServiceOptions {
  sqlite: Database.Database;
  mediaDir: string;
  clock: Clock;
  /** Riscrittura dei tag dei brani toccati (album, artista dell'album, numero di traccia, generi). */
  onTracksChanged?: (trackIds: string[]) => void;
  /** Un album nuovo senza copertina: da cercare online. */
  onAlbumCreated?: (albumId: string) => void;
}

export class AlbumService {
  private placeholder: Promise<{ large: Buffer; thumb: Buffer }> | null = null;

  constructor(private readonly o: AlbumServiceOptions) {}

  private get sqlite() {
    return this.o.sqlite;
  }

  private row(id: string): AlbumRow | undefined {
    return this.sqlite.prepare(`SELECT ${ALBUM_SELECT} FROM albums a WHERE a.id = ?`).get(id) as
      | AlbumRow
      | undefined;
  }

  private mustRow(id: string): AlbumRow {
    const r = this.row(id);
    if (!r) throw notFound('Album non trovato');
    return r;
  }

  exists(id: string): boolean {
    return this.sqlite.prepare('SELECT 1 FROM albums WHERE id = ?').get(id) !== undefined;
  }

  // ---------- lettura ----------

  list(sort: AlbumSort = 'added', q?: string): AlbumSummaryDto[] {
    const rows = this.sqlite
      .prepare(`SELECT ${ALBUM_SELECT} FROM albums a ORDER BY ${ALBUM_SORTS[sort]}`)
      .all() as AlbumRow[];
    const filtered = q ? rows.filter((r) => matchesPrefix(`${r.title} ${r.artist}`, q)) : rows;
    return filtered.map(toSummary);
  }

  summaries(ids: string[]): AlbumSummaryDto[] {
    return ids.flatMap((id) => {
      const r = this.row(id);
      return r ? [toSummary(r)] : [];
    });
  }

  get(userId: string, id: string): AlbumDto {
    const r = this.mustRow(id);
    const tracks = (
      this.sqlite
        .prepare(
          `SELECT ${TRACK_SELECT} FROM tracks t WHERE t.album_id = @id ORDER BY t.album_position, t.id`,
        )
        .all({ userId, id }) as TrackRow[]
    ).map(toTrackDto);
    return { ...toSummary(r), genres: commonGenres(tracks.map((t) => t.genres)), tracks };
  }

  /** Id dei brani dell'album, nell'ordine dell'album. */
  trackIds(id: string): string[] {
    return (
      this.sqlite.prepare('SELECT id FROM tracks WHERE album_id = ? ORDER BY album_position, id').all(id) as {
        id: string;
      }[]
    ).map((r) => r.id);
  }

  // ---------- creazione e modifica ----------

  /** Album con lo stesso titolo e artista (normalizzati), creato se manca. */
  findOrCreate(title: string, artist: string, origin: AlbumOrigin): string {
    const keys = { titleKey: albumKey(title), artistKey: albumKey(artist) };
    const find = () =>
      this.sqlite
        .prepare('SELECT id FROM albums WHERE title_key = @titleKey AND artist_key = @artistKey')
        .get(keys) as { id: string } | undefined;
    const existing = find();
    if (existing) return existing.id;
    const id = ulid();
    const now = this.o.clock.now();
    const r = this.sqlite
      .prepare(
        `INSERT INTO albums (id, title, artist, title_key, artist_key, origin, created_at, updated_at)
         VALUES (@id, @title, @artist, @titleKey, @artistKey, @origin, @now, @now)
         ON CONFLICT (title_key, artist_key) DO NOTHING`,
      )
      .run({ id, title: title.trim(), artist: artist.trim(), ...keys, origin, now });
    if (r.changes === 0) return find()!.id;
    this.o.onAlbumCreated?.(id);
    return id;
  }

  create(userId: string, body: CreateAlbumBody): AlbumDto {
    const artist = body.artist ?? ALBUM_DEFAULT_ARTIST;
    const taken = this.sqlite
      .prepare('SELECT 1 FROM albums WHERE title_key = ? AND artist_key = ?')
      .get(albumKey(body.title), albumKey(artist));
    if (taken)
      throw new HttpError(409, ErrorCode.Conflict, 'Esiste già un album con questo titolo e artista');
    const id = this.findOrCreate(body.title, artist, 'manual');
    if (body.year != null) this.sqlite.prepare('UPDATE albums SET year = ? WHERE id = ?').run(body.year, id);
    return this.get(userId, id);
  }

  update(userId: string, id: string, patch: UpdateAlbumBody): AlbumDto {
    const r = this.mustRow(id);
    const title = patch.title ?? r.title;
    const artist = patch.artist ?? r.artist;
    const year = patch.year === undefined ? r.year : patch.year;
    const keys = { titleKey: albumKey(title), artistKey: albumKey(artist) };
    const clash = this.sqlite
      .prepare('SELECT 1 FROM albums WHERE title_key = @titleKey AND artist_key = @artistKey AND id != @id')
      .get({ ...keys, id });
    if (clash)
      throw new HttpError(409, ErrorCode.Conflict, 'Esiste già un album con questo titolo e artista');
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `UPDATE albums SET title = @title, artist = @artist, year = @year, title_key = @titleKey,
             artist_key = @artistKey, updated_at = @now WHERE id = @id`,
        )
        .run({ id, title, artist, year, ...keys, now: this.o.clock.now() });
      // Il campo album dei brani riporta il titolo del loro album.
      this.sqlite.prepare('UPDATE tracks SET album = ? WHERE album_id = ?').run(title, id);
    })();
    if (title !== r.title || artist !== r.artist) this.o.onTracksChanged?.(this.trackIds(id));
    return this.get(userId, id);
  }

  /** Elimina l'album e la sua copertina; i brani restano in libreria, senza album. */
  async delete(id: string): Promise<void> {
    const r = this.mustRow(id);
    const ids = this.trackIds(id);
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare('UPDATE tracks SET album_id = NULL, album_position = NULL, album = NULL WHERE album_id = ?')
        .run(id);
      this.sqlite.prepare('DELETE FROM albums WHERE id = ?').run(id);
    })();
    if (r.cover_path) await this.removeCoverFiles(r.cover_path);
    this.o.onTracksChanged?.(ids);
  }

  // ---------- brani dell'album ----------

  /**
   * Unico punto in cui un brano entra o esce da un album: allinea il campo `album`,
   * elimina gli album automatici rimasti vuoti e segnala i brani da ritaggare.
   * `position` assoluta (es. numero di traccia); assente = in coda.
   */
  setTrackAlbum(trackId: string, albumId: string | null, position?: number): void {
    const prev = this.sqlite.prepare('SELECT album_id FROM tracks WHERE id = ?').get(trackId) as
      | { album_id: string | null }
      | undefined;
    if (!prev) throw notFound('Brano non trovato');
    const touched = new Set<string>([trackId]);
    this.sqlite.transaction(() => {
      if (albumId === null) {
        this.sqlite
          .prepare('UPDATE tracks SET album_id = NULL, album_position = NULL, album = NULL WHERE id = ?')
          .run(trackId);
      } else {
        const album = this.sqlite.prepare('SELECT title FROM albums WHERE id = ?').get(albumId) as
          | { title: string }
          | undefined;
        if (!album) throw notFound('Album non trovato');
        const pos =
          prev.album_id === albumId && position === undefined
            ? undefined
            : (position ??
              ((
                this.sqlite
                  .prepare('SELECT max(album_position) AS max FROM tracks WHERE album_id = ? AND id != ?')
                  .get(albumId, trackId) as { max: number | null }
              ).max ?? 0) + 1);
        this.sqlite
          .prepare(
            'UPDATE tracks SET album_id = @albumId, album = @title, album_position = coalesce(@pos, album_position) WHERE id = @trackId',
          )
          .run({ albumId, title: album.title, pos: pos ?? null, trackId });
        this.touch(albumId);
        for (const id of this.trackIds(albumId)) touched.add(id);
      }
      if (prev.album_id && prev.album_id !== albumId) {
        for (const id of this.trackIds(prev.album_id)) touched.add(id);
        this.dropIfEmptyAuto(prev.album_id);
      }
    })();
    this.o.onTracksChanged?.([...touched]);
  }

  /** Inserisce il brano nell'album indicato dai metadati (titolo e artista dell'album). */
  assignByMetadata(
    trackId: string,
    album: string | null,
    albumArtist: string,
    trackNo?: number | null,
  ): void {
    const title = album?.trim();
    if (!title) {
      this.setTrackAlbum(trackId, null);
      return;
    }
    const albumId = this.findOrCreate(title, albumArtist.trim() || ALBUM_DEFAULT_ARTIST, 'auto');
    this.setTrackAlbum(trackId, albumId, trackNo && trackNo > 0 ? trackNo : undefined);
  }

  /** Cambio del campo "album" di un brano: lo sposta nell'album con quel titolo e lo stesso artista. */
  moveByTitle(trackId: string, album: string | null): void {
    const t = this.sqlite
      .prepare(
        `SELECT t.artist, t.album_id, a.title_key, a.artist AS album_artist FROM tracks t
         LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ?`,
      )
      .get(trackId) as
      | { artist: string; album_id: string | null; title_key: string | null; album_artist: string | null }
      | undefined;
    if (!t) throw notFound('Brano non trovato');
    if (album && t.title_key === albumKey(album)) {
      this.sqlite
        .prepare('UPDATE tracks SET album = (SELECT title FROM albums WHERE id = ?) WHERE id = ?')
        .run(t.album_id, trackId);
      return;
    }
    this.assignByMetadata(trackId, album, t.album_artist ?? t.artist);
  }

  addTracks(userId: string, id: string, trackIds: string[], toIndex?: number): AlbumDto {
    this.mustRow(id);
    const unique = [...new Set(trackIds)];
    for (const trackId of unique) {
      if (!this.sqlite.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId))
        throw notFound('Brano non trovato');
    }
    unique.forEach((trackId, i) => {
      this.setTrackAlbum(trackId, id);
      if (toIndex !== undefined) this.moveTrack(userId, id, trackId, toIndex + i);
    });
    return this.get(userId, id);
  }

  removeTrack(userId: string, id: string, trackId: string): AlbumDto | null {
    this.mustRow(id);
    const t = this.sqlite.prepare('SELECT album_id FROM tracks WHERE id = ?').get(trackId) as
      | { album_id: string | null }
      | undefined;
    if (!t || t.album_id !== id) throw notFound('Il brano non fa parte di questo album');
    this.setTrackAlbum(trackId, null);
    return this.exists(id) ? this.get(userId, id) : null;
  }

  /** Sposta un brano all'indice indicato (0 = primo), con un solo UPDATE nella maggior parte dei casi. */
  moveTrack(userId: string, id: string, trackId: string, toIndex: number): AlbumDto {
    this.mustRow(id);
    this.sqlite.transaction(() => {
      const load = () =>
        this.sqlite
          .prepare(
            'SELECT id, album_position AS position FROM tracks WHERE album_id = ? ORDER BY album_position, id',
          )
          .all(id) as { id: string; position: number }[];
      let items = load();
      if (!items.some((i) => i.id === trackId)) throw notFound('Il brano non fa parte di questo album');
      const others = () => items.filter((i) => i.id !== trackId);
      const target = Math.min(toIndex, others().length);
      const neighbours = () => [others()[target - 1], others()[target]] as const;
      let [prev, next] = neighbours();
      if (prev && next && next.position - prev.position < MIN_POSITION_GAP) {
        const renumber = this.sqlite.prepare('UPDATE tracks SET album_position = ? WHERE id = ?');
        items.forEach((item, i) => renumber.run(i + 1, item.id));
        items = load();
        [prev, next] = neighbours();
      }
      const position =
        prev && next
          ? (prev.position + next.position) / 2
          : prev
            ? prev.position + 1
            : next
              ? next.position - 1
              : 1;
      this.sqlite.prepare('UPDATE tracks SET album_position = ? WHERE id = ?').run(position, trackId);
      this.touch(id);
    })();
    this.o.onTracksChanged?.(this.trackIds(id));
    return this.get(userId, id);
  }

  private touch(id: string): void {
    this.sqlite.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(this.o.clock.now(), id);
  }

  private dropIfEmptyAuto(id: string): void {
    const r = this.sqlite
      .prepare(
        `SELECT cover_path FROM albums WHERE id = ? AND origin = 'auto'
         AND NOT EXISTS (SELECT 1 FROM tracks WHERE album_id = albums.id)`,
      )
      .get(id) as { cover_path: string | null } | undefined;
    if (!r) return;
    this.sqlite.prepare('DELETE FROM albums WHERE id = ?').run(id);
    if (r.cover_path) void this.removeCoverFiles(r.cover_path);
  }

  /** Dopo l'eliminazione di brani: toglie gli album automatici rimasti vuoti. */
  pruneEmptyAuto(): void {
    const ids = this.sqlite
      .prepare(
        `SELECT id FROM albums WHERE origin = 'auto' AND NOT EXISTS (SELECT 1 FROM tracks WHERE album_id = albums.id)`,
      )
      .all() as { id: string }[];
    for (const { id } of ids) this.dropIfEmptyAuto(id);
  }

  // ---------- copertina ----------

  /** Imposta la copertina assegnata da un'immagine (ritaglio quadrato, 512 e 128, colore dominante). */
  async setCover(userId: string, id: string, image: Buffer): Promise<AlbumDto> {
    const r = this.mustRow(id);
    let cover: Awaited<ReturnType<typeof processCover>>;
    try {
      cover = await processCover(image);
    } catch {
      throw new HttpError(400, ErrorCode.InvalidImage, 'Il file scelto non è un’immagine valida');
    }
    const prefix = albumCoverPrefix(id);
    await fs.mkdir(path.dirname(absMediaPath(this.o.mediaDir, prefix)), { recursive: true });
    for (const size of COVER_SIZES) {
      const file = absMediaPath(this.o.mediaDir, coverRelPath(prefix, size));
      await fs.writeFile(`${file}.tmp`, size === 512 ? cover.large : cover.thumb);
      await fs.rename(`${file}.tmp`, file);
    }
    this.sqlite
      .prepare(
        `UPDATE albums SET cover_path = @prefix, cover_color = @color, cover_version = @version,
           lookup_status = 'done', updated_at = @now WHERE id = @id`,
      )
      .run({ id, prefix, color: cover.dominantColor, version: r.cover_version + 1, now: this.o.clock.now() });
    return this.get(userId, id);
  }

  async removeCover(userId: string, id: string): Promise<AlbumDto> {
    const r = this.mustRow(id);
    if (r.cover_path) {
      this.sqlite
        .prepare(
          `UPDATE albums SET cover_path = NULL, cover_color = NULL, cover_version = cover_version + 1,
             updated_at = ? WHERE id = ?`,
        )
        .run(this.o.clock.now(), id);
      await this.removeCoverFiles(r.cover_path);
    }
    return this.get(userId, id);
  }

  /** File della copertina da servire: assegnata, del primo brano, o segnaposto. */
  async coverFile(id: string, size: CoverSize): Promise<{ file: string } | { bytes: Buffer }> {
    const r = this.mustRow(id);
    if (r.cover_path) return { file: coverRelPath(r.cover_path, size) };
    if (r.first_track_id) {
      const t = this.sqlite.prepare('SELECT cover_path FROM tracks WHERE id = ?').get(r.first_track_id) as {
        cover_path: string;
      };
      return { file: coverRelPath(t.cover_path, size) };
    }
    this.placeholder ??= processCover(undefined);
    const p = await this.placeholder;
    return { bytes: size === 512 ? p.large : p.thumb };
  }

  private async removeCoverFiles(prefix: string): Promise<void> {
    await Promise.all(
      COVER_SIZES.map((s) => fs.rm(absMediaPath(this.o.mediaDir, coverRelPath(prefix, s)), { force: true })),
    );
  }

  // ---------- ricerca automatica ----------

  /** Album da cercare online, dal più recente. */
  nextPendingLookup(exclude: string[]): { id: string; title: string; artist: string } | undefined {
    return this.sqlite
      .prepare(
        `SELECT id, title, artist FROM albums WHERE lookup_status = 'pending' AND cover_path IS NULL
         AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(JSON.stringify(exclude)) as { id: string; title: string; artist: string } | undefined;
  }

  markLookupDone(id: string): void {
    this.sqlite.prepare("UPDATE albums SET lookup_status = 'done' WHERE id = ?").run(id);
  }

  // ---------- migrazione ----------

  /**
   * Raggruppa una sola volta i brani già in libreria con un album nei metadati
   * (marcatore in app_settings). Restituisce il numero di brani raggruppati.
   */
  groupExistingTracks(): number {
    const done = this.sqlite.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(GROUPED_MARKER);
    if (done) return 0;
    const rows = this.sqlite
      .prepare(
        "SELECT id, album, artist FROM tracks WHERE album_id IS NULL AND trim(coalesce(album, '')) != '' ORDER BY added_at, id",
      )
      .all() as { id: string; album: string; artist: string }[];
    const notify = this.o.onTracksChanged;
    this.o.onTracksChanged = undefined;
    try {
      this.sqlite.transaction(() => {
        for (const r of rows) this.assignByMetadata(r.id, r.album, r.artist);
        this.sqlite.prepare("INSERT INTO app_settings (key, value) VALUES (?, '1')").run(GROUPED_MARKER);
      })();
    } finally {
      this.o.onTracksChanged = notify;
    }
    return rows.length;
  }
}
