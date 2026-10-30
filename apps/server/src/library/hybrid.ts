import {
  type HybridPlaylistDto,
  type HybridPlaylistItemDto,
  type MediaRef,
  mediaRefSchema,
} from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import { notFound } from '../http-errors.js';

export class HybridPlaylistService {
  copySpotify(owner: string, name: string, accountId: string, generation: number, refs: MediaRef[]) {
    return this.sqlite.transaction(() => {
      if (
        !this.sqlite
          .prepare(
            'SELECT 1 FROM spotify_links WHERE user_id=? AND account_id=? AND generation=? AND reauth=0',
          )
          .get(owner, accountId, generation)
      )
        throw notFound('Collegamento Spotify cambiato');
      const p = this.create(owner, name);
      const insert = this.sqlite.prepare('INSERT INTO hybrid_playlist_items VALUES (?,?,?,?,?,?,?,?)');
      for (const [position, ref] of refs.entries()) {
        const valid = mediaRefSchema.parse(ref);
        if (valid.provider !== 'spotify') throw new Error('Sorgente non valida');
        insert.run(ulid(), p.id, 'spotify', null, valid.uri, accountId, position, this.clock.now());
      }
      return this.get(owner, p.id);
    })();
  }
  rename(owner: string, id: string, name: string) {
    this.get(owner, id);
    if (!name.trim() || name.trim().length > 100) throw new Error('Nome non valido');
    this.sqlite
      .prepare('UPDATE hybrid_playlists SET name=?,updated_at=? WHERE id=?')
      .run(name.trim(), this.clock.now(), id);
    return this.get(owner, id);
  }
  constructor(
    private sqlite: Database.Database,
    private clock: Clock,
  ) {}
  get(ownerId: string, id: string): HybridPlaylistDto {
    const p = this.sqlite
      .prepare(
        'SELECT id, owner_id AS ownerId, name, created_at AS createdAt, updated_at AS updatedAt FROM hybrid_playlists WHERE owner_id=? AND id=?',
      )
      .get(ownerId, id) as Omit<HybridPlaylistDto, 'items'> | undefined;
    if (!p) throw notFound('Raccolta non trovata');
    const rows = this.sqlite
      .prepare(
        'SELECT id AS itemId,provider,track_id AS trackId,uri,spotify_account_id AS spotifyAccountId,added_at AS addedAt FROM hybrid_playlist_items WHERE playlist_id=? ORDER BY position,id',
      )
      .all(id) as {
      itemId: string;
      provider: string;
      trackId: string;
      uri: string;
      spotifyAccountId: string | null;
      addedAt: number;
    }[];
    return {
      ...p,
      items: rows.map((i) => ({
        itemId: i.itemId,
        addedAt: i.addedAt,
        ref:
          i.provider === 'local'
            ? { provider: 'local', trackId: i.trackId }
            : { provider: 'spotify', uri: i.uri },
        ...(i.spotifyAccountId ? { spotifyAccountId: i.spotifyAccountId } : {}),
      })),
    };
  }
  list(owner: string) {
    return (
      this.sqlite
        .prepare('SELECT id FROM hybrid_playlists WHERE owner_id=? ORDER BY updated_at DESC,id')
        .all(owner) as { id: string }[]
    ).map((p) => this.get(owner, p.id));
  }
  create(owner: string, name: string) {
    if (!name.trim() || name.trim().length > 100) throw new Error('Nome non valido');
    const id = ulid();
    const now = this.clock.now();
    this.sqlite
      .prepare('INSERT INTO hybrid_playlists VALUES (?,?,?,?,?)')
      .run(id, owner, name.trim(), now, now);
    return this.get(owner, id);
  }
  add(owner: string, id: string, ref: MediaRef, accountId?: string) {
    const valid = mediaRefSchema.parse(ref);
    return this.sqlite
      .transaction(() => {
        this.get(owner, id);
        if (
          valid.provider === 'local' &&
          !this.sqlite.prepare('SELECT 1 FROM tracks WHERE id=?').get(valid.trackId)
        )
          throw notFound('Brano non trovato');
        if (
          valid.provider === 'spotify' &&
          (!accountId ||
            !this.sqlite
              .prepare('SELECT 1 FROM spotify_links WHERE user_id=? AND account_id=? AND reauth=0')
              .get(owner, accountId))
        )
          throw notFound('Collegamento Spotify non trovato');
        const row = this.sqlite
          .prepare(
            'SELECT coalesce(max(position),0)+1 AS position FROM hybrid_playlist_items WHERE playlist_id=?',
          )
          .get(id) as { position: number };
        this.sqlite
          .prepare('INSERT INTO hybrid_playlist_items VALUES (?,?,?,?,?,?,?,?)')
          .run(
            ulid(),
            id,
            valid.provider,
            valid.provider === 'local' ? valid.trackId : null,
            valid.provider === 'spotify' ? valid.uri : null,
            valid.provider === 'spotify' ? accountId : null,
            row.position,
            this.clock.now(),
          );
        this.touch(id);
        return this.get(owner, id);
      })
      .immediate();
  }
  private touch(id: string) {
    this.sqlite.prepare('UPDATE hybrid_playlists SET updated_at=? WHERE id=?').run(this.clock.now(), id);
  }
  remove(owner: string, id: string, itemId: string) {
    this.get(owner, id);
    if (
      !this.sqlite.prepare('DELETE FROM hybrid_playlist_items WHERE playlist_id=? AND id=?').run(id, itemId)
        .changes
    )
      throw notFound();
    this.touch(id);
    return this.get(owner, id);
  }
  move(owner: string, id: string, itemId: string, toIndex: number) {
    const p = this.get(owner, id);
    const from = p.items.findIndex((i) => i.itemId === itemId);
    if (from < 0) throw notFound();
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= p.items.length)
      throw new Error('Posizione non valida');
    this.sqlite.transaction(() => {
      const rows = this.sqlite
        .prepare('SELECT id,position FROM hybrid_playlist_items WHERE playlist_id=? ORDER BY position,id')
        .all(id) as { id: string; position: number }[];
      const [item] = rows.splice(from, 1);
      if (!item) throw notFound();
      const left = rows[toIndex - 1]?.position ?? 0;
      const right = rows[toIndex]?.position ?? left + 2;
      let position = (left + right) / 2;
      if (right - left < 1e-9) {
        const update = this.sqlite.prepare('UPDATE hybrid_playlist_items SET position=? WHERE id=?');
        rows.forEach((r, i) => {
          r.position = i + 1;
          update.run(r.position, r.id);
        });
        position = ((rows[toIndex - 1]?.position ?? 0) + (rows[toIndex]?.position ?? rows.length + 1)) / 2;
      }
      this.sqlite.prepare('UPDATE hybrid_playlist_items SET position=? WHERE id=?').run(position, item.id);
      this.touch(id);
    })();
    return this.get(owner, id);
  }
  delete(owner: string, id: string) {
    this.get(owner, id);
    this.sqlite.prepare('DELETE FROM hybrid_playlists WHERE id=?').run(id);
  }
  copyLegacy(owner: string, id: string) {
    return this.sqlite.transaction(() => {
      const p = this.sqlite.prepare('SELECT name FROM playlists WHERE id=? AND owner_id=?').get(id, owner) as
        | { name: string }
        | undefined;
      if (!p) throw notFound();
      const copy = this.create(owner, p.name);
      for (const i of this.sqlite
        .prepare('SELECT track_id FROM playlist_items WHERE playlist_id=? ORDER BY position,id')
        .all(id) as { track_id: string }[])
        this.add(owner, copy.id, { provider: 'local', trackId: i.track_id });
      return this.get(owner, copy.id);
    })();
  }
  purgeSpotify(owner: string, accountId: string) {
    this.sqlite
      .prepare(
        "DELETE FROM hybrid_playlist_items WHERE provider='spotify' AND spotify_account_id=? AND playlist_id IN (SELECT id FROM hybrid_playlists WHERE owner_id=?)",
      )
      .run(accountId, owner);
  }
}
