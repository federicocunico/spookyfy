import { ErrorCode, WS_PATH, ingestBodySchema, remoteSearchQuerySchema } from '@spookyfy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { HttpError, parseOrThrow } from '../http-errors.js';
import type { IngestEvents } from './events.js';
import type { IngestService } from './service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
const PING_INTERVAL_MS = 30_000;

export function registerIngestRoutes(
  app: FastifyInstance,
  ingest: IngestService,
  events: IngestEvents,
  publicOrigin: string,
): void {
  app.get('/api/search/remote', async (req) => ({
    items: await ingest.search(currentUser(req).id, parseOrThrow(remoteSearchQuerySchema, req.query).q),
  }));

  app.post('/api/ingest', async (req, reply) => {
    const { sourceId } = parseOrThrow(ingestBodySchema, req.body);
    const res = ingest.request(currentUser(req).id, sourceId);
    return reply.status(res.kind === 'job' ? 202 : 200).send(res);
  });

  app.get('/api/jobs', async (req) => {
    currentUser(req);
    return { items: ingest.list() };
  });

  app.post('/api/jobs/:id/retry', async (req, reply) => {
    currentUser(req);
    return reply.status(202).send(ingest.retry(parseOrThrow(idParams, req.params).id));
  });

  // Canale in tempo reale. La sessione è già verificata dall'hook globale prima
  // dell'upgrade; qui si controlla anche l'Origin (un GET non passa dal controllo CSRF).
  app.get(
    WS_PATH,
    {
      websocket: true,
      preValidation: async (req) => {
        if (req.headers.origin !== publicOrigin) {
          throw new HttpError(403, ErrorCode.ForbiddenOrigin, 'Origine della richiesta non consentita');
        }
      },
    },
    (socket) => {
      const unsubscribe = events.subscribe((event) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
      });
      // Tiene viva la connessione attraverso il tunnel (idle timeout di Cloudflare: 100 s).
      const ping = setInterval(() => socket.ping(), PING_INTERVAL_MS);
      socket.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      socket.on('message', () => {
        // Il canale è solo server → client: i messaggi in arrivo vengono ignorati.
      });
    },
  );
}
