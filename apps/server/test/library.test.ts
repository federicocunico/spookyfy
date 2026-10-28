import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { PlaylistDto, TrackDto } from '@spookyfy/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { absMediaPath, coverRelPath } from '../src/media/paths.js';
import { readTags } from '../src/media/tags.js';
import { insertTrack } from './fixtures/media.js';
import { type TestContext, apiClient, createTestContext, createUser, login, userSession } from './helpers.js';

let ctx: TestContext;
let api: ReturnType<typeof apiClient>;
beforeEach(async () => {
  ctx = await createTestContext();
  api = apiClient(ctx, await userSession(ctx, 'fede'));
});
afterEach(() => ctx.cleanup());

const asAnna = async () => {
  await createUser(ctx, 'anna');
  return apiClient(ctx, await login(ctx, 'anna'));
};

describe('catalogo', () => {
  test('120 brani, pagine da 50 ordinate per data di aggiunta decrescente', async () => {
    const base = ctx.clock.now();
    for (let i = 0; i < 120; i++) {
      ctx.database.sqlite
        .prepare(
          `INSERT INTO tracks (id, source, source_id, title, artist, duration_ms, size_bytes, dominant_color, audio_path, cover_path, added_at)
           VALUES (?, 'youtube', ?, ?, 'A', 1000, 1, '#000000', 'a', 'c', ?)`,
        )
        .run(`t${String(i).padStart(3, '0')}`, `s${String(i).padStart(10, '0')}`, `T${i}`, base + i);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api.get(`/api/tracks?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode).toBe(200);
      const page = res.json() as { items: TrackDto[]; nextCursor: string | null };
      if (pages === 0) {
        expect(page.items).toHaveLength(50);
        expect(page.items[0]!.id).toBe('t119');
        expect(page.nextCursor).not.toBeNull();
      }
      seen.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen.at(-1)).toBe('t000');
  });

  test('ordinamento per titolo e artista senza distinzione di maiuscole', async () => {
    await insertTrack(ctx, { title: 'beta', artist: 'Zed' });
    await insertTrack(ctx, { title: 'Alfa', artist: 'abba' });
    await insertTrack(ctx, { title: 'gamma', artist: 'Mina' });
    const byTitle = (await api.get('/api/tracks?sort=title&limit=2')).json();
    expect(byTitle.items.map((t: TrackDto) => t.title)).toEqual(['Alfa', 'beta']);
    const next = (await api.get(`/api/tracks?sort=title&limit=2&cursor=${byTitle.nextCursor}`)).json();
    expect(next.items.map((t: TrackDto) => t.title)).toEqual(['gamma']);
    const byArtist = (await api.get('/api/tracks?sort=artist')).json();
    expect(byArtist.items.map((t: TrackDto) => t.artist)).toEqual(['abba', 'Mina', 'Zed']);
  });

  test('cursore non valido', async () => {
    expect((await api.get('/api/tracks?cursor=xyz')).statusCode).toBe(400);
  });

  test('un brano importato da fede è visibile ad anna', async () => {
    const t = await insertTrack(ctx);
    const anna = await asAnna();
    const res = await anna.get(`/api/tracks/${t.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: t.id,
      audioUrl: `/api/tracks/${t.id}/audio`,
      coverUrl: `/api/tracks/${t.id}/cover?size=512`,
      coverThumbUrl: `/api/tracks/${t.id}/cover?size=128`,
      dominantColor: '#c02020',
      isFavorite: false,
      playCount: 0,
      lastPlayedAt: null,
    });
    expect((await api.get('/api/tracks/inesistente')).statusCode).toBe(404);
  });
});

describe('ricerca locale', () => {
  test('"nirv" trova "Nirvana", senza distinzione di maiuscole e accenti', async () => {
    await insertTrack(ctx, { title: 'Come As You Are', artist: 'Nirvana' });
    await insertTrack(ctx, { title: 'Jóga', artist: 'Björk' });
    await insertTrack(ctx, { title: 'Altro', artist: 'Altri' });
    const nirv = (await api.get('/api/tracks?q=nirv')).json();
    expect(nirv.items.map((t: TrackDto) => t.artist)).toEqual(['Nirvana']);
    const bjork = (await api.get('/api/tracks?q=BJORK%20jog')).json();
    expect(bjork.items.map((t: TrackDto) => t.title)).toEqual(['Jóga']);
  });

  test('nessuna corrispondenza: elenco vuoto senza errori', async () => {
    await insertTrack(ctx, { title: 'Come As You Are', artist: 'Nirvana' });
    const res = await api.get('/api/tracks?q=zzzzz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
    expect((await api.get('/api/tracks?q=%22%2A%28')).json().items).toEqual([]);
  });
});

describe('modifica ed eliminazione', () => {
  test('la correzione del titolo aggiorna catalogo e tag ID3', async () => {
    const t = await insertTrack(ctx, { title: 'Song (Official Video)', artist: 'Band' });
    const res = await api.patch(`/api/tracks/${t.id}`, { title: 'Song', album: 'Disco' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Song', artist: 'Band', album: 'Disco' });
    expect(res.json().sizeBytes).toBe(fs.statSync(t.audioFile).size);
    const tags = await readTags(t.audioFile);
    expect(tags.title).toBe('Song');
    expect(tags.artist).toBe('Band');
    expect(tags.album).toBe('Disco');
    expect((await api.patch(`/api/tracks/${t.id}`, { title: '  ' })).statusCode).toBe(400);
    expect((await api.patch(`/api/tracks/${t.id}`, {})).statusCode).toBe(400);
  });

  test('eliminazione: sparisce da catalogo e playlist e i file non esistono più', async () => {
    const t = await insertTrack(ctx);
    const p1 = (await api.post('/api/playlists', { name: 'Uno' })).json() as PlaylistDto;
    const p2 = (await api.post('/api/playlists', { name: 'Due' })).json() as PlaylistDto;
    await api.post(`/api/playlists/${p1.id}/items`, { trackId: t.id });
    await api.post(`/api/playlists/${p2.id}/items`, { trackId: t.id });
    await api.put(`/api/me/favorites/${t.id}`);

    expect((await api.delete(`/api/tracks/${t.id}`)).statusCode).toBe(204);
    expect((await api.get(`/api/tracks/${t.id}`)).statusCode).toBe(404);
    expect((await api.get(`/api/playlists/${p1.id}`)).json().items).toEqual([]);
    expect((await api.get(`/api/playlists/${p2.id}`)).json().items).toEqual([]);
    expect((await api.get('/api/me/favorites')).json().items).toEqual([]);
    expect(fs.existsSync(t.audioFile)).toBe(false);
    expect(fs.existsSync(absMediaPath(ctx.config.mediaDir, coverRelPath(t.coverPrefix, 512)))).toBe(false);
    expect((await api.delete(`/api/tracks/${t.id}`)).statusCode).toBe(404);
  });
});

describe('preferiti', () => {
  test('aggiunta in cima e preferiti personali', async () => {
    const a = await insertTrack(ctx);
    const b = await insertTrack(ctx);
    await api.put(`/api/me/favorites/${a.id}`);
    ctx.clock.advance(1000);
    await api.put(`/api/me/favorites/${b.id}`);
    await api.put(`/api/me/favorites/${b.id}`); // idempotente
    const favs = (await api.get('/api/me/favorites')).json();
    expect(favs.items.map((f: { track: TrackDto }) => f.track.id)).toEqual([b.id, a.id]);
    expect(favs.items[0].track.isFavorite).toBe(true);

    const anna = await asAnna();
    expect((await anna.get('/api/me/favorites')).json().items).toEqual([]);
    expect((await anna.get(`/api/tracks/${a.id}`)).json().isFavorite).toBe(false);

    await api.delete(`/api/me/favorites/${a.id}`);
    expect((await api.get('/api/me/favorites')).json().items).toHaveLength(1);
    expect((await api.put('/api/me/favorites/nope')).statusCode).toBe(404);
  });
});

describe('playlist', () => {
  test('creazione, aggiunta nell’ordine e duplicati ammessi', async () => {
    const [a, b, c] = [await insertTrack(ctx), await insertTrack(ctx), await insertTrack(ctx)];
    const created = await api.post('/api/playlists', { name: '  Notte  ' });
    expect(created.statusCode).toBe(201);
    const p = created.json() as PlaylistDto;
    expect(p.name).toBe('Notte');
    for (const t of [a, b, c, a])
      expect((await api.post(`/api/playlists/${p.id}/items`, { trackId: t.id })).statusCode).toBe(201);
    const full = (await api.get(`/api/playlists/${p.id}`)).json() as PlaylistDto;
    expect(full.items.map((i) => i.track.id)).toEqual([a.id, b.id, c.id, a.id]);
    expect(full.trackCount).toBe(4);
    expect(full.durationMs).toBe(12000);
    expect(full.coverTrackIds).toEqual([a.id, b.id, c.id]);
    expect((await api.get('/api/playlists')).json().items[0]).toMatchObject({ id: p.id, trackCount: 4 });
  });

  test('riordino', async () => {
    const tracks = [
      await insertTrack(ctx),
      await insertTrack(ctx),
      await insertTrack(ctx),
      await insertTrack(ctx),
    ];
    const p = (await api.post('/api/playlists', { name: 'R' })).json() as PlaylistDto;
    for (const t of tracks) await api.post(`/api/playlists/${p.id}/items`, { trackId: t.id });
    let full = (await api.get(`/api/playlists/${p.id}`)).json() as PlaylistDto;
    const ids = () => full.items.map((i) => i.track.id);

    // L'ultimo in prima posizione.
    full = (
      await api.post(`/api/playlists/${p.id}/items/${full.items[3]!.itemId}/move`, { toIndex: 0 })
    ).json();
    expect(ids()).toEqual([tracks[3]!.id, tracks[0]!.id, tracks[1]!.id, tracks[2]!.id]);
    // Il primo in fondo (indice oltre la fine = ultimo).
    full = (
      await api.post(`/api/playlists/${p.id}/items/${full.items[0]!.itemId}/move`, { toIndex: 99 })
    ).json();
    expect(ids()).toEqual([tracks[0]!.id, tracks[1]!.id, tracks[2]!.id, tracks[3]!.id]);
    // In mezzo, ripetuto molte volte per forzare la rinumerazione.
    for (let i = 0; i < 80; i++) {
      full = (
        await api.post(`/api/playlists/${p.id}/items/${full.items[3]!.itemId}/move`, { toIndex: 1 })
      ).json();
    }
    expect(new Set(ids()).size).toBe(4);
    expect(
      (await api.get(`/api/playlists/${p.id}`)).json().items.map((i: { track: TrackDto }) => i.track.id),
    ).toEqual(ids());
  });

  test('rinomina, rimozione elemento ed eliminazione', async () => {
    const t = await insertTrack(ctx);
    const p = (await api.post('/api/playlists', { name: 'Vecchio' })).json() as PlaylistDto;
    const item = (await api.post(`/api/playlists/${p.id}/items`, { trackId: t.id })).json();
    expect((await api.patch(`/api/playlists/${p.id}`, { name: 'Nuovo' })).json().name).toBe('Nuovo');
    expect((await api.delete(`/api/playlists/${p.id}/items/${item.itemId}`)).statusCode).toBe(204);
    expect((await api.get(`/api/playlists/${p.id}`)).json().items).toEqual([]);
    expect((await api.delete(`/api/playlists/${p.id}`)).statusCode).toBe(204);
    expect((await api.get(`/api/playlists/${p.id}`)).statusCode).toBe(404);
  });

  test('nome non valido', async () => {
    expect((await api.post('/api/playlists', { name: '' })).statusCode).toBe(400);
    expect((await api.post('/api/playlists', { name: '   ' })).statusCode).toBe(400);
    expect((await api.post('/api/playlists', { name: 'x'.repeat(101) })).statusCode).toBe(400);
    expect((await api.post('/api/playlists', { name: 'x'.repeat(100) })).statusCode).toBe(201);
  });

  test('le playlist altrui si comportano come inesistenti', async () => {
    const t = await insertTrack(ctx);
    const p = (await api.post('/api/playlists', { name: 'Mia' })).json() as PlaylistDto;
    const anna = await asAnna();
    expect((await anna.get(`/api/playlists/${p.id}`)).statusCode).toBe(404);
    expect((await anna.patch(`/api/playlists/${p.id}`, { name: 'X' })).statusCode).toBe(404);
    expect((await anna.post(`/api/playlists/${p.id}/items`, { trackId: t.id })).statusCode).toBe(404);
    expect((await anna.delete(`/api/playlists/${p.id}`)).statusCode).toBe(404);
    expect((await anna.get('/api/playlists')).json().items).toEqual([]);
  });
});

describe('ascolti', () => {
  test('registrazione in blocco con orario originale e statistiche per brano', async () => {
    const t = await insertTrack(ctx);
    const t0 = ctx.clock.now() - 3600_000;
    const plays = [
      { id: randomUUID(), trackId: t.id, playedAt: t0 },
      { id: randomUUID(), trackId: t.id, playedAt: t0 + 1000 },
    ];
    const res = await api.post('/api/me/plays', { plays });
    expect(res.json()).toEqual({ recorded: 2, ignored: 0 });
    expect((await api.get(`/api/tracks/${t.id}`)).json()).toMatchObject({
      playCount: 2,
      lastPlayedAt: t0 + 1000,
    });
  });

  test('un reinvio non duplica gli ascolti', async () => {
    const t = await insertTrack(ctx);
    const plays = [{ id: randomUUID(), trackId: t.id, playedAt: ctx.clock.now() }];
    await api.post('/api/me/plays', { plays });
    expect((await api.post('/api/me/plays', { plays })).json()).toEqual({ recorded: 0, ignored: 1 });
    expect((await api.get(`/api/tracks/${t.id}`)).json().playCount).toBe(1);
  });

  test('ascolti di brani eliminati o nel futuro vengono ignorati', async () => {
    const res = await api.post('/api/me/plays', {
      plays: [
        { id: randomUUID(), trackId: 'sparito', playedAt: ctx.clock.now() },
        { id: randomUUID(), trackId: 'sparito', playedAt: ctx.clock.now() + 86_400_000 },
      ],
    });
    expect(res.json()).toEqual({ recorded: 0, ignored: 2 });
    expect((await api.post('/api/me/plays', { plays: [] })).statusCode).toBe(400);
  });

  test('ascoltati di recente: A, B, A → A, B', async () => {
    const a = await insertTrack(ctx, { title: 'A' });
    const b = await insertTrack(ctx, { title: 'B' });
    const now = ctx.clock.now();
    await api.post('/api/me/plays', {
      plays: [
        { id: randomUUID(), trackId: a.id, playedAt: now - 3000 },
        { id: randomUUID(), trackId: b.id, playedAt: now - 2000 },
        { id: randomUUID(), trackId: a.id, playedAt: now - 1000 },
      ],
    });
    const recent = (await api.get('/api/me/recent-plays')).json();
    expect(recent.items.map((t: TrackDto) => t.title)).toEqual(['A', 'B']);
    const anna = await asAnna();
    expect((await anna.get('/api/me/recent-plays')).json().items).toEqual([]);
  });

  test('aggiunti di recente per la Home', async () => {
    await insertTrack(ctx, { title: 'Vecchio', addedAt: 1 });
    await insertTrack(ctx, { title: 'Nuovo', addedAt: 2 });
    const res = (await api.get('/api/tracks?sort=added&limit=1')).json();
    expect(res.items.map((t: TrackDto) => t.title)).toEqual(['Nuovo']);
  });
});
