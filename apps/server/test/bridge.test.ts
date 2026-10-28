import type { HealthDto } from '@spookyfy/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { accessTokens } from '../src/db/schema.js';
import { insertTrack } from './fixtures/media.js';
import {
  MINUTE,
  STRONG_PASSWORD,
  TEST_ORIGIN,
  type TestContext,
  type TestContextOptions,
  apiClient,
  createTestContext,
  userSession,
} from './helpers.js';

const CLIENT_APP = 'https://spookyfy-client.vercel.app';
let ctx: TestContext;
afterEach(() => ctx?.cleanup());

async function setup(opts: TestContextOptions = {}) {
  ctx = await createTestContext({ env: { BRIDGE_ALLOWED_ORIGINS: CLIENT_APP, ...opts.env }, ...opts });
  const cookie = await userSession(ctx, 'fede');
  return { api: apiClient(ctx, cookie), cookie };
}

/** Richiesta come la farebbe l'app in modalità client: token, altra origine, niente cookie. */
const bridge = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown, origin = CLIENT_APP) =>
  ctx.app.inject({
    method,
    url,
    payload: payload as never,
    headers: { authorization: `Bearer ${token}`, origin },
  });

async function newToken(api: ReturnType<typeof apiClient>, name = 'iPhone client') {
  const res = await api.post('/api/me/tokens', { name });
  expect(res.statusCode).toBe(201);
  return res.json() as { token: string; id: string; name: string };
}

describe('health check', () => {
  test('pubblica, con modalità on-premise e senza dati utente', async () => {
    await setup();
    const res = await ctx.app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    const body = res.json() as HealthDto;
    expect(body).toMatchObject({ status: 'ok', mode: 'onpremise', version: expect.any(String) });
    expect(body.features).toEqual(
      expect.arrayContaining([
        'server-library',
        'remote-search',
        'server-ingest',
        'registration',
        'bridge-tokens',
      ]),
    );
    expect(res.body).not.toMatch(/fede/);
  });

  test('senza origini autorizzate il ponte non compare fra le funzionalità', async () => {
    await setup({ env: { BRIDGE_ALLOWED_ORIGINS: '' } });
    expect((await ctx.app.inject('/api/health')).json().features).not.toContain('bridge-tokens');
  });
});

describe('token di accesso', () => {
  test('mostrato una sola volta e salvato solo come hash', async () => {
    const { api } = await setup();
    const created = await newToken(api);
    expect(created.token).toMatch(/^spk_[A-Za-z0-9_-]{40,}$/);
    const list = (await api.get('/api/me/tokens')).json().items;
    expect(list).toEqual([
      { id: created.id, name: 'iPhone client', createdAt: expect.any(Number), lastUsedAt: null },
    ]);
    expect(JSON.stringify(list)).not.toContain(created.token);
    const rows = ctx.database.db.select().from(accessTokens).all();
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(created.token);
  });

  test('nome obbligatorio', async () => {
    const { api } = await setup();
    expect((await api.post('/api/me/tokens', { name: '  ' })).statusCode).toBe(400);
  });

  test('revoca: le richieste successive vengono rifiutate', async () => {
    const { api } = await setup();
    const { token, id } = await newToken(api);
    expect((await bridge('GET', '/api/jobs', token)).statusCode).toBe(200);
    expect((await api.delete(`/api/me/tokens/${id}`)).statusCode).toBe(204);
    expect((await bridge('GET', '/api/jobs', token)).statusCode).toBe(401);
    expect((await api.delete(`/api/me/tokens/${id}`)).statusCode).toBe(404);
  });

  test('un token non può gestire altri token né accedere alle rotte non del ponte', async () => {
    const { api } = await setup();
    const { token } = await newToken(api);
    // Fuori dalle rotte del ponte il token è ignorato: vale il controllo Origin (403) o la sessione (401).
    expect((await bridge('POST', '/api/me/tokens', token, { name: 'altro' })).statusCode).toBe(403);
    expect((await bridge('POST', '/api/me/tokens', token, { name: 'altro' }, TEST_ORIGIN)).statusCode).toBe(
      401,
    );
    expect((await bridge('GET', '/api/me/tokens', token)).statusCode).toBe(401);
    expect((await bridge('GET', '/api/playlists', token)).statusCode).toBe(401);
    expect((await bridge('GET', '/api/auth/me', token)).statusCode).toBe(401);
  });
});

describe('rotte del ponte con token', () => {
  test('importazione da un’altra origine senza cookie, poi job, brano, audio e copertina', async () => {
    const { api } = await setup();
    const { token } = await newToken(api);
    const ingest = await bridge('POST', '/api/ingest', token, { sourceId: 'abcdefghijk' });
    expect(ingest.statusCode).toBe(202);
    await ctx.app.ingest.idle();
    const job = (await bridge('GET', '/api/jobs', token)).json().items[0];
    expect(job.status).toBe('completed');
    const track = await bridge('GET', `/api/tracks/${job.trackId}`, token);
    expect(track.json().title).toBe('Canzone abcdefghijk');
    const audio = await ctx.app.inject({
      url: `/api/tracks/${job.trackId}/audio`,
      headers: { authorization: `Bearer ${token}`, origin: CLIENT_APP, range: 'bytes=0-1' },
    });
    expect(audio.statusCode).toBe(206);
    expect(audio.headers['access-control-allow-origin']).toBe(CLIENT_APP);
    expect(audio.headers['access-control-expose-headers']).toContain('Content-Range');
    expect((await bridge('GET', `/api/tracks/${job.trackId}/cover?size=128`, token)).statusCode).toBe(200);
    expect((await bridge('GET', '/api/search/remote?q=prova', token)).statusCode).toBe(200);
  });

  test('il controllo Origin resta valido per le richieste con cookie', async () => {
    const { cookie } = await setup();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { sourceId: 'abcdefghijk' },
      headers: { cookie, origin: CLIENT_APP },
    });
    expect(res.statusCode).toBe(403);
  });

  test('token più cookie: il token valido ha la precedenza (nessun rischio CSRF)', async () => {
    const { api, cookie } = await setup();
    const { token } = await newToken(api);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { sourceId: 'abcdefghijk' },
      headers: { cookie, authorization: `Bearer ${token}`, origin: CLIENT_APP },
    });
    expect(res.statusCode).toBe(202);
  });

  test('cookie valido con token falso da un sito terzo: rifiutato, senza ricadere sulla sessione', async () => {
    const { cookie } = await setup();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { sourceId: 'abcdefghijk' },
      headers: { cookie, authorization: 'Bearer spk_falso', origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('senza origini configurate il ponte è disabilitato', async () => {
    const { api } = await setup({ env: { BRIDGE_ALLOWED_ORIGINS: '' } });
    const { token } = await newToken(api);
    expect((await bridge('GET', '/api/jobs', token)).statusCode).toBe(401);
  });

  test('il canale in tempo reale non accetta token', async () => {
    const { api } = await setup();
    const { token } = await newToken(api);
    expect((await bridge('GET', '/api/ws', token)).statusCode).toBe(401);
  });
});

describe('CORS', () => {
  const preflight = (origin: string, url = '/api/ingest') =>
    ctx.app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

  test('origine autorizzata: preflight con metodi e header consentiti, senza credenziali', async () => {
    await setup();
    const res = await preflight(CLIENT_APP);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(CLIENT_APP);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers['access-control-allow-headers']).toContain('Range');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('origine non autorizzata: nessun header CORS', async () => {
    await setup();
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('rotte non del ponte: nessun header CORS anche per l’origine autorizzata', async () => {
    await setup();
    const res = await preflight(CLIENT_APP, '/api/playlists');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('health check leggibile dall’origine autorizzata (verifica del ponte dall’app)', async () => {
    await setup();
    const res = await ctx.app.inject({ url: '/api/health', headers: { origin: CLIENT_APP } });
    expect(res.headers['access-control-allow-origin']).toBe(CLIENT_APP);
    const other = await ctx.app.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('gli errori del ponte restano leggibili dall’app (header CORS anche sul 401)', async () => {
    await setup();
    const res = await bridge('GET', '/api/jobs', 'spk_sbagliato');
    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(CLIENT_APP);
  });
});

describe('limite ai token non validi', () => {
  test('ventunesima richiesta con token non valido: 429; la finestra si libera dopo 15 minuti', async () => {
    const { api } = await setup();
    const { token } = await newToken(api);
    for (let i = 0; i < 20; i++) expect((await bridge('GET', '/api/jobs', `spk_x${i}`)).statusCode).toBe(401);
    const blocked = await bridge('GET', '/api/jobs', token);
    expect(blocked.statusCode).toBe(429);
    ctx.clock.advance(15 * MINUTE);
    expect((await bridge('GET', '/api/jobs', token)).statusCode).toBe(200);
  });
});

test('il ponte non tocca il resto dell’API usata dall’app on-premise', async () => {
  const { api } = await setup();
  const t = await insertTrack(ctx);
  expect((await api.get(`/api/tracks/${t.id}`)).statusCode).toBe(200);
  expect((await api.get('/api/health')).statusCode).toBe(200);
  expect(STRONG_PASSWORD).toBeTruthy();
  expect(TEST_ORIGIN).not.toBe(CLIENT_APP);
});
