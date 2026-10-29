import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { UserService } from '../src/auth/users.js';
import type { Clock } from '../src/clock.js';
import { type Config, loadConfig } from '../src/config.js';
import { type DatabaseHandle, openDatabase } from '../src/db/client.js';
import type { HardwareProfile } from '../src/hardware.js';
import { fakeYtDlp } from './fixtures/fake-ytdlp.js';

export const TEST_ORIGIN = 'https://spookyfy.test';

/** fetch che fallisce sempre, come senza connessione. */
export const offlineFetch = (async () => {
  throw new TypeError('fetch failed');
}) as unknown as typeof fetch;

export class FakeClock implements Clock {
  constructor(public t = Date.UTC(2026, 0, 1)) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface TestContext {
  app: FastifyInstance;
  config: Config;
  database: DatabaseHandle;
  clock: FakeClock;
  dir: string;
  cleanup(): Promise<void>;
}

export interface TestContextOptions {
  env?: Record<string, string>;
  /** Crea un finto build della PWA con index.html. */
  withWebDist?: boolean;
  hardware?: Partial<HardwareProfile>;
  buildOptions?: Record<string, unknown>;
  /** Permette di aggiungere rotte di prova prima di `ready()`. */
  beforeReady?: (app: FastifyInstance) => void;
}

export const STRONG_PASSWORD = 'Notte#2026';

/** Crea un account direttamente nel DB (senza passare dall'API). */
export async function createUser(ctx: TestContext, username: string, password = STRONG_PASSWORD) {
  return new UserService(ctx.database.db, ctx.clock).create(username, password);
}

/** Estrae il valore del cookie di sessione da una risposta. */
export function sessionCookieFrom(res: { cookies: { name: string; value: string }[] }): string | undefined {
  const c = res.cookies.find((c) => c.name === 'spk_session');
  return c ? `spk_session=${c.value}` : undefined;
}

export async function login(ctx: TestContext, username: string, password = STRONG_PASSWORD): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { username, password },
  });
  const cookie = sessionCookieFrom(res);
  if (res.statusCode !== 200 || !cookie) throw new Error(`login fallito: ${res.statusCode} ${res.body}`);
  return cookie;
}

/** Crea l'utente ed effettua il login; restituisce l'header Cookie. */
export async function userSession(ctx: TestContext, username = 'fede'): Promise<string> {
  await createUser(ctx, username);
  return login(ctx, username);
}

type InjectOpts = { url: string; payload?: unknown; headers?: Record<string, string> };

/** Client per le rotte autenticate: aggiunge cookie e Origin dell'app. */
export function apiClient(ctx: TestContext, cookie: string) {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', o: InjectOpts) =>
    ctx.app.inject({
      method,
      url: o.url,
      payload: o.payload as never,
      headers: { cookie, origin: TEST_ORIGIN, ...o.headers },
    });
  return {
    cookie,
    get: (url: string, headers?: Record<string, string>) => call('GET', { url, headers }),
    post: (url: string, payload?: unknown) => call('POST', { url, payload }),
    put: (url: string, payload?: unknown) => call('PUT', { url, payload }),
    patch: (url: string, payload?: unknown) => call('PATCH', { url, payload }),
    delete: (url: string) => call('DELETE', { url }),
  };
}

export function makeTempDir(prefix = 'spk-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Avvia l'app su un database e cartelle temporanee, isolati per ogni test. */
export async function createTestContext(opts: TestContextOptions = {}): Promise<TestContext> {
  const dir = makeTempDir();
  const webDist = path.join(dir, 'web');
  if (opts.withWebDist) {
    fs.mkdirSync(path.join(webDist, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(webDist, 'index.html'),
      '<!doctype html><title>Spookyfy</title><div id="app"></div>',
    );
    fs.writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
  }
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATA_DIR: path.join(dir, 'data'),
      MEDIA_DIR: path.join(dir, 'media'),
      WEB_DIST_DIR: webDist,
      PUBLIC_ORIGIN: TEST_ORIGIN,
      ...opts.env,
    },
    dir,
  );
  fs.mkdirSync(config.mediaDir, { recursive: true });
  const database = openDatabase(path.join(config.dataDir, 'test.db'));
  const clock = new FakeClock();
  const app = await buildApp({
    config,
    database,
    clock,
    logger: false,
    ytdlp: fakeYtDlp(),
    // Auto-trim spento: senza, con ffmpeg installato ogni test lo eseguirebbe in background.
    analyzeSilence: null,
    // Nessuna rete nei test: la ricerca automatica di copertine fallisce e si sospende.
    lookupFetch: offlineFetch,
    hardware: { cores: 4, totalMemBytes: 4 * 1024 ** 3, arch: 'arm64', platform: 'linux', ...opts.hardware },
    ...opts.buildOptions,
  });
  opts.beforeReady?.(app);
  await app.ready();
  return {
    app,
    config,
    database,
    clock,
    dir,
    async cleanup() {
      await app.close();
      database.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}
