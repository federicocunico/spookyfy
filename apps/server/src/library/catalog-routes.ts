import {
  ALBUM_COVER_MAX_BYTES,
  ALBUM_COVER_TYPES,
  ErrorCode,
  addAlbumTracksBodySchema,
  albumGenresBodySchema,
  applyCandidateBodySchema,
  createAlbumBodySchema,
  listAlbumsQuerySchema,
  lookupQuerySchema,
  moveAlbumTrackBodySchema,
  trackGenresBodySchema,
  updateAlbumBodySchema,
  updateSettingsBodySchema,
} from '@spookyfy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { HttpError, parseOrThrow } from '../http-errors.js';
import type { CoverLookupService, SettingsService } from '../lookup/service.js';
import { MEDIA_CACHE_CONTROL } from '../media/routes.js';
import type { AlbumService } from './albums.js';
import type { GenreService } from './genres.js';
import type { TrackService } from './tracks.js';

export interface CatalogServices {
  albums: AlbumService;
  genres: GenreService;
  tracks: TrackService;
  settings: SettingsService;
  lookup: CoverLookupService;
}

const idParams = z.object({ id: z.string().min(1).max(64) });
const albumTrackParams = idParams.extend({ trackId: z.string().min(1).max(64) });
const genreParams = z.object({ name: z.string().min(1).max(100) });
const coverQuery = z.object({ size: z.enum(['512', '128']).default('512') });
const imageQuery = z.object({ url: z.string().url().max(2000) });

/** Album, generi, impostazioni del catalogo e ricerca online di copertine. */
export function registerCatalogRoutes(app: FastifyInstance, s: CatalogServices): void {
  // Album
  app.get('/api/albums', async (req) => {
    currentUser(req);
    const q = parseOrThrow(listAlbumsQuerySchema, req.query);
    return { items: s.albums.list(q.sort, q.q) };
  });

  app.post('/api/albums', async (req, reply) => {
    const album = s.albums.create(currentUser(req).id, parseOrThrow(createAlbumBodySchema, req.body));
    reply.status(201);
    return album;
  });

  app.get('/api/albums/:id', async (req) =>
    s.albums.get(currentUser(req).id, parseOrThrow(idParams, req.params).id),
  );

  app.patch('/api/albums/:id', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    return s.albums.update(currentUser(req).id, id, parseOrThrow(updateAlbumBodySchema, req.body));
  });

  app.delete('/api/albums/:id', async (req, reply) => {
    currentUser(req);
    await s.albums.delete(parseOrThrow(idParams, req.params).id);
    return reply.status(204).send();
  });

  app.post('/api/albums/:id/tracks', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    const body = parseOrThrow(addAlbumTracksBodySchema, req.body);
    return s.albums.addTracks(currentUser(req).id, id, body.trackIds, body.toIndex);
  });

  app.delete('/api/albums/:id/tracks/:trackId', async (req, reply) => {
    const { id, trackId } = parseOrThrow(albumTrackParams, req.params);
    const album = s.albums.removeTrack(currentUser(req).id, id, trackId);
    return album ?? reply.status(204).send();
  });

  app.post('/api/albums/:id/tracks/:trackId/move', async (req) => {
    const { id, trackId } = parseOrThrow(albumTrackParams, req.params);
    const { toIndex } = parseOrThrow(moveAlbumTrackBodySchema, req.body);
    return s.albums.moveTrack(currentUser(req).id, id, trackId, toIndex);
  });

  app.get('/api/albums/:id/cover', async (req, reply) => {
    currentUser(req);
    const { id } = parseOrThrow(idParams, req.params);
    const size = Number(parseOrThrow(coverQuery, req.query).size) as 512 | 128;
    const cover = await s.albums.coverFile(id, size);
    // L'URL cambia (parametro v) a ogni nuova copertina: la risposta è immutabile.
    reply.header('Cache-Control', MEDIA_CACHE_CONTROL);
    if ('bytes' in cover) return reply.type('image/jpeg').send(cover.bytes);
    return reply.sendFile(cover.file, { cacheControl: false });
  });

  // Copertina caricata come corpo binario (JPEG, PNG o WebP fino a 10 MB): niente multipart.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: ALBUM_COVER_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );
    scope.put('/api/albums/:id/cover', async (req) => {
      const { id } = parseOrThrow(idParams, req.params);
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!(ALBUM_COVER_TYPES as readonly string[]).includes(type) || !Buffer.isBuffer(req.body))
        throw new HttpError(
          400,
          ErrorCode.InvalidImage,
          'Formato non supportato: scegli un’immagine JPEG, PNG o WebP',
        );
      return s.albums.setCover(currentUser(req).id, id, req.body);
    });
  });

  app.delete('/api/albums/:id/cover', async (req) =>
    s.albums.removeCover(currentUser(req).id, parseOrThrow(idParams, req.params).id),
  );

  app.post('/api/albums/:id/genres', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    const body = parseOrThrow(albumGenresBodySchema, req.body);
    s.genres.updateAlbumGenres(id, body.add, body.remove);
    return s.albums.get(currentUser(req).id, id);
  });

  app.post('/api/albums/:id/apply-candidate', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    return s.lookup.apply(currentUser(req).id, id, parseOrThrow(applyCandidateBodySchema, req.body));
  });

  // Generi
  app.put('/api/tracks/:id/genres', async (req) => {
    const { id } = parseOrThrow(idParams, req.params);
    s.genres.setTrackGenres(id, parseOrThrow(trackGenresBodySchema, req.body).genres);
    return s.tracks.get(currentUser(req).id, id);
  });

  app.get('/api/genres', async (req) => {
    currentUser(req);
    return { items: s.genres.list() };
  });

  app.get('/api/genres/:name', async (req) =>
    s.genres.detail(currentUser(req).id, parseOrThrow(genreParams, req.params).name),
  );

  // Impostazioni del server
  app.get('/api/settings', async (req) => {
    currentUser(req);
    return s.settings.get();
  });

  app.patch('/api/settings', async (req) => {
    currentUser(req);
    const next = s.settings.set(parseOrThrow(updateSettingsBodySchema, req.body));
    if (next.coverLookup) s.lookup.kick();
    return next;
  });

  // Ricerca online
  app.get('/api/lookup/albums', async (req) => {
    currentUser(req);
    return { items: await s.lookup.search(parseOrThrow(lookupQuerySchema, req.query)) };
  });

  app.get('/api/lookup/image', async (req, reply) => {
    currentUser(req);
    const img = await s.lookup.image(parseOrThrow(imageQuery, req.query).url);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type(img.contentType).send(Buffer.from(img.bytes));
  });
}
