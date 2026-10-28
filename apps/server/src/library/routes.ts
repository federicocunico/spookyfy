import {
  addPlaylistItemBodySchema,
  listTracksQuerySchema,
  movePlaylistItemBodySchema,
  playlistNameBodySchema,
  submitPlaysBodySchema,
  updateTrackBodySchema,
} from '@spookyfy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { parseOrThrow } from '../http-errors.js';
import type { FavoriteService, PlayService, PlaylistService } from './personal.js';
import type { TrackService } from './tracks.js';

export interface LibraryServices {
  tracks: TrackService;
  favorites: FavoriteService;
  playlists: PlaylistService;
  plays: PlayService;
}

const idParams = z.object({ id: z.string().min(1).max(64) });
const itemParams = idParams.extend({ itemId: z.string().min(1).max(64) });
const trackIdParams = z.object({ trackId: z.string().min(1).max(64) });
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export function registerLibraryRoutes(app: FastifyInstance, s: LibraryServices): void {
  // Catalogo condiviso
  app.get('/api/tracks', async (req) =>
    s.tracks.list(currentUser(req).id, parseOrThrow(listTracksQuerySchema, req.query)),
  );

  app.get('/api/tracks/:id', async (req) =>
    s.tracks.get(currentUser(req).id, parseOrThrow(idParams, req.params).id),
  );

  app.patch('/api/tracks/:id', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    return s.tracks.update(currentUser(req).id, id, parseOrThrow(updateTrackBodySchema, req.body));
  });

  app.delete('/api/tracks/:id', async (req, reply) => {
    currentUser(req);
    await s.tracks.delete(parseOrThrow(idParams, req.params).id);
    return reply.status(204).send();
  });

  // Preferiti
  app.get('/api/me/favorites', async (req) => ({ items: s.favorites.list(currentUser(req).id) }));

  app.put('/api/me/favorites/:trackId', async (req, reply) => {
    s.favorites.add(currentUser(req).id, parseOrThrow(trackIdParams, req.params).trackId);
    return reply.status(204).send();
  });

  app.delete('/api/me/favorites/:trackId', async (req, reply) => {
    s.favorites.remove(currentUser(req).id, parseOrThrow(trackIdParams, req.params).trackId);
    return reply.status(204).send();
  });

  // Ascolti
  app.post('/api/me/plays', async (req) =>
    s.plays.submit(currentUser(req).id, parseOrThrow(submitPlaysBodySchema, req.body).plays),
  );

  app.get('/api/me/recent-plays', async (req) => ({
    items: s.plays.recent(currentUser(req).id, parseOrThrow(limitQuery, req.query).limit),
  }));

  // Playlist
  app.get('/api/playlists', async (req) => ({ items: s.playlists.list(currentUser(req).id) }));

  app.post('/api/playlists', async (req, reply) => {
    const { name } = parseOrThrow(playlistNameBodySchema, req.body);
    reply.status(201);
    return s.playlists.create(currentUser(req).id, name);
  });

  app.get('/api/playlists/:id', async (req) =>
    s.playlists.get(currentUser(req).id, parseOrThrow(idParams, req.params).id),
  );

  app.patch('/api/playlists/:id', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    return s.playlists.rename(currentUser(req).id, id, parseOrThrow(playlistNameBodySchema, req.body).name);
  });

  app.delete('/api/playlists/:id', async (req, reply) => {
    s.playlists.delete(currentUser(req).id, parseOrThrow(idParams, req.params).id);
    return reply.status(204).send();
  });

  app.post('/api/playlists/:id/items', async (req, reply) => {
    const { id } = parseOrThrow(idParams, req.params);
    const { trackId } = parseOrThrow(addPlaylistItemBodySchema, req.body);
    reply.status(201);
    return s.playlists.addItem(currentUser(req).id, id, trackId);
  });

  app.delete('/api/playlists/:id/items/:itemId', async (req, reply) => {
    const { id, itemId } = parseOrThrow(itemParams, req.params);
    s.playlists.removeItem(currentUser(req).id, id, itemId);
    return reply.status(204).send();
  });

  app.post('/api/playlists/:id/items/:itemId/move', async (req) => {
    const { id, itemId } = parseOrThrow(itemParams, req.params);
    const { toIndex } = parseOrThrow(movePlaylistItemBodySchema, req.body);
    return s.playlists.moveItem(currentUser(req).id, id, itemId, toIndex);
  });
}
