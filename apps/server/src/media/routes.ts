import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { notFound, parseOrThrow } from '../http-errors.js';
import { coverRelPath } from './paths.js';

/** Audio e copertine sono immutabili per id: cache lunga, ma solo sul client (mai su proxy/CDN). */
export const MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable';

const idParams = z.object({ id: z.string().min(1).max(64) });
const coverQuery = z.object({ size: z.enum(['512', '128']).default('512') });

export function registerMediaRoutes(app: FastifyInstance, sqlite: Database.Database, mediaDir: string): void {
  const paths = sqlite.prepare('SELECT audio_path, cover_path FROM tracks WHERE id = ?');
  const lookup = (id: string) => {
    const row = paths.get(id) as { audio_path: string; cover_path: string } | undefined;
    if (!row) throw notFound('Brano non trovato');
    return row;
  };

  // Range a byte singolo (206), 416 oltre la fine, 200 senza Range, ETag/Last-Modified.
  app.get('/api/tracks/:id/audio', async (req, reply) => {
    currentUser(req);
    const row = lookup(parseOrThrow(idParams, req.params).id);
    reply.header('Cache-Control', MEDIA_CACHE_CONTROL);
    return reply.sendFile(row.audio_path, mediaDir, { cacheControl: false, acceptRanges: true });
  });

  app.get('/api/tracks/:id/cover', async (req, reply) => {
    currentUser(req);
    const row = lookup(parseOrThrow(idParams, req.params).id);
    const size = Number(parseOrThrow(coverQuery, req.query).size) as 512 | 128;
    reply.header('Cache-Control', MEDIA_CACHE_CONTROL);
    return reply.sendFile(coverRelPath(row.cover_path, size), mediaDir, { cacheControl: false });
  });
}
