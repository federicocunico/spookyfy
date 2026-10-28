import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { handleAuth } from '../lib/auth.js';
import { handleAudio, handleCover, handleMeta, handleSearch } from '../lib/handlers.js';
import { handle } from '../lib/http.js';
import { CHUNK_BYTES, parseRange, proxyAudio } from '../lib/proxy.js';
import { FakeYoutube } from '../lib/youtube-fake.js';
import {
  type YoutubeClient,
  YoutubeError,
  assertDuration,
  playabilityError,
  withTimeout,
} from '../lib/youtube.js';
import { PASSWORD, TOKEN, makeDeps, req, sessionCookie } from './helpers.js';

/** Risposte di YouTube nella forma di `playability_status` (registrate da casi reali). */
const RECORDED = {
  ok: { status: 'OK' },
  bot: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" },
  private: { status: 'LOGIN_REQUIRED', reason: 'This video is private' },
  removed: { status: 'ERROR', reason: 'This video has been removed by the uploader' },
  unplayable: { status: 'UNPLAYABLE', reason: 'Video unavailable' },
};

describe('mappatura degli errori di YouTube', () => {
  test.each([
    ['ok', null],
    ['bot', 'blocked'],
    ['private', 'unavailable'],
    ['removed', 'unavailable'],
    ['unplayable', 'unavailable'],
  ] as const)('%s → %s', (name, kind) => {
    expect(playabilityError(RECORDED[name])?.kind ?? null).toBe(kind);
  });

  test('durata massima e dirette', () => {
    expect(() => assertDuration(1200, false)).not.toThrow();
    expect(() => assertDuration(45 * 60, false)).toThrow(/20 minuti/);
    expect(() => assertDuration(100, true)).toThrow(YoutubeError);
  });

  test('timeout', async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('Range', () => {
  test.each([
    ['bytes=0-1', 100, { start: 0, end: 1 }],
    ['bytes=50-', 100, { start: 50, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=0-1000', 100, { start: 0, end: 99 }],
    ['bytes=200-', 100, 'invalid'],
    ['items=0-1', 100, 'invalid'],
    [null, 100, null],
  ] as const)('%s su %i byte', (h, size, expected) => {
    expect(parseRange(h, size)).toEqual(expected);
  });
});

describe('proxy audio in streaming', () => {
  const SIZE = 10 * 1024 * 1024;
  const file = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) file[i] = i % 251;
  let server: http.Server;
  let url: string;
  const ranges: string[] = [];

  beforeAll(async () => {
    server = http.createServer((rq, rs) => {
      const m = /^bytes=(\d+)-(\d+)$/.exec(rq.headers.range ?? '');
      ranges.push(rq.headers.range ?? '');
      if (!m) {
        rs.writeHead(200, { 'content-length': SIZE });
        rs.end(file);
        return;
      }
      const [s, e] = [Number(m[1]), Math.min(Number(m[2]), SIZE - 1)];
      rs.writeHead(206, { 'content-range': `bytes ${s}-${e}/${SIZE}`, 'content-length': e - s + 1 });
      rs.end(file.subarray(s, e + 1));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  const src = () => ({ url, sizeBytes: SIZE, mimeType: 'audio/mp4' });

  test('file completo da 10 MB in streaming, letto a blocchi di 8 MB', async () => {
    ranges.length = 0;
    const res = await proxyAudio(src(), null);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(file)).toBe(true);
    expect(ranges).toEqual([`bytes=0-${CHUNK_BYTES - 1}`, `bytes=${CHUNK_BYTES}-${SIZE - 1}`]);
  });

  test('richiesta Range: 206 con Content-Range', async () => {
    const res = await proxyAudio(src(), 'bytes=5000000-5000099');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 5000000-5000099/${SIZE}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(file.subarray(5000000, 5000100))).toBe(true);
  });

  test('intervallo oltre la fine: 416', async () => {
    const res = await proxyAudio(src(), `bytes=${SIZE + 1}-`);
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
  });
});

describe('handler YouTube', () => {
  async function session(d: ReturnType<typeof makeDeps>) {
    const r = await handle(() =>
      handleAuth(
        req('POST', '/api/auth/register', { body: { username: 'fede', password: PASSWORD, token: TOKEN } }),
        'register',
        d,
      ),
    );
    return sessionCookie(r)!;
  }

  test('ricerca: 10 risultati, query non valida 400, blocco 503 con codice dedicato', async () => {
    const d = makeDeps();
    const cookie = await session(d);
    const ok = await handle(() =>
      handleSearch(req('GET', '/api/search?q=come%20as%20you%20are', { cookie, origin: null }), d),
    );
    const body = await ok.json();
    expect(body.items).toHaveLength(10);
    expect(body.items[0]).toMatchObject({
      title: 'come as you are risultato 0',
      artist: 'Canale 0',
      durationMs: 180000,
      trackId: null,
    });
    expect(
      (await handle(() => handleSearch(req('GET', '/api/search?q=', { cookie, origin: null }), d))).status,
    ).toBe(400);
    const blocked = await handle(() =>
      handleSearch(req('GET', '/api/search?q=blocked', { cookie, origin: null }), d),
    );
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error.code).toBe('YOUTUBE_BLOCKED');
  });

  test('metadati: riuscito, troppo lungo 422, non disponibile 404, id non valido 400, senza sessione 401', async () => {
    const d = makeDeps();
    const cookie = await session(d);
    const meta = (id: string, c: string | null = cookie) =>
      handle(() =>
        handleMeta(req('GET', `/api/meta/${id}`, { cookie: c ?? undefined, origin: null }), id, d),
      );
    const ok = await (await meta('abcdefghijk')).json();
    expect(ok).toMatchObject({
      sourceId: 'abcdefghijk',
      title: 'Canzone abcdefghijk',
      durationMs: 3000,
      thumbnailUrl: '/api/cover/abcdefghijk',
    });
    const long = await meta('toolong0000');
    expect(long.status).toBe(422);
    expect((await long.json()).error.code).toBe('VIDEO_TOO_LONG');
    expect((await meta('unavail0000')).status).toBe(404);
    expect((await meta('corto')).status).toBe(400);
    expect((await meta('abcdefghijk', null)).status).toBe(401);
  });

  test('audio tramite gateway con Range e cache degli URL; nessun file scritto', async () => {
    const yt = new FakeYoutube('fake-audio://origin');
    const d = makeDeps({ youtube: yt });
    const cookie = await session(d);
    const audio = (range?: string) =>
      handle(() =>
        handleAudio(
          req('GET', '/api/audio/abcdefghijk', { cookie, origin: null, headers: range ? { range } : {} }),
          'abcdefghijk',
          d,
        ),
      );
    const full = await audio();
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    const bytes = new Uint8Array(await full.arrayBuffer());
    expect(bytes.length).toBe(Number(full.headers.get('content-length')));
    const part = await audio('bytes=0-1');
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xfb]));
    expect(
      (
        await handle(() =>
          handleAudio(req('GET', '/api/audio/abcdefghijk', { origin: null }), 'abcdefghijk', d),
        )
      ).status,
    ).toBe(401);
  });

  test('copertina: immagine dalla stessa origine, cache privata, 401 senza sessione', async () => {
    const d = makeDeps();
    const cookie = await session(d);
    const res = await handle(() =>
      handleCover(req('GET', '/api/cover/abcdefghijk', { cookie, origin: null }), 'abcdefghijk', d),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect(
      (
        await handle(() =>
          handleCover(req('GET', '/api/cover/abcdefghijk', { origin: null }), 'abcdefghijk', d),
        )
      ).status,
    ).toBe(401);
  });

  test('il gateway non conserva nulla dei brani nel KV', async () => {
    const d = makeDeps();
    const cookie = await session(d);
    await handle(() =>
      handleMeta(req('GET', '/api/meta/abcdefghijk', { cookie, origin: null }), 'abcdefghijk', d),
    );
    await (
      await handle(() =>
        handleAudio(req('GET', '/api/audio/abcdefghijk', { cookie, origin: null }), 'abcdefghijk', d),
      )
    ).arrayBuffer();
    const keys = [...(d.kv as unknown as { data: Map<string, unknown> }).data.keys()];
    expect(keys.every((k) => k.startsWith('spk:user:') || k === 'spk:users')).toBe(true);
  });
});

test('interfaccia YoutubeClient rispettata dal finto', () => {
  const y: YoutubeClient = new FakeYoutube('x');
  expect(y.thumbnailUrl('abcdefghijk')).toMatch(/^data:image\/jpeg;base64,/);
});
