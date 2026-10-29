import fs from 'node:fs/promises';
import {
  type ListTracksQuery,
  type Page,
  type TrackDto,
  type UpdateTrackBody,
  trackAudioUrl,
  trackCoverUrl,
} from '@spookyfy/shared';
import { ErrorCode } from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import { HttpError, notFound } from '../http-errors.js';
import { COVER_SIZES, absMediaPath, coverRelPath } from '../media/paths.js';
import { updateTextTags } from '../media/tags.js';

export interface TrackRow {
  id: string;
  source_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  trim_start_ms: number | null;
  trim_end_ms: number | null;
  size_bytes: number;
  dominant_color: string;
  audio_path: string;
  cover_path: string;
  added_at: number;
  is_favorite: number;
  play_count: number;
  last_played_at: number | null;
}

/** Colonne del brano più i dati personali dell'utente `@userId`. */
export const TRACK_SELECT = `
  t.id, t.source_id, t.title, t.artist, t.album, t.duration_ms, t.trim_start_ms, t.trim_end_ms,
  t.size_bytes, t.dominant_color,
  t.audio_path, t.cover_path, t.added_at,
  EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = @userId AND f.track_id = t.id) AS is_favorite,
  (SELECT count(*) FROM plays p WHERE p.user_id = @userId AND p.track_id = t.id) AS play_count,
  (SELECT max(p.played_at) FROM plays p WHERE p.user_id = @userId AND p.track_id = t.id) AS last_played_at`;

export function toTrackDto(r: TrackRow): TrackDto {
  return {
    id: r.id,
    sourceId: r.source_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationMs: r.duration_ms,
    ...(r.trim_start_ms ? { trimStartMs: r.trim_start_ms } : {}),
    ...(r.trim_end_ms ? { trimEndMs: r.trim_end_ms } : {}),
    sizeBytes: r.size_bytes,
    dominantColor: r.dominant_color,
    addedAt: r.added_at,
    audioUrl: trackAudioUrl(r.id),
    coverUrl: trackCoverUrl(r.id, 512),
    coverThumbUrl: trackCoverUrl(r.id, 128),
    isFavorite: r.is_favorite === 1,
    playCount: r.play_count,
    lastPlayedAt: r.last_played_at,
  };
}

const SORTS = {
  added: { column: 't.added_at', dir: 'DESC', key: (r: TrackRow) => r.added_at },
  title: { column: 't.title COLLATE NOCASE', dir: 'ASC', key: (r: TrackRow) => r.title },
  artist: { column: 't.artist COLLATE NOCASE', dir: 'ASC', key: (r: TrackRow) => r.artist },
} as const;

type Cursor = { v: string | number; id: string } | { o: number };

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof c === 'object' && c && (('o' in c && Number.isInteger(c.o)) || ('id' in c && 'v' in c)))
      return c;
  } catch {}
  throw new HttpError(400, ErrorCode.ValidationFailed, 'Cursore non valido', {
    cursor: ['Cursore non valido'],
  });
}

/** Query FTS5: ogni parola diventa un prefisso, tutte devono comparire. */
export function ftsQuery(q: string): string | undefined {
  const tokens = q.normalize('NFKC').match(/[\p{L}\p{N}]+/gu);
  if (!tokens?.length) return undefined;
  return tokens
    .slice(0, 16)
    .map((t) => `"${t.replaceAll('"', '""')}"*`)
    .join(' ');
}

export interface TrackFiles {
  audio: string;
  covers: string[];
}

export class TrackService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly mediaDir: string,
  ) {}

  getRow(userId: string, id: string): TrackRow | undefined {
    return this.sqlite.prepare(`SELECT ${TRACK_SELECT} FROM tracks t WHERE t.id = @id`).get({ userId, id }) as
      | TrackRow
      | undefined;
  }

  get(userId: string, id: string): TrackDto {
    const row = this.getRow(userId, id);
    if (!row) throw notFound('Brano non trovato');
    return toTrackDto(row);
  }

  exists(id: string): boolean {
    return this.sqlite.prepare('SELECT 1 FROM tracks WHERE id = ?').get(id) !== undefined;
  }

  bySourceId(userId: string, sourceId: string): TrackDto | undefined {
    const row = this.sqlite
      .prepare(`SELECT ${TRACK_SELECT} FROM tracks t WHERE t.source_id = @sourceId`)
      .get({ userId, sourceId }) as TrackRow | undefined;
    return row && toTrackDto(row);
  }

  /** Brani per id, nell'ordine richiesto (gli id inesistenti vengono saltati). */
  byIds(userId: string, ids: string[]): TrackDto[] {
    if (ids.length === 0) return [];
    const rows = this.sqlite
      .prepare(`SELECT ${TRACK_SELECT} FROM tracks t WHERE t.id IN (SELECT value FROM json_each(@ids))`)
      .all({ userId, ids: JSON.stringify(ids) }) as TrackRow[];
    const map = new Map(rows.map((r) => [r.id, toTrackDto(r)]));
    return ids.flatMap((id) => map.get(id) ?? []);
  }

  list(userId: string, query: ListTracksQuery): Page<TrackDto> {
    const cursor = decodeCursor(query.cursor);
    const limit = query.limit;

    if (query.q !== undefined && query.q !== '') {
      const match = ftsQuery(query.q);
      if (!match) return { items: [], nextCursor: null };
      const offset = cursor && 'o' in cursor ? cursor.o : 0;
      const rows = this.sqlite
        .prepare(
          `SELECT ${TRACK_SELECT} FROM tracks_fts
           JOIN tracks t ON t.id = tracks_fts.track_id
           WHERE tracks_fts MATCH @match
           ORDER BY bm25(tracks_fts, 0, 10.0, 5.0, 1.0), t.added_at DESC
           LIMIT @limit OFFSET @offset`,
        )
        .all({ userId, match, limit: limit + 1, offset }) as TrackRow[];
      const more = rows.length > limit;
      return {
        items: rows.slice(0, limit).map(toTrackDto),
        nextCursor: more ? encodeCursor({ o: offset + limit }) : null,
      };
    }

    const sort = SORTS[query.sort];
    const cmp = sort.dir === 'DESC' ? '<' : '>';
    const where =
      cursor && 'id' in cursor
        ? `WHERE (${sort.column} ${cmp} @v OR (${sort.column} = @v AND t.id ${cmp} @cid))`
        : '';
    const rows = this.sqlite
      .prepare(
        `SELECT ${TRACK_SELECT} FROM tracks t ${where}
         ORDER BY ${sort.column} ${sort.dir}, t.id ${sort.dir} LIMIT @limit`,
      )
      .all({
        userId,
        limit: limit + 1,
        ...(cursor && 'id' in cursor ? { v: cursor.v, cid: cursor.id } : {}),
      }) as TrackRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toTrackDto),
      nextCursor: more && last ? encodeCursor({ v: sort.key(last), id: last.id }) : null,
    };
  }

  /** Aggiorna i metadati nel catalogo e nei tag ID3 del file. */
  async update(userId: string, id: string, patch: UpdateTrackBody): Promise<TrackDto> {
    const row = this.getRow(userId, id);
    if (!row) throw notFound('Brano non trovato');
    const next = {
      title: patch.title ?? row.title,
      artist: patch.artist ?? row.artist,
      album: patch.album === undefined ? row.album : patch.album || null,
    };
    const file = absMediaPath(this.mediaDir, row.audio_path);
    await updateTextTags(file, next);
    // La riscrittura dei tag cambia la dimensione del file: il client la usa per verificare i download.
    const { size } = await fs.stat(file);
    this.sqlite
      .prepare(
        'UPDATE tracks SET title = @title, artist = @artist, album = @album, size_bytes = @size WHERE id = @id',
      )
      .run({ ...next, size, id });
    return this.get(userId, id);
  }

  /** Elimina il brano (preferiti e playlist seguono per cascata) e i suoi file. */
  async delete(id: string): Promise<void> {
    const row = this.sqlite.prepare('SELECT audio_path, cover_path FROM tracks WHERE id = ?').get(id) as
      | { audio_path: string; cover_path: string }
      | undefined;
    if (!row) throw notFound('Brano non trovato');
    this.sqlite.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    const files = [row.audio_path, ...COVER_SIZES.map((s) => coverRelPath(row.cover_path, s))];
    await Promise.all(files.map((f) => fs.rm(absMediaPath(this.mediaDir, f), { force: true })));
  }
}
