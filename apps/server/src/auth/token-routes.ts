import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../http-errors.js';
import { currentUser } from './plugin.js';
import type { AccessTokenService } from './tokens.js';

export const tokenNameSchema = z
  .string({ required_error: 'Il nome è obbligatorio' })
  .trim()
  .min(1, 'Il nome non può essere vuoto')
  .max(60, 'Il nome può avere al massimo 60 caratteri');

const idParams = z.object({ id: z.string().min(1).max(64) });

/**
 * Gestione dei token di accesso personali. Solo con la sessione via cookie: un
 * token non può creare né revocare altri token (le rotte non sono del ponte).
 */
export function registerTokenRoutes(app: FastifyInstance, tokens: AccessTokenService): void {
  app.get('/api/me/tokens', async (req) => ({ items: tokens.list(currentUser(req).id) }));

  app.post('/api/me/tokens', async (req, reply) => {
    const { name } = parseOrThrow(z.object({ name: tokenNameSchema }), req.body);
    const { token, record } = tokens.create(currentUser(req).id, name);
    reply.status(201);
    return { token, ...record };
  });

  app.delete('/api/me/tokens/:id', async (req, reply) => {
    tokens.revoke(parseOrThrow(idParams, req.params).id, currentUser(req).id);
    return reply.status(204).send();
  });
}
