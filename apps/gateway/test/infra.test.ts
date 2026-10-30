import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { startDevServer } from '../dev-server.js';
import { GatewayConfigError, loadGatewayConfig } from '../lib/config.js';
import { MemoryKv } from '../lib/kv.js';
import { checkFunctions } from '../scripts/count-functions.mjs';
import { FakeClock } from './helpers.js';

describe('budget di funzioni', () => {
  test('il gateway attuale usa 8 funzioni su 12', () => {
    const r = checkFunctions(path.resolve(import.meta.dirname, '../api'));
    expect(r).toMatchObject({ ok: true, count: 8, max: 12 });
    expect(r.functions).toEqual([
      'audio/[id].ts',
      'auth/[action].ts',
      'cover/[id].ts',
      'health.ts',
      'lookup/[action].ts',
      'meta/[id].ts',
      'search.ts',
      'spotify/[action].ts',
    ]);
  });

  test('con 13 funzioni il controllo fallisce indicando numero e limite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-fn-'));
    for (let i = 0; i < 13; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), 'export {}');
    fs.writeFileSync(path.join(dir, '_helper.ts'), 'export {}'); // escluso
    fs.writeFileSync(path.join(dir, 'types.d.ts'), 'export {}'); // escluso
    const r = checkFunctions(dir);
    expect(r).toMatchObject({ ok: false, count: 13, max: 12 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('configurazione', () => {
  test('segreto troppo corto o origine mancante bloccano l’avvio', () => {
    expect(() => loadGatewayConfig({ SESSION_SECRET: 'corto', PUBLIC_ORIGIN: 'https://x.test' })).toThrow(
      GatewayConfigError,
    );
    expect(() => loadGatewayConfig({ SESSION_SECRET: 'x'.repeat(40) })).toThrow(/PUBLIC_ORIGIN/);
  });

  test('su Vercel l’origine predefinita è il dominio di produzione; KV da entrambi i nomi di variabile', () => {
    const c = loadGatewayConfig({
      SESSION_SECRET: 'x'.repeat(40),
      VERCEL_PROJECT_PRODUCTION_URL: 'spookyfy.vercel.app',
      UPSTASH_REDIS_REST_URL: 'https://eu1-x.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok',
    });
    expect(c.publicOrigin).toBe('https://spookyfy.vercel.app');
    expect(c.kv).toEqual({ kind: 'upstash', url: 'https://eu1-x.upstash.io', token: 'tok' });
    // REDIS_URL (integrazione Redis Cloud) ha la precedenza.
    expect(
      loadGatewayConfig({
        SESSION_SECRET: 'x'.repeat(40),
        PUBLIC_ORIGIN: 'https://a.test',
        REDIS_URL: 'redis://u:p@h:1',
      }).kv,
    ).toEqual({ kind: 'redis', url: 'redis://u:p@h:1' });
    expect(() =>
      loadGatewayConfig({
        SESSION_SECRET: 'x'.repeat(40),
        PUBLIC_ORIGIN: 'https://a.test',
        REDIS_URL: 'http://h',
      }),
    ).toThrow(/REDIS_URL/);
    expect(c.registrationToken).toBe('spotifymerdacostosa2026');
    expect(
      loadGatewayConfig({
        SESSION_SECRET: 'x'.repeat(40),
        PUBLIC_ORIGIN: 'https://a.test',
        REGISTRATION_TOKEN: '',
      }).registrationToken,
    ).toBe('');
  });
});

describe('KV in memoria', () => {
  test('TTL, SET NX, INCR con finestra, PTTL e insiemi', async () => {
    const clock = new FakeClock();
    const kv = new MemoryKv(clock);
    expect(await kv.set('a', { x: 1 }, { nx: true })).toBe(true);
    expect(await kv.set('a', { x: 2 }, { nx: true })).toBe(false);
    expect(await kv.get('a')).toEqual({ x: 1 });

    await kv.set('t', 1, { exSeconds: 10 });
    expect(await kv.pttl('t')).toBe(10_000);
    clock.advance(10_000);
    expect(await kv.get('t')).toBeNull();
    expect(await kv.pttl('t')).toBe(-2);

    expect(await kv.incrWindow('c', 60)).toBe(1);
    clock.advance(30_000);
    expect(await kv.incrWindow('c', 60)).toBe(2);
    clock.advance(30_000); // la finestra parte dal primo incremento
    expect(await kv.incrWindow('c', 60)).toBe(1);

    expect(await kv.mget('a', 'manca')).toEqual([{ x: 1 }, null]);
    expect(await kv.del('a', 'manca')).toBe(1);
    await kv.sadd('s', 'x');
    await kv.sadd('s', 'y');
    await kv.srem('s', 'x');
    expect(await kv.smembers('s')).toEqual(['y']);
  });
});

test('dev server: health in modalità client', async () => {
  const s = await startDevServer({ port: 0 || 4391, webDist: os.tmpdir() });
  try {
    const res = await fetch(`${s.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ok',
      mode: 'client',
      features: expect.arrayContaining(['device-ingest']),
    });
    expect((await fetch(`${s.url}/api/nope`)).status).toBe(404);
  } finally {
    await s.close();
  }
});

test('parametro delle rotte dinamiche da query (riscrittura di Vercel) o dal percorso', async () => {
  const { routeParam } = await import('../lib/http.js');
  expect(routeParam(new Request('https://x.test/api/meta/[id]?id=abcdefghijk'), 'id')).toBe('abcdefghijk');
  expect(routeParam(new Request('https://x.test/api/meta/abcdefghijk'), 'id')).toBe('abcdefghijk');
  expect(routeParam(new Request('https://x.test/api/auth/login'), 'action')).toBe('login');
});
