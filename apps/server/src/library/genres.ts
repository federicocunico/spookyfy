import {
  type AlbumSummaryDto,
  type GenreDetailDto,
  type GenreDto,
  genreKey,
  normalizeGenres,
} from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { notFound } from '../http-errors.js';
import type { AlbumService } from './albums.js';
import { TRACK_SELECT, type TrackRow, toTrackDto } from './tracks.js';

/**
 * Generi come tag dei brani (molti-a-molti). La grafia canonica è quella del primo
 * inserimento; un genere senza più brani viene eliminato.
 */
export class GenreService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly albums: AlbumService,
    private readonly onTracksChanged?: (trackIds: string[]) => void,
  ) {}

  private names(): string[] {
    return (this.sqlite.prepare('SELECT name FROM genres').all() as { name: string }[]).map((r) => r.name);
  }

  private genreId(name: string): string {
    const key = genreKey(name);
    const found = this.sqlite.prepare('SELECT id FROM genres WHERE key = ?').get(key) as
      | { id: string }
      | undefined;
    if (found) return found.id;
    const id = ulid();
    this.sqlite.prepare('INSERT INTO genres (id, name, key) VALUES (?, ?, ?)').run(id, name, key);
    return id;
  }

  private prune(): void {
    this.sqlite.prepare('DELETE FROM genres WHERE id NOT IN (SELECT genre_id FROM track_genres)').run();
  }

  trackGenres(trackId: string): string[] {
    return (
      this.sqlite
        .prepare(
          `SELECT g.name FROM track_genres tg JOIN genres g ON g.id = tg.genre_id
           WHERE tg.track_id = ? ORDER BY g.name COLLATE NOCASE`,
        )
        .all(trackId) as { name: string }[]
    ).map((r) => r.name);
  }

  /** Sostituisce i generi del brano. */
  setTrackGenres(trackId: string, names: readonly string[]): void {
    if (!this.sqlite.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId))
      throw notFound('Brano non trovato');
    const next = normalizeGenres(names, this.names());
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM track_genres WHERE track_id = ?').run(trackId);
      const insert = this.sqlite.prepare(
        'INSERT OR IGNORE INTO track_genres (track_id, genre_id) VALUES (?, ?)',
      );
      for (const name of next) insert.run(trackId, this.genreId(name));
      this.prune();
    })();
    this.onTracksChanged?.([trackId]);
  }

  /** Aggiunge o toglie generi a tutti i brani dell'album. */
  updateAlbumGenres(albumId: string, add: readonly string[] = [], remove: readonly string[] = []): void {
    if (!this.albums.exists(albumId)) throw notFound('Album non trovato');
    const trackIds = this.albums.trackIds(albumId);
    const removeKeys = new Set(remove.map(genreKey));
    this.sqlite.transaction(() => {
      for (const trackId of trackIds) {
        const current = this.trackGenres(trackId).filter((g) => !removeKeys.has(genreKey(g)));
        const next = normalizeGenres([...current, ...add], this.names());
        this.sqlite.prepare('DELETE FROM track_genres WHERE track_id = ?').run(trackId);
        const insert = this.sqlite.prepare(
          'INSERT OR IGNORE INTO track_genres (track_id, genre_id) VALUES (?, ?)',
        );
        for (const name of next) insert.run(trackId, this.genreId(name));
      }
      this.prune();
    })();
    this.onTracksChanged?.(trackIds);
  }

  /** Generi in uso con il numero di brani, in ordine alfabetico. */
  list(): GenreDto[] {
    return (
      this.sqlite
        .prepare(
          `SELECT g.name, count(*) AS trackCount FROM genres g JOIN track_genres tg ON tg.genre_id = g.id
           GROUP BY g.id ORDER BY g.name COLLATE NOCASE`,
        )
        .all() as GenreDto[]
    ).map((g) => ({ name: g.name, trackCount: Number(g.trackCount) }));
  }

  /** Brani con il genere e album che lo hanno su tutti i brani. */
  detail(userId: string, name: string): GenreDetailDto {
    const genre = this.sqlite.prepare('SELECT id, name FROM genres WHERE key = ?').get(genreKey(name)) as
      | { id: string; name: string }
      | undefined;
    if (!genre) throw notFound('Genere non trovato');
    const tracks = (
      this.sqlite
        .prepare(
          `SELECT ${TRACK_SELECT} FROM tracks t
           WHERE t.id IN (SELECT track_id FROM track_genres WHERE genre_id = @genreId)
           ORDER BY t.artist COLLATE NOCASE, t.album COLLATE NOCASE, t.album_position, t.title COLLATE NOCASE`,
        )
        .all({ userId, genreId: genre.id }) as TrackRow[]
    ).map(toTrackDto);
    const albumIds = (
      this.sqlite
        .prepare(
          `SELECT a.id FROM albums a WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id)
           AND NOT EXISTS (
             SELECT 1 FROM tracks t WHERE t.album_id = a.id
             AND NOT EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = t.id AND tg.genre_id = @genreId)
           ) ORDER BY a.artist COLLATE NOCASE, a.title COLLATE NOCASE`,
        )
        .all({ genreId: genre.id }) as { id: string }[]
    ).map((r) => r.id);
    const albums: AlbumSummaryDto[] = this.albums.summaries(albumIds);
    return { name: genre.name, trackCount: tracks.length, tracks, albums };
  }
}
