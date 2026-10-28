import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { ErrorCode } from '@spookyfy/shared';
import type { FastifyInstance } from 'fastify';
import { errorBody } from './http-errors.js';

const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js']);

/**
 * Serve il build della PWA dalla stessa origine dell'API, con fallback SPA:
 * ogni rotta non `/api` che non corrisponde a un file restituisce `index.html`.
 */
export async function registerWeb(app: FastifyInstance, webDistDir: string): Promise<void> {
  const hasDist = fs.existsSync(path.join(webDistDir, 'index.html'));
  if (hasDist) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      index: 'index.html',
      // reply.sendFile è già decorato dall'istanza per MEDIA_DIR (vedi app.ts).
      decorateReply: false,
      cacheControl: false,
      setHeaders(res, filePath) {
        const base = path.basename(filePath);
        if (NO_CACHE_FILES.has(base)) res.setHeader('Cache-Control', 'no-cache');
        else if (filePath.includes(`${path.sep}assets${path.sep}`))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    });
  } else {
    app.log.warn({ webDistDir }, 'build della PWA non trovato: verrà servita solo l’API');
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.url;
    if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
      return reply.status(404).send(errorBody(ErrorCode.NotFound, 'Endpoint non trovato'));
    }
    if (hasDist && (request.method === 'GET' || request.method === 'HEAD')) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html', webDistDir, { cacheControl: false });
    }
    return reply.status(404).send(errorBody(ErrorCode.NotFound, 'Risorsa non trovata'));
  });
}
