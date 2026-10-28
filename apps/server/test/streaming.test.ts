import fs from 'node:fs';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { insertTrack } from './fixtures/media.js';
import { type TestContext, apiClient, createTestContext, userSession } from './helpers.js';

let ctx: TestContext;
let api: ReturnType<typeof apiClient>;
let track: Awaited<ReturnType<typeof insertTrack>>;
let size: number;
beforeEach(async () => {
  ctx = await createTestContext();
  api = apiClient(ctx, await userSession(ctx));
  track = await insertTrack(ctx, { durationMs: 5000 });
  size = fs.statSync(track.audioFile).size;
});
afterEach(() => ctx.cleanup());

const audioUrl = () => `/api/tracks/${track.id}/audio`;

describe('streaming audio', () => {
  test('byte 0-1: 206 con 2 byte e Content-Range', async () => {
    const res = await api.get(audioUrl(), { range: 'bytes=0-1' });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload).toHaveLength(2);
    expect(res.headers['content-range']).toBe(`bytes 0-1/${size}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('audio/mpeg');
  });

  test('seek a metà: solo i byte dall’offset', async () => {
    const half = Math.floor(size / 2);
    const res = await api.get(audioUrl(), { range: `bytes=${half}-` });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload).toHaveLength(size - half);
    expect(res.rawPayload.equals(fs.readFileSync(track.audioFile).subarray(half))).toBe(true);
  });

  test('senza Range: 200 con il file intero', async () => {
    const res = await api.get(audioUrl());
    expect(res.statusCode).toBe(200);
    expect(Number(res.headers['content-length'])).toBe(size);
    expect(res.rawPayload.equals(fs.readFileSync(track.audioFile))).toBe(true);
    expect(res.headers.etag).toBeDefined();
  });

  test('intervallo oltre la fine: 416 con la dimensione totale', async () => {
    const res = await api.get(audioUrl(), { range: `bytes=${size + 10}-` });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${size}`);
  });

  test('brano inesistente: 404', async () => {
    expect((await api.get('/api/tracks/nope/audio')).statusCode).toBe(404);
  });

  test('cache privata e immutabile', async () => {
    const res = await api.get(audioUrl(), { range: 'bytes=0-1' });
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  });
});

describe('copertine', () => {
  test('grande ≥ 512 px e miniatura ≤ 128 px', async () => {
    const big = await api.get(`/api/tracks/${track.id}/cover?size=512`);
    expect(big.statusCode).toBe(200);
    expect(big.headers['content-type']).toBe('image/jpeg');
    expect(big.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    const bigMeta = await sharp(big.rawPayload).metadata();
    expect(Math.min(bigMeta.width!, bigMeta.height!)).toBeGreaterThanOrEqual(512);

    const thumb = await api.get(`/api/tracks/${track.id}/cover?size=128`);
    const thumbMeta = await sharp(thumb.rawPayload).metadata();
    expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBeLessThanOrEqual(128);

    expect((await api.get(`/api/tracks/${track.id}/cover`)).statusCode).toBe(200);
    expect((await api.get(`/api/tracks/${track.id}/cover?size=64`)).statusCode).toBe(400);
  });
});

describe('autenticazione', () => {
  test('audio e copertine rispondono 401 senza sessione', async () => {
    const audio = await ctx.app.inject({ url: audioUrl(), headers: { range: 'bytes=0-1' } });
    expect(audio.statusCode).toBe(401);
    expect(audio.headers['content-type']).toContain('application/json');
    expect((await ctx.app.inject(`/api/tracks/${track.id}/cover?size=128`)).statusCode).toBe(401);
  });
});
