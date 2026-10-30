/**
 * Server locale del gateway: esegue gli stessi handler delle funzioni Vercel
 * (firma Web Request → Response) e serve la PWA, con KV in memoria e YouTube
 * finto. Usato in sviluppo e nei test end-to-end della modalità client.
 *
 *   pnpm --filter @spookyfy/gateway dev            (YouTube finto)
 *   YOUTUBE=real pnpm --filter @spookyfy/gateway start:dev
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { handleAuth } from './lib/auth.js';
import { loadGatewayConfig } from './lib/config.js';
import {
  type GatewayDeps,
  handleAudio,
  handleCover,
  handleHealth,
  handleMeta,
  handleSearch,
} from './lib/handlers.js';
import { handle } from './lib/http.js';
import { type Clock, type Kv, MemoryKv, systemClock } from './lib/kv.js';
import { handleLookup } from './lib/lookup.js';
import { handleSpotify } from './lib/spotify.js';
import { FakeYoutube, fakeAudioOrigin } from './lib/youtube-fake.js';
import { InnertubeYoutube } from './lib/youtube-innertube.js';
import type { YoutubeClient } from './lib/youtube.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface DevServerOptions {
  port: number;
  webDist?: string;
  kv?: Kv;
  clock?: Clock;
  youtube?: YoutubeClient | 'fake' | 'real';
  env?: NodeJS.ProcessEnv;
}

function serveStatic(root: string, urlPath: string, res: http.ServerResponse): boolean {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.resolve(root, rel || 'index.html');
  if (!file.startsWith(path.resolve(root))) return false;
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
  if (!fs.existsSync(target)) return false;
  const base = path.basename(target);
  res.writeHead(200, {
    'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
    'cache-control': ['index.html', 'sw.js', 'manifest.webmanifest'].includes(base)
      ? 'no-cache'
      : 'public, max-age=3600',
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

function toRequest(req: http.IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v !== undefined) headers.set(k, v);
  }
  if (!headers.has('x-forwarded-for'))
    headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const ac = new AbortController();
  // IncomingMessage close also fires after a normally consumed POST body.
  // Only a premature request abort cancels the upstream operation.
  req.on('aborted', () => ac.abort());
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: 'half',
    signal: ac.signal,
  } as RequestInit);
}

async function writeResponse(r: Response, res: http.ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => {
    if (k !== 'set-cookie') headers[k] = v;
  });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(r.status, headers);
  if (!r.body) {
    res.end();
    return;
  }
  const reader = r.body.getReader();
  res.on('close', () => void reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) break;
    if (!res.write(value)) await new Promise((ok) => res.once('drain', ok));
  }
  res.end();
}

export async function startDevServer(
  o: DevServerOptions,
): Promise<{ url: string; close(): Promise<void>; deps: GatewayDeps }> {
  const origin = `http://localhost:${o.port}`;
  const env = {
    NODE_ENV: 'development',
    SESSION_SECRET: 'dev-secret-dev-secret-dev-secret-dev-secret',
    PUBLIC_ORIGIN: origin,
    COOKIE_SECURE: 'false',
    ...o.env,
  };
  const config = loadGatewayConfig(env);
  const clock = o.clock ?? systemClock;
  const youtube =
    o.youtube === 'real'
      ? new InnertubeYoutube()
      : o.youtube && o.youtube !== 'fake'
        ? o.youtube
        : new FakeYoutube(`${origin}/__fake-audio`);
  const deps: GatewayDeps = {
    config,
    kv: o.kv ?? new MemoryKv(clock),
    clock,
    youtube,
    fetch: globalThis.fetch.bind(globalThis),
  };
  const webDist = o.webDist ?? path.resolve(import.meta.dirname, '../web/dist');

  const routes: [RegExp, (req: Request, m: RegExpExecArray) => Promise<Response>][] = [
    [/^\/api\/health$/, async () => handleHealth(deps)],
    [/^\/api\/auth\/([^/]+)$/, (req, m) => handleAuth(req, m[1]!, deps)],
    [/^\/api\/search$/, (req) => handleSearch(req, deps)],
    [/^\/api\/meta\/([^/]+)$/, (req, m) => handleMeta(req, decodeURIComponent(m[1]!), deps)],
    [/^\/api\/audio\/([^/]+)$/, (req, m) => handleAudio(req, decodeURIComponent(m[1]!), deps)],
    [/^\/api\/cover\/([^/]+)$/, (req, m) => handleCover(req, decodeURIComponent(m[1]!), deps)],
    [/^\/api\/lookup\/([^/]+)$/, (req, m) => handleLookup(req, m[1]!, deps)],
    [/^\/api\/spotify\/([^/]+)$/, (req, m) => handleSpotify(req, m[1]!, deps)],
    [/^\/__fake-audio\/([^/]+)$/, async (req) => fakeAudioOrigin(req)],
  ];

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', origin).pathname;
    for (const [re, fn] of routes) {
      const m = re.exec(pathname);
      if (m) {
        void handle(() => fn(toRequest(req, origin), m)).then((r) => writeResponse(r, res));
        return;
      }
    }
    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Endpoint non trovato' } }));
      return;
    }
    if (!serveStatic(webDist, pathname, res)) {
      res.writeHead(404);
      res.end('Build della PWA non trovato: esegui pnpm --filter @spookyfy/web build');
    }
  });
  await new Promise<void>((ok) => server.listen(o.port, '127.0.0.1', ok));
  return {
    url: origin,
    deps,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const port = Number(process.env.PORT ?? 4174);
  const s = await startDevServer({
    port,
    youtube: process.env.YOUTUBE === 'real' ? 'real' : 'fake',
    env: process.env,
  });
  console.log(`Gateway di sviluppo (modalità client) su ${s.url}`);
}
