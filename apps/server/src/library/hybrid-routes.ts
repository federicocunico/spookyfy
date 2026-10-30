import { mediaRefSchema } from '@spookyfy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { parseOrThrow } from '../http-errors.js';
import type { HybridPlaylistService } from './hybrid.js';
const ids = z.object({ id: z.string().min(1).max(64), itemId: z.string().min(1).max(64).optional() });
const name = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export function registerHybridRoutes(app: FastifyInstance, s: HybridPlaylistService) {
  app.post('/api/hybrid-playlists/copy-spotify', async (req) => {
    const b = parseOrThrow(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          accountId: z.string().min(1).max(256),
          generation: z.number().int().nonnegative(),
          refs: z.array(mediaRefSchema).max(50000),
        })
        .strict(),
      req.body,
    );
    return s.copySpotify(currentUser(req).id, b.name, b.accountId, b.generation, b.refs);
  });
  app.patch('/api/hybrid-playlists/:id', async (req) =>
    s.rename(currentUser(req).id, parseOrThrow(ids, req.params).id, parseOrThrow(name, req.body).name),
  );
  app.get('/api/hybrid-playlists', async (req) => ({ items: s.list(currentUser(req).id) }));
  app.post('/api/hybrid-playlists', async (req) =>
    s.create(currentUser(req).id, parseOrThrow(name, req.body).name),
  );
  app.get('/api/hybrid-playlists/:id', async (req) =>
    s.get(currentUser(req).id, parseOrThrow(ids, req.params).id),
  );
  app.delete('/api/hybrid-playlists/:id', async (req, reply) => {
    s.delete(currentUser(req).id, parseOrThrow(ids, req.params).id);
    return reply.status(204).send();
  });
  app.post('/api/hybrid-playlists/copy/:id', async (req) =>
    s.copyLegacy(currentUser(req).id, parseOrThrow(ids, req.params).id),
  );
  app.post('/api/hybrid-playlists/:id/items', async (req) => {
    const body = parseOrThrow(
      z.object({ ref: mediaRefSchema, spotifyAccountId: z.string().min(1).max(256).optional() }).strict(),
      req.body,
    );
    return s.add(currentUser(req).id, parseOrThrow(ids, req.params).id, body.ref, body.spotifyAccountId);
  });
  app.delete('/api/hybrid-playlists/:id/items/:itemId', async (req) => {
    const p = parseOrThrow(ids, req.params);
    return s.remove(currentUser(req).id, p.id, p.itemId!);
  });
  app.post('/api/hybrid-playlists/:id/items/:itemId/move', async (req) => {
    const p = parseOrThrow(ids, req.params);
    return s.move(
      currentUser(req).id,
      p.id,
      p.itemId!,
      parseOrThrow(z.object({ toIndex: z.number().int().min(0) }).strict(), req.body).toIndex,
    );
  });
}
