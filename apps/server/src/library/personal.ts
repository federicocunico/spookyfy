import type {
  FavoriteDto,
  PlayEvent,
  PlaylistDto,
  PlaylistItemDto,
  PlaylistSummaryDto,
  SubmitPlaysResult,
  TrackDto,
} from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import { notFound } from '../http-errors.js';
import { TRACK_SELECT, type TrackRow, toTrackDto } from './tracks.js';

const assertTrack = (sqlite: Database.Database, trackId: string) => {
  if (!sqlite.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId)) throw notFound('Brano non trovato');
};

export class FavoriteService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: Clock,
  ) {}

  list(userId: string): FavoriteDto[] {
    const rows = this.sqlite
      .prepare(
        `SELECT ${TRACK_SELECT}, fav.created_at AS favorited_at
         FROM favorites fav JOIN tracks t ON t.id = fav.track_id
         WHERE fav.user_id = @userId
         ORDER BY fav.created_at DESC, fav.rowid DESC`,
      )
      .all({ userId }) as (TrackRow & { favorited_at: number })[];
    return rows.map((r) => ({ track: toTrackDto(r), favoritedAt: r.favorited_at }));
  }

  add(userId: string, trackId: string): void {
    assertTrack(this.sqlite, trackId);
    this.sqlite
      .prepare('INSERT OR IGNORE INTO favorites (user_id, track_id, created_at) VALUES (?, ?, ?)')
      .run(userId, trackId, this.clock.now());
  }

  remove(userId: string, trackId: string): void {
    this.sqlite.prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?').run(userId, trackId);
  }
}

interface PlaylistRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  track_count: number;
  duration_ms: number;
}

/** Sotto questa distanza fra posizioni vicine si rinumera tutta la playlist. */
const MIN_POSITION_GAP = 1e-9;

export class PlaylistService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: Clock,
  ) {}

  private summarySql = `
    SELECT p.id, p.name, p.created_at, p.updated_at,
      (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count,
      (SELECT coalesce(sum(t.duration_ms), 0) FROM playlist_items i JOIN tracks t ON t.id = i.track_id
        WHERE i.playlist_id = p.id) AS duration_ms
    FROM playlists p`;

  private coverTrackIds(playlistId: string): string[] {
    const rows = this.sqlite
      .prepare(
        `SELECT track_id FROM playlist_items WHERE playlist_id = ?
         GROUP BY track_id ORDER BY min(position) LIMIT 4`,
      )
      .all(playlistId) as { track_id: string }[];
    return rows.map((r) => r.track_id);
  }

  private toSummary(r: PlaylistRow): PlaylistSummaryDto {
    return {
      id: r.id,
      name: r.name,
      trackCount: r.track_count,
      durationMs: r.duration_ms,
      coverTrackIds: this.coverTrackIds(r.id),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** Le playlist di altri utenti si comportano come inesistenti. */
  private owned(ownerId: string, id: string): PlaylistRow {
    const row = this.sqlite
      .prepare(`${this.summarySql} WHERE p.id = ? AND p.owner_id = ?`)
      .get(id, ownerId) as PlaylistRow | undefined;
    if (!row) throw notFound('Playlist non trovata');
    return row;
  }

  private touch(id: string): void {
    this.sqlite.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(this.clock.now(), id);
  }

  list(ownerId: string): PlaylistSummaryDto[] {
    const rows = this.sqlite
      .prepare(`${this.summarySql} WHERE p.owner_id = ? ORDER BY p.updated_at DESC, p.id DESC`)
      .all(ownerId) as PlaylistRow[];
    return rows.map((r) => this.toSummary(r));
  }

  get(ownerId: string, id: string): PlaylistDto {
    const summary = this.toSummary(this.owned(ownerId, id));
    const rows = this.sqlite
      .prepare(
        `SELECT ${TRACK_SELECT}, i.id AS item_id, i.added_at AS item_added_at
         FROM playlist_items i JOIN tracks t ON t.id = i.track_id
         WHERE i.playlist_id = @id ORDER BY i.position, i.id`,
      )
      .all({ userId: ownerId, id }) as (TrackRow & { item_id: string; item_added_at: number })[];
    const items: PlaylistItemDto[] = rows.map((r) => ({
      itemId: r.item_id,
      addedAt: r.item_added_at,
      track: toTrackDto(r),
    }));
    return { ...summary, items };
  }

  create(ownerId: string, name: string): PlaylistDto {
    const id = ulid();
    const now = this.clock.now();
    this.sqlite
      .prepare('INSERT INTO playlists (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, ownerId, name, now, now);
    return this.get(ownerId, id);
  }

  rename(ownerId: string, id: string, name: string): PlaylistSummaryDto {
    this.owned(ownerId, id);
    this.sqlite
      .prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, this.clock.now(), id);
    return this.toSummary(this.owned(ownerId, id));
  }

  delete(ownerId: string, id: string): void {
    this.owned(ownerId, id);
    this.sqlite.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  }

  /** Aggiunge in coda; lo stesso brano può comparire più volte. */
  addItem(ownerId: string, id: string, trackId: string): PlaylistItemDto {
    this.owned(ownerId, id);
    assertTrack(this.sqlite, trackId);
    const { max } = this.sqlite
      .prepare('SELECT max(position) AS max FROM playlist_items WHERE playlist_id = ?')
      .get(id) as { max: number | null };
    const itemId = ulid();
    const now = this.clock.now();
    this.sqlite
      .prepare(
        'INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(itemId, id, trackId, (max ?? 0) + 1, now);
    this.touch(id);
    const row = this.sqlite.prepare(`SELECT ${TRACK_SELECT} FROM tracks t WHERE t.id = @trackId`).get({
      userId: ownerId,
      trackId,
    }) as TrackRow;
    return { itemId, addedAt: now, track: toTrackDto(row) };
  }

  removeItem(ownerId: string, id: string, itemId: string): void {
    this.owned(ownerId, id);
    const r = this.sqlite
      .prepare('DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?')
      .run(itemId, id);
    if (r.changes === 0) throw notFound('Elemento non trovato');
    this.touch(id);
  }

  /** Sposta un elemento all'indice indicato (0 = primo), con un solo UPDATE nella maggior parte dei casi. */
  moveItem(ownerId: string, id: string, itemId: string, toIndex: number): PlaylistDto {
    this.owned(ownerId, id);
    this.sqlite.transaction(() => {
      const load = () =>
        this.sqlite
          .prepare('SELECT id, position FROM playlist_items WHERE playlist_id = ? ORDER BY position, id')
          .all(id) as { id: string; position: number }[];
      let items = load();
      if (!items.some((i) => i.id === itemId)) throw notFound('Elemento non trovato');
      const others = () => items.filter((i) => i.id !== itemId);
      const target = Math.min(toIndex, others().length);
      const neighbours = () => [others()[target - 1], others()[target]] as const;

      let [prev, next] = neighbours();
      if (prev && next && next.position - prev.position < MIN_POSITION_GAP) {
        const renumber = this.sqlite.prepare('UPDATE playlist_items SET position = ? WHERE id = ?');
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
      this.sqlite.prepare('UPDATE playlist_items SET position = ? WHERE id = ?').run(position, itemId);
      this.touch(id);
    })();
    return this.get(ownerId, id);
  }
}

/** Tolleranza sugli orologi dei client per gli ascolti "nel futuro". */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export class PlayService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: Clock,
  ) {}

  /** Idempotente: lo stesso id inviato più volte viene contato una volta. */
  submit(userId: string, plays: PlayEvent[]): SubmitPlaysResult {
    const insert = this.sqlite.prepare(
      `INSERT OR IGNORE INTO plays (id, user_id, track_id, played_at)
       SELECT @id, @userId, @trackId, @playedAt WHERE EXISTS (SELECT 1 FROM tracks WHERE id = @trackId)`,
    );
    const limit = this.clock.now() + FUTURE_TOLERANCE_MS;
    let recorded = 0;
    this.sqlite.transaction(() => {
      for (const p of plays) {
        if (p.playedAt > limit) continue;
        recorded += insert.run({ ...p, userId }).changes;
      }
    })();
    return { recorded, ignored: plays.length - recorded };
  }

  /** Brani ascoltati di recente, senza duplicati, dal più recente. */
  recent(userId: string, limit: number): TrackDto[] {
    const rows = this.sqlite
      .prepare(
        `SELECT ${TRACK_SELECT} FROM (
           SELECT track_id, max(played_at) AS last FROM plays WHERE user_id = @userId
           GROUP BY track_id ORDER BY last DESC LIMIT @limit
         ) r JOIN tracks t ON t.id = r.track_id ORDER BY r.last DESC`,
      )
      .all({ userId, limit }) as TrackRow[];
    return rows.map(toTrackDto);
  }
}
