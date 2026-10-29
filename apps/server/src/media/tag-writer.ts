import fs from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import NodeID3 from 'node-id3';
import { absMediaPath } from './paths.js';

/**
 * Riscrive in background album, artista dell'album, numero di traccia e generi nei tag
 * dei file: spostare un brano cambia il numero di traccia anche degli altri, quindi la
 * scrittura non avviene nella richiesta. Un errore resta nel log e non tocca il catalogo.
 */
export class TagWriter {
  private readonly pending = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly mediaDir: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  enqueue(trackIds: readonly string[]): void {
    for (const id of trackIds) this.pending.add(id);
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  /** Attende la fine delle scritture in coda (test e arresto). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const [id] = this.pending;
      if (id === undefined) return;
      this.pending.delete(id);
      try {
        await this.write(id);
      } catch (err) {
        this.log.warn({ err, trackId: id }, 'riscrittura dei tag non riuscita');
      }
    }
  }

  private async write(trackId: string): Promise<void> {
    const t = this.sqlite
      .prepare(
        `SELECT t.audio_path, t.album, t.album_id, a.artist AS album_artist,
           (SELECT count(*) FROM tracks o WHERE o.album_id = t.album_id
              AND (o.album_position < t.album_position OR (o.album_position = t.album_position AND o.id < t.id))) + 1 AS track_no,
           (SELECT count(*) FROM tracks o WHERE o.album_id = t.album_id) AS track_total,
           (SELECT group_concat(name, '; ') FROM (SELECT g.name FROM track_genres tg JOIN genres g ON g.id = tg.genre_id
              WHERE tg.track_id = t.id ORDER BY g.name COLLATE NOCASE)) AS genres
         FROM tracks t LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ?`,
      )
      .get(trackId) as
      | {
          audio_path: string;
          album: string | null;
          album_id: string | null;
          album_artist: string | null;
          track_no: number;
          track_total: number;
          genres: string | null;
        }
      | undefined;
    if (!t) return;
    const file = absMediaPath(this.mediaDir, t.audio_path);
    const inAlbum = t.album_id !== null;
    const result = await NodeID3.Promise.update(
      {
        album: t.album ?? '',
        performerInfo: inAlbum ? (t.album_artist ?? '') : '',
        trackNumber: inAlbum ? `${t.track_no}/${t.track_total}` : '',
        genre: t.genres ?? '',
      },
      file,
    );
    if (result !== true && result !== undefined) throw result;
    // La riscrittura cambia la dimensione del file: il client la usa per verificare i download.
    const { size } = await fs.stat(file);
    this.sqlite.prepare('UPDATE tracks SET size_bytes = ? WHERE id = ?').run(size, trackId);
  }
}
