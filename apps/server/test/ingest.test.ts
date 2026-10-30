import fs from 'node:fs';
import path from 'node:path';
import type { JobDto, TrackDto, WsServerEvent } from '@spookyfy/shared';
import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { absMediaPath, coverRelPath } from '../src/media/paths.js';
import { readTags } from '../src/media/tags.js';
import { fakeYtDlp } from './fixtures/fake-ytdlp.js';
import { insertTrack } from './fixtures/media.js';
import {
  HOUR,
  TEST_ORIGIN,
  type TestContext,
  type TestContextOptions,
  apiClient,
  createTestContext,
  createUser,
  login,
  userSession,
} from './helpers.js';

let ctx: TestContext;
let api: ReturnType<typeof apiClient>;
const extraCleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of extraCleanup.splice(0)) await fn();
  await ctx?.cleanup();
});

async function setup(opts?: TestContextOptions) {
  ctx = await createTestContext(opts);
  api = apiClient(ctx, await userSession(ctx));
}

function recordEvents(app = ctx.app) {
  const events: WsServerEvent[] = [];
  const unsubscribe = app.ingest.events.subscribe((e) => events.push(e));
  extraCleanup.push(async () => unsubscribe());
  return events;
}

const listMedia = (sub: string) => {
  const dir = path.join(ctx.config.mediaDir, sub);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

async function ingest(sourceId: string): Promise<JobDto> {
  const res = await api.post('/api/ingest', { sourceId });
  expect(res.statusCode).toBe(202);
  return res.json().job;
}

describe('ricerca remota', () => {
  test('10 risultati con flag "già in libreria"', async () => {
    await setup();
    const t = await insertTrack(ctx, { sourceId: 'srch0000001' });
    const res = await api.get('/api/search/remote?q=nirvana%20come%20as%20you%20are');
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({
      sourceId: 'srch0000000',
      artist: 'Canale 0',
      durationMs: 180000,
      trackId: null,
    });
    expect(items[1]).toMatchObject({ sourceId: 'srch0000001', trackId: t.id });
  });

  test('query non valida: 400 senza contattare la sorgente', async () => {
    await setup();
    const spy = vi.spyOn(ctx.app.ingest, 'search');
    expect((await api.get('/api/search/remote?q=')).statusCode).toBe(400);
    expect((await api.get('/api/search/remote?q=%20%20')).statusCode).toBe(400);
    expect((await api.get(`/api/search/remote?q=${'x'.repeat(201)}`)).statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  test('sorgente non disponibile: 503', async () => {
    await setup();
    const res = await api.get('/api/search/remote?q=fail');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('REMOTE_SEARCH_UNAVAILABLE');
  });

  test('timeout: 503', async () => {
    // In produzione il timeout è 15 s; qui è ridotto per non rallentare i test.
    await setup({ buildOptions: { ytdlp: fakeYtDlp({ searchTimeoutMs: 300 }) } });
    const res = await api.get('/api/search/remote?q=timeout');
    expect(res.statusCode).toBe(503);
  });

  test('risultati in cache per 10 minuti', async () => {
    const yt = fakeYtDlp();
    const spy = vi.spyOn(yt, 'search');
    await setup({ buildOptions: { ytdlp: yt } });
    await api.get('/api/search/remote?q=Abc');
    await api.get('/api/search/remote?q=abc');
    expect(spy).toHaveBeenCalledTimes(1);
    ctx.clock.advance(11 * 60_000);
    await api.get('/api/search/remote?q=abc');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('importazione', () => {
  test('nuova importazione completata con file, tag, copertine e colore', async () => {
    await setup();
    const events = recordEvents();
    const job = await ingest('abcdefghijk');
    expect(job.status).toBe('queued');
    await ctx.app.ingest.idle();
    // Album assignment queues a separate tag update; compare its final file and DB snapshot.
    await ctx.app.catalog.tagWriter.idle();

    const done = (await api.get('/api/jobs')).json().items.find((j: JobDto) => j.id === job.id);
    expect(done).toMatchObject({ status: 'completed', progress: 1, error: null });
    const track = (await api.get(`/api/tracks/${done.trackId}`)).json() as TrackDto;
    expect(track).toMatchObject({
      sourceId: 'abcdefghijk',
      title: 'Canzone abcdefghijk',
      artist: 'Band Finta',
      durationMs: 3000,
    });
    expect(track.dominantColor).toMatch(/^#[c-f][0-9a-f]/);

    const row = ctx.database.sqlite.prepare('SELECT * FROM tracks WHERE id = ?').get(track.id) as {
      audio_path: string;
      cover_path: string;
      size_bytes: number;
    };
    const audio = absMediaPath(ctx.config.mediaDir, row.audio_path);
    expect(fs.statSync(audio).size).toBe(row.size_bytes);
    const tags = await readTags(audio);
    expect(tags).toMatchObject({ title: 'Canzone abcdefghijk', artist: 'Band Finta' });
    expect((tags.image as { mime: string }).mime).toBe('image/jpeg');
    const big = await sharp(absMediaPath(ctx.config.mediaDir, coverRelPath(row.cover_path, 512))).metadata();
    expect(big.width).toBe(512);

    expect(events.map((e) => e.type)).toEqual(['job.queued', 'job.progress', 'job.completed']);
    const completed = events.at(-1) as Extract<WsServerEvent, { type: 'job.completed' }>;
    expect(completed.track.id).toBe(track.id);
    expect(listMedia('tmp')).toEqual([]);
  });

  test('brano già importato: restituito senza creare job', async () => {
    await setup();
    const t = await insertTrack(ctx, { sourceId: 'abcdefghijk' });
    const res = await api.post('/api/ingest', { sourceId: 'abcdefghijk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'track', track: { id: t.id } });
    expect((await api.get('/api/jobs')).json().items).toEqual([]);
  });

  test('richieste duplicate concorrenti: stesso job', async () => {
    await setup({ buildOptions: { startIngestWorker: false } });
    await createUser(ctx, 'anna');
    const anna = apiClient(ctx, await login(ctx, 'anna'));
    const [a, b] = await Promise.all([
      api.post('/api/ingest', { sourceId: 'abcdefghijk' }),
      anna.post('/api/ingest', { sourceId: 'abcdefghijk' }),
    ]);
    expect(a.json().job.id).toBe(b.json().job.id);
  });

  test('identificativo non valido: 400 e nessun job', async () => {
    await setup();
    for (const sourceId of ['corto', 'https://youtu.be/abcdefghijk', '--exec=rmrf', 'abcdefghij!']) {
      expect((await api.post('/api/ingest', { sourceId })).statusCode).toBe(400);
    }
    expect((await api.get('/api/jobs')).json().items).toEqual([]);
  });

  test('video non disponibile: fallito, nessun file sul disco', async () => {
    await setup();
    const job = await ingest('unavail0000');
    await ctx.app.ingest.idle();
    const failed = (await api.get('/api/jobs')).json().items[0];
    expect(failed).toMatchObject({
      id: job.id,
      status: 'failed',
      error: 'Il video non è disponibile',
      trackId: null,
    });
    expect(listMedia('audio')).toEqual([]);
    expect(listMedia('covers')).toEqual([]);
    expect(listMedia('tmp')).toEqual([]);
    expect((await api.get('/api/tracks')).json().items).toEqual([]);
  });

  test('video troppo lungo: fallito con messaggio sulla durata', async () => {
    await setup();
    await ingest('toolong0000');
    await ctx.app.ingest.idle();
    expect((await api.get('/api/jobs')).json().items[0].error).toContain('durata massima di 20 minuti');
  });

  test('nuovo tentativo dopo un errore temporaneo', async () => {
    await setup();
    const job = await ingest('flaky000000');
    await ctx.app.ingest.idle();
    expect((await api.get('/api/jobs')).json().items[0].status).toBe('failed');
    expect(listMedia('tmp').filter((f) => !f.startsWith('flaky-'))).toEqual([]);

    const retried = await api.post(`/api/jobs/${job.id}/retry`);
    expect(retried.statusCode).toBe(202);
    expect(retried.json().status).toBe('queued');
    await ctx.app.ingest.idle();
    expect((await api.get('/api/jobs')).json().items[0]).toMatchObject({ status: 'completed' });
    expect((await api.post(`/api/jobs/${job.id}/retry`)).statusCode).toBe(409);
    expect((await api.post('/api/jobs/nope/retry')).statusCode).toBe(404);
  });

  test('limite di 2 job contemporanei con 5 richieste', async () => {
    await setup({ env: { INGEST_CONCURRENCY: '2' } });
    const events = recordEvents();
    const running = new Set<string>();
    let maxRunning = 0;
    let sawThreeQueued = false;
    ctx.app.ingest.events.subscribe((e) => {
      if (e.type === 'job.progress') running.add(e.job.id);
      if (e.type === 'job.completed' || e.type === 'job.failed') running.delete(e.job.id);
      maxRunning = Math.max(maxRunning, running.size);
    });
    for (let i = 0; i < 5; i++) await ingest(`slow000000${i}`);
    const queued = ctx.database.sqlite
      .prepare("SELECT count(*) AS n FROM ingest_jobs WHERE status = 'queued'")
      .get() as {
      n: number;
    };
    sawThreeQueued = queued.n === 3;
    await ctx.app.ingest.idle();
    expect(sawThreeQueued).toBe(true);
    expect(maxRunning).toBe(2);
    expect(events.filter((e) => e.type === 'job.completed')).toHaveLength(5);
  });

  test('default di concorrenza dall’hardware', async () => {
    await setup({ hardware: { cores: 32 } });
    expect(ctx.app.ctx.ingestConcurrency).toBe(8);
    await ctx.cleanup();
    await setup({ hardware: { cores: 4 } });
    expect(ctx.app.ctx.ingestConcurrency).toBe(2);
  });

  test('eventi di avanzamento al massimo uno al secondo per job', async () => {
    await setup();
    const events = recordEvents();
    await ingest('slow0000000');
    await ctx.app.ingest.idle();
    // L'orologio dei test è fermo: dopo il primo evento gli altri vengono soppressi.
    expect(events.filter((e) => e.type === 'job.progress')).toHaveLength(1);
  });
});

describe('ripresa dopo il riavvio', () => {
  test('un job interrotto viene completato senza duplicare il brano', async () => {
    await setup();
    const events = recordEvents();
    const job = await ingest('slow0000000');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'job.progress')).toBe(true));
    await ctx.app.close(); // arresto: il job resta "running"
    const status = ctx.database.sqlite.prepare('SELECT status FROM ingest_jobs WHERE id = ?').get(job.id) as {
      status: string;
    };
    expect(status.status).toBe('running');
    fs.mkdirSync(path.join(ctx.config.mediaDir, 'tmp', 'avanzo'), { recursive: true });

    const app2 = await buildApp({
      config: ctx.config,
      database: ctx.database,
      clock: ctx.clock,
      logger: false,
      ytdlp: fakeYtDlp(),
    });
    await app2.ready();
    extraCleanup.push(() => app2.close());
    await app2.ingest.idle();
    const rows = ctx.database.sqlite.prepare('SELECT status, track_id FROM ingest_jobs').all() as {
      status: string;
      track_id: string;
    }[];
    expect(rows).toEqual([{ status: 'completed', track_id: expect.any(String) }]);
    expect(ctx.database.sqlite.prepare('SELECT count(*) AS n FROM tracks').get()).toEqual({ n: 1 });
    expect(listMedia('tmp')).toEqual([]);
    // Il cleanup del contesto chiude di nuovo la prima app: è innocuo.
  });
});

describe('consultazione dei job', () => {
  test('attivi e terminati nelle ultime 24 ore', async () => {
    await setup();
    await ingest('abcdefghijk');
    await ctx.app.ingest.idle();
    expect((await api.get('/api/jobs')).json().items).toHaveLength(1);
    ctx.clock.advance(25 * HOUR);
    expect((await api.get('/api/jobs')).json().items).toEqual([]);
  });
});

describe('canale in tempo reale', () => {
  async function listen() {
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = ctx.app.server.address() as { port: number };
    return `ws://127.0.0.1:${addr.port}/api/ws`;
  }

  const connect = (url: string, headers: Record<string, string>) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      ws.once('open', () => resolve(ws));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once('error', reject);
    });

  test('eventi queued → progress → completed', async () => {
    await setup();
    const url = await listen();
    const cookie = await login(ctx, 'fede');
    const ws = await connect(url, { cookie, origin: TEST_ORIGIN });
    const received: WsServerEvent[] = [];
    ws.on('message', (data) => received.push(JSON.parse(String(data))));
    await ingest('abcdefghijk');
    await vi.waitFor(() => expect(received.at(-1)?.type).toBe('job.completed'), { timeout: 10_000 });
    expect(received.map((e) => e.type)).toEqual(['job.queued', 'job.progress', 'job.completed']);
    ws.close();
  });

  test('senza sessione la connessione viene rifiutata', async () => {
    await setup();
    const url = await listen();
    await expect(connect(url, { origin: TEST_ORIGIN })).rejects.toThrow('HTTP 401');
  });

  test('origine estranea rifiutata', async () => {
    await setup();
    const url = await listen();
    const cookie = await login(ctx, 'fede');
    await expect(connect(url, { cookie, origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
  });
});

describe('auto-trim del silenzio', () => {
  const trimmed = { trimStartMs: 6750, trimEndMs: 2750 };

  test('i punti di trim calcolati all’importazione arrivano ai client', async () => {
    const analyze = vi.fn(async () => trimmed);
    await setup({ buildOptions: { analyzeSilence: analyze } });
    await ingest('abcdefghijk');
    await ctx.app.ingest.idle();
    expect(analyze).toHaveBeenCalledTimes(1);
    const [track] = (await api.get('/api/tracks')).json().items as TrackDto[];
    expect(track).toMatchObject(trimmed);
    const row = ctx.database.sqlite.prepare('SELECT silence_checked FROM tracks').get();
    expect(row).toEqual({ silence_checked: 1 });
  });

  test('senza silenzio da saltare i campi restano assenti', async () => {
    await setup({ buildOptions: { analyzeSilence: async () => ({}) } });
    await ingest('abcdefghijk');
    await ctx.app.ingest.idle();
    const [track] = (await api.get('/api/tracks')).json().items as TrackDto[];
    expect(track).not.toHaveProperty('trimStartMs');
    expect(track).not.toHaveProperty('trimEndMs');
  });

  test('analisi non riuscita: il brano si importa comunque e resta da analizzare', async () => {
    await setup({ buildOptions: { analyzeSilence: async () => null } });
    await ingest('abcdefghijk');
    await ctx.app.ingest.idle();
    expect((await api.get('/api/tracks')).json().items).toHaveLength(1);
    const row = ctx.database.sqlite.prepare('SELECT silence_checked FROM tracks').get();
    expect(row).toEqual({ silence_checked: 0 });
  });

  test('i brani già in libreria vengono analizzati in background, dai più recenti', async () => {
    const seen: string[] = [];
    const analyze = vi.fn(async (file: string) => {
      seen.push(file);
      return trimmed;
    });
    await setup({ buildOptions: { analyzeSilence: analyze, startIngestWorker: false } });
    const old = await insertTrack(ctx, { addedAt: 1 });
    const recent = await insertTrack(ctx, { addedAt: 2 });
    expect(await ctx.app.ingest.analyzeSilenceBacklog()).toBe(2);
    expect(seen[0]).toContain(recent.id);
    expect(seen[1]).toContain(old.id);
    const items = (await api.get('/api/tracks')).json().items as TrackDto[];
    for (const t of items) expect(t).toMatchObject(trimmed);
    // Già analizzati: al giro successivo non c'è altro da fare.
    expect(await ctx.app.ingest.analyzeSilenceBacklog()).toBe(0);
  });

  test('ffmpeg assente: ci si ferma dopo pochi tentativi, senza marcare i brani', async () => {
    const analyze = vi.fn(async () => null);
    await setup({ buildOptions: { analyzeSilence: analyze, startIngestWorker: false } });
    for (let i = 0; i < 5; i++) await insertTrack(ctx, { addedAt: i });
    expect(await ctx.app.ingest.analyzeSilenceBacklog()).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(3);
    const row = ctx.database.sqlite
      .prepare('SELECT count(*) AS n FROM tracks WHERE silence_checked = 0')
      .get();
    expect(row).toEqual({ n: 5 });
  });
});
