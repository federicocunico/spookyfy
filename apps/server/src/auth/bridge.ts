import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Rotte utilizzabili dal ponte (app in modalità client su un'altra origine) con
 * un token di accesso personale: ricerca, importazione, job, lettura dei brani,
 * audio e copertine. Tutto il resto richiede la sessione via cookie.
 */
const BRIDGE_ROUTES: { method: 'GET' | 'POST'; path: RegExp }[] = [
  { method: 'GET', path: /^\/api\/search\/remote$/ },
  { method: 'POST', path: /^\/api\/ingest$/ },
  { method: 'GET', path: /^\/api\/jobs$/ },
  { method: 'POST', path: /^\/api\/jobs\/[^/]+\/retry$/ },
  { method: 'GET', path: /^\/api\/tracks\/[^/]+$/ },
  { method: 'GET', path: /^\/api\/tracks\/[^/]+\/audio$/ },
  { method: 'GET', path: /^\/api\/tracks\/[^/]+\/cover$/ },
];

const pathOf = (url: string) => url.split('?')[0] ?? url;

export function isBridgeRoute(method: string, url: string): boolean {
  const path = pathOf(url);
  // HEAD è generato da Fastify per ogni GET.
  const m = method === 'HEAD' ? 'GET' : method;
  return BRIDGE_ROUTES.some((r) => r.method === m && r.path.test(path));
}

/** La health check è pubblica e senza dati utente: l'app la usa per verificare il ponte. */
const CORS_PUBLIC_PATHS = [/^\/api\/health$/];

/** Una rotta del ponte per qualunque metodo (per le preflight CORS). */
function isBridgePath(url: string): boolean {
  const path = pathOf(url);
  return BRIDGE_ROUTES.some((r) => r.path.test(path)) || CORS_PUBLIC_PATHS.some((re) => re.test(path));
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const h = request.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m?.[1];
}

const PREFLIGHT_MAX_AGE = '600';

/**
 * CORS del ponte, solo sulle rotte del ponte e solo per le origini autorizzate,
 * senza credenziali (i cookie non vengono mai inviati cross-origin). Senza
 * origini configurate il ponte è disabilitato e non si concede nulla.
 */
export function registerBridgeCors(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (!origin || !isBridgePath(request.url)) return;
    const ok = allowed.has(origin);
    if (ok) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header(
        'Access-Control-Expose-Headers',
        'Content-Range, Content-Length, Accept-Ranges, Retry-After',
      );
    }
    if (request.method === 'OPTIONS') {
      if (ok) {
        reply.header('Access-Control-Allow-Methods', 'GET, POST');
        reply.header('Access-Control-Allow-Headers', 'Authorization, Range, Content-Type');
        reply.header('Access-Control-Max-Age', PREFLIGHT_MAX_AGE);
      }
      return reply.status(204).send();
    }
  });
}
