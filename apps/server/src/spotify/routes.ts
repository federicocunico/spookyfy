import {
  SpotifyApi,
  type SpotifyConfig,
  SpotifyError,
  SpotifyService,
  spotifyConfig,
} from '@spookyfy/spotify';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, currentUser } from '../auth/plugin.js';
import { SqliteSpotifyStore } from './store.js';
export function registerSpotifyRoutes(
  app: FastifyInstance,
  options: { config?: SpotifyConfig; fetch?: typeof fetch } = {},
) {
  const service = new SpotifyService(
    options.config ?? app.ctx.config.spotify ?? spotifyConfig(),
    new SqliteSpotifyStore(app.ctx.database.sqlite),
    { now: () => app.ctx.clock.now(), fetch: options.fetch },
  );
  const api = new SpotifyApi(service);
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/api/spotify/:action',
    handler: async (req, reply) => {
      const id = currentUser(req).id;
      const abort = new AbortController();
      req.raw.once('aborted', () => abort.abort());
      reply.raw.once('close', () => {
        if (!reply.raw.writableEnded) abort.abort();
      });
      reply.header('cache-control', 'no-store').header('vary', 'Cookie');
      try {
        const result = await api.dispatch(
          id,
          req.cookies[SESSION_COOKIE] ?? '',
          (req.params as { action: string }).action,
          req.method,
          new URL(req.url, app.ctx.config.publicOrigin).searchParams,
          req.body,
          abort.signal,
        );
        if (result.redirect) return reply.code(303).header('location', result.redirect).send();
        return reply.code(result.status).send(result.body);
      } catch (e) {
        if (e instanceof SpotifyError) {
          if (e.retryAfter) reply.header('retry-after', String(e.retryAfter));
          return reply.code(e.status).send({ error: { code: e.code, message: e.code } });
        }
        throw e;
      }
    },
  });
  return service;
}
