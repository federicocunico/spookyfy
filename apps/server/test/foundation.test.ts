import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseOrThrow } from '../src/http-errors.js';
import { type TestContext, createTestContext, userSession } from './helpers.js';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

describe('gestione errori', () => {
  test('un errore di validazione restituisce 400 nel formato atteso', async () => {
    ctx = await createTestContext({
      beforeReady: (app) =>
        app.get('/api/__echo', { config: { public: true } }, async (req) =>
          parseOrThrow(
            z.object({ n: z.coerce.number({ message: 'n deve essere un numero' }).int() }),
            req.query,
          ),
        ),
    });
    const ok = await ctx.app.inject('/api/__echo?n=3');
    expect(ok.json()).toEqual({ n: 3 });
    const res = await ctx.app.inject('/api/__echo?n=abc');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'n deve essere un numero',
        fields: { n: ['n deve essere un numero'] },
      },
    });
  });

  test('un errore imprevisto restituisce 500 senza dettagli interni', async () => {
    ctx = await createTestContext({
      beforeReady: (app) =>
        app.get('/api/__boom', { config: { public: true } }, async () => {
          throw new Error('segreto interno');
        }),
    });
    const res = await ctx.app.inject('/api/__boom');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('segreto');
  });
});

describe('fallback SPA', () => {
  test('una rotta dell’app restituisce l’app shell', async () => {
    ctx = await createTestContext({ withWebDist: true });
    const res = await ctx.app.inject('/playlist/abc');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<div id="app">');
  });

  test('un endpoint API inesistente restituisce 404 JSON', async () => {
    ctx = await createTestContext({ withWebDist: true });
    const cookie = await userSession(ctx);
    const res = await ctx.app.inject({ url: '/api/unknown', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Endpoint non trovato' } });
  });

  test('gli asset con hash sono immutabili', async () => {
    ctx = await createTestContext({ withWebDist: true });
    const res = await ctx.app.inject('/assets/app-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });
});
