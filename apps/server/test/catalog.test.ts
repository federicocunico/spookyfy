import fs from 'node:fs';
import path from 'node:path';
import type { AlbumDto, AlbumSummaryDto, GenreDetailDto, TrackDto } from '@spookyfy/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readTags } from '../src/media/tags.js';
import { insertTrack, solidJpeg } from './fixtures/media.js';
import {
  TEST_ORIGIN,
  type TestContext,
  type TestContextOptions,
  apiClient,
  createTestContext,
  createUser,
  login,
  makeTempDir,
  userSession,
} from './helpers.js';

let ctx: TestContext;
let api: ReturnType<typeof apiClient>;
async function setup(opts: TestContextOptions = {}) {
  ctx = await createTestContext(opts);
  api = apiClient(ctx, await userSession(ctx, 'fede'));
}
afterEach(() => ctx?.cleanup());

const albums = () => ctx.app.catalog.albums;
const listAlbums = async (q = '') => (await api.get(`/api/albums${q}`)).json().items as AlbumSummaryDto[];
const getAlbum = async (id: string) => (await api.get(`/api/albums/${id}`)).json() as AlbumDto;
const track = async (id: string) => (await api.get(`/api/tracks/${id}`)).json() as TrackDto;
const createAlbum = async (body: unknown) => {
  const res = await api.post('/api/albums', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as AlbumDto;
};
const putCover = (id: string, body: Buffer, type = 'image/jpeg') =>
  ctx.app.inject({
    method: 'PUT',
    url: `/api/albums/${id}/cover`,
    payload: body,
    headers: { cookie: api.cookie, origin: TEST_ORIGIN, 'content-type': type },
  });

describe('migrazione 0004', () => {
  test('su un database con brani esistenti: colonne nuove e ricerca ricostruita con album e generi', () => {
    const dir = makeTempDir();
    try {
      // Database fermo alla 0003, con un brano.
      const all = path.resolve(import.meta.dirname, '../drizzle');
      const old = path.join(dir, 'drizzle');
      fs.mkdirSync(path.join(old, 'meta'), { recursive: true });
      for (const f of fs.readdirSync(all).filter((f) => /^000[0-3]_/.test(f)))
        fs.copyFileSync(path.join(all, f), path.join(old, f));
      const journal = JSON.parse(fs.readFileSync(path.join(all, 'meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 3);
      fs.writeFileSync(path.join(old, 'meta/_journal.json'), JSON.stringify(journal));
      const sqlite = new Database(path.join(dir, 'db.sqlite'));
      sqlite.pragma('foreign_keys = ON');
      migrate(drizzle(sqlite), { migrationsFolder: old });
      sqlite
        .prepare(
          `INSERT INTO tracks (id, source, source_id, title, artist, album, duration_ms, size_bytes, dominant_color, audio_path, cover_path, added_at)
           VALUES ('t1', 'youtube', 'abcdefghijk', 'Airbag', 'Radiohead', 'OK Computer', 1000, 1, '#000000', 'a', 'c', 1)`,
        )
        .run();

      migrate(drizzle(sqlite), { migrationsFolder: all });
      const t = sqlite.prepare('SELECT album, album_id, album_position FROM tracks').get();
      expect(t).toEqual({ album: 'OK Computer', album_id: null, album_position: null });
      const hit = (q: string) =>
        sqlite.prepare('SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?').all(q) as {
          track_id: string;
        }[];
      expect(hit('"comput"*')).toEqual([{ track_id: 't1' }]);
      sqlite.prepare("INSERT INTO genres (id, name, key) VALUES ('g1', 'Art Rock', 'art rock')").run();
      sqlite.prepare("INSERT INTO track_genres (track_id, genre_id) VALUES ('t1', 'g1')").run();
      expect(hit('genres:"art"*')).toEqual([{ track_id: 't1' }]);
      sqlite.prepare('DELETE FROM track_genres').run();
      expect(hit('genres:"art"*')).toEqual([]);
      sqlite.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assegnazione dei brani agli album', () => {
  test('creazione, spostamento fra album, rimozione', async () => {
    await setup();
    const t = await insertTrack(ctx);
    const a = albums().findOrCreate('Nevermind', 'Nirvana', 'auto');
    const b = albums().findOrCreate('In Utero', 'Nirvana', 'manual');
    expect(albums().findOrCreate('  NEVERMIND ', 'nirvana', 'auto')).toBe(a);

    albums().setTrackAlbum(t.id, a);
    expect(await track(t.id)).toMatchObject({ albumId: a, album: 'Nevermind' });
    albums().setTrackAlbum(t.id, b);
    expect(await track(t.id)).toMatchObject({ albumId: b, album: 'In Utero' });
    // L'album automatico rimasto vuoto sparisce.
    expect(albums().exists(a)).toBe(false);

    albums().setTrackAlbum(t.id, null);
    expect(await track(t.id)).toMatchObject({ albumId: null, album: null });
    // L'album creato a mano resta anche vuoto.
    expect(albums().exists(b)).toBe(true);
  });

  test('un album automatico svuotato dall’eliminazione del brano sparisce', async () => {
    await setup();
    const t = await insertTrack(ctx);
    const a = albums().findOrCreate('Demo', 'Band', 'auto');
    albums().setTrackAlbum(t.id, a);
    expect((await api.delete(`/api/tracks/${t.id}`)).statusCode).toBe(204);
    expect(await listAlbums()).toEqual([]);
  });
});

describe('raggruppamento automatico', () => {
  test('due importazioni dello stesso disco: un solo album; un brano senza album non ne ha', async () => {
    await setup();
    for (const sourceId of ['topic000001', 'topic000002', 'plain000001']) {
      expect((await api.post('/api/ingest', { sourceId })).statusCode).toBe(202);
      await ctx.app.ingest.idle();
    }
    await vi.waitFor(async () =>
      expect(
        (await api.get('/api/jobs')).json().items.every((j: { status: string }) => j.status === 'completed'),
      ).toBe(true),
    );
    const list = await listAlbums();
    expect(list).toEqual([expect.objectContaining({ title: 'Nevermind', artist: 'Nirvana', trackCount: 2 })]);
    const plain = (await api.get('/api/tracks?limit=50'))
      .json()
      .items.find((t: TrackDto) => t.album === null);
    expect(plain).toMatchObject({ albumId: null });
  });

  test('numero di traccia: i brani si ordinano anche se importati in disordine', async () => {
    await setup();
    const t2 = await insertTrack(ctx, { title: 'Due' });
    const t1 = await insertTrack(ctx, { title: 'Uno' });
    albums().assignByMetadata(t2.id, 'In Utero', 'Nirvana', 2);
    albums().assignByMetadata(t1.id, 'In Utero', 'Nirvana', 1);
    const [album] = await listAlbums();
    expect((await getAlbum(album!.id)).tracks.map((t) => t.title)).toEqual(['Uno', 'Due']);
  });

  test('brani esistenti raggruppati una sola volta, playlist invariate', async () => {
    await setup();
    const ids = [];
    for (const title of ['Airbag', 'Paranoid Android', 'Lucky'])
      ids.push((await insertTrack(ctx, { title, artist: 'Radiohead', album: 'OK Computer' })).id);
    const pl = (await api.post('/api/playlists', { name: 'Notte' })).json();
    for (const id of [ids[2], ids[0]]) await api.post(`/api/playlists/${pl.id}/items`, { trackId: id });
    // Come un server aggiornato: il marcatore non c'è ancora.
    ctx.database.sqlite.prepare("DELETE FROM app_settings WHERE key = 'albums_grouped'").run();

    expect(albums().groupExistingTracks()).toBe(3);
    expect(albums().groupExistingTracks()).toBe(0);
    const list = await listAlbums();
    expect(list).toEqual([
      expect.objectContaining({ title: 'OK Computer', artist: 'Radiohead', trackCount: 3 }),
    ]);
    const playlist = (await api.get(`/api/playlists/${pl.id}`)).json();
    expect(playlist.items.map((i: { track: TrackDto }) => i.track.title)).toEqual(['Lucky', 'Airbag']);
  });
});

describe('campo album del brano', () => {
  test('"Nevermind (Remastered)" → "Nevermind" sposta il brano; un campo vuoto lo toglie', async () => {
    await setup();
    const t = await insertTrack(ctx, { artist: 'Nirvana' });
    albums().assignByMetadata(t.id, 'Nevermind (Remastered)', 'Nirvana');
    const res = await api.patch(`/api/tracks/${t.id}`, { album: 'Nevermind' });
    expect(res.statusCode).toBe(200);
    const after = res.json() as TrackDto;
    expect(after.album).toBe('Nevermind');
    expect((await listAlbums()).map((a) => a.title)).toEqual(['Nevermind']);
    expect(after.albumId).toBe((await listAlbums())[0]!.id);

    expect((await api.patch(`/api/tracks/${t.id}`, { album: '' })).json()).toMatchObject({
      album: null,
      albumId: null,
    });
    expect(await listAlbums()).toEqual([]);
  });
});

describe('API degli album', () => {
  test('creazione e aggiunta, riordino, visibilità per tutti gli account', async () => {
    await setup();
    const ts = [];
    for (const title of ['A', 'B', 'C']) ts.push(await insertTrack(ctx, { title, durationMs: 2000 }));
    const album = await createAlbum({ title: 'Demo 2026', year: 2026 });
    expect(album).toMatchObject({ artist: 'Artisti vari', year: 2026, origin: 'manual', trackCount: 0 });
    for (const t of ts) await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [t.id] });
    let detail = await getAlbum(album.id);
    expect(detail.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C']);
    expect(detail).toMatchObject({ trackCount: 3, durationMs: 6000 });

    const moved = await api.post(`/api/albums/${album.id}/tracks/${ts[2]!.id}/move`, { toIndex: 0 });
    expect((moved.json() as AlbumDto).tracks.map((t) => t.title)).toEqual(['C', 'A', 'B']);

    await createUser(ctx, 'anna');
    const anna = apiClient(ctx, await login(ctx, 'anna'));
    expect((await anna.get('/api/albums')).json().items.map((a: AlbumSummaryDto) => a.title)).toEqual([
      'Demo 2026',
    ]);

    const removed = await api.delete(`/api/albums/${album.id}/tracks/${ts[0]!.id}`);
    detail = removed.json();
    expect(detail.tracks.map((t) => t.title)).toEqual(['C', 'B']);
  });

  test('ordinamento e ricerca dell’elenco', async () => {
    await setup();
    await createAlbum({ title: 'Zeta', artist: 'Alfa' });
    ctx.clock.advance(1000);
    await createAlbum({ title: 'Nevermind', artist: 'Nirvana' });
    expect((await listAlbums('?sort=added')).map((a) => a.title)).toEqual(['Nevermind', 'Zeta']);
    expect((await listAlbums('?sort=title')).map((a) => a.title)).toEqual(['Nevermind', 'Zeta']);
    expect((await listAlbums('?sort=artist')).map((a) => a.title)).toEqual(['Zeta', 'Nevermind']);
    expect((await listAlbums('?q=nevermi')).map((a) => a.title)).toEqual(['Nevermind']);
  });

  test('modifica di titolo, artista e anno; il campo album dei brani segue', async () => {
    await setup();
    const t = await insertTrack(ctx);
    const album = await createAlbum({ title: 'Bozza' });
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [t.id] });
    const res = await api.patch(`/api/albums/${album.id}`, {
      title: 'Definitivo',
      artist: 'Band',
      year: 1999,
    });
    expect(res.json()).toMatchObject({ title: 'Definitivo', artist: 'Band', year: 1999 });
    expect((await track(t.id)).album).toBe('Definitivo');
  });

  test('errori di validazione e conflitti', async () => {
    await setup();
    const album = await createAlbum({ title: 'Demo' });
    expect((await api.post('/api/albums', { title: '  ' })).statusCode).toBe(400);
    expect((await api.post('/api/albums', { title: 'x'.repeat(201) })).statusCode).toBe(400);
    expect((await api.patch(`/api/albums/${album.id}`, { year: 999 })).statusCode).toBe(400);
    expect((await api.patch(`/api/albums/${album.id}`, { title: '' })).statusCode).toBe(400);
    expect(await getAlbum(album.id)).toMatchObject({ title: 'Demo' });
    expect((await api.post('/api/albums', { title: 'demo' })).statusCode).toBe(409);
    expect((await api.get('/api/albums/inesistente')).statusCode).toBe(404);
  });

  test('eliminazione: i brani restano in libreria, nelle playlist e nei preferiti, senza album', async () => {
    await setup();
    const t = await insertTrack(ctx);
    const album = await createAlbum({ title: 'Demo' });
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [t.id] });
    await api.put(`/api/me/favorites/${t.id}`);
    expect((await api.delete(`/api/albums/${album.id}`)).statusCode).toBe(204);
    expect(await track(t.id)).toMatchObject({ albumId: null, album: null, isFavorite: true });
    expect(await listAlbums()).toEqual([]);
  });
});

describe('copertina dell’album', () => {
  test('assegnata: i brani la mostrano, con il colore dell’album; rimossa: tornano alla propria', async () => {
    await setup();
    const t = await insertTrack(ctx);
    const album = await createAlbum({ title: 'Demo' });
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [t.id] });
    expect(await getAlbum(album.id)).toMatchObject({
      hasCustomCover: false,
      coverUrl: `/api/tracks/${t.id}/cover?size=512`,
    });

    const res = await putCover(album.id, await solidJpeg('#2040e0', 800, 400));
    expect(res.statusCode, res.body).toBe(200);
    const withCover = res.json() as AlbumDto;
    expect(withCover.hasCustomCover).toBe(true);
    expect(withCover.coverUrl).toBe(`/api/albums/${album.id}/cover?size=512&v=1`);
    const tr = await track(t.id);
    expect(tr.coverUrl).toBe(withCover.coverUrl);
    expect(tr.dominantColor).not.toBe('#c02020');

    const img = await api.get(withCover.coverUrl);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(await sharp(img.rawPayload).metadata()).toMatchObject({ width: 512, height: 512 });

    // Fuori dall'album il brano torna alla propria copertina.
    await api.delete(`/api/albums/${album.id}/tracks/${t.id}`);
    expect((await track(t.id)).coverUrl).toBe(`/api/tracks/${t.id}/cover?size=512`);
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [t.id] });

    const removed = (await api.delete(`/api/albums/${album.id}/cover`)).json() as AlbumDto;
    expect(removed.hasCustomCover).toBe(false);
    expect(await track(t.id)).toMatchObject({
      coverUrl: `/api/tracks/${t.id}/cover?size=512`,
      dominantColor: '#c02020',
    });
    expect(fs.existsSync(path.join(ctx.config.mediaDir, 'covers/albums', `${album.id}-512.jpg`))).toBe(false);
  });

  test('un PDF o un file non immagine viene rifiutato', async () => {
    await setup();
    const album = await createAlbum({ title: 'Demo' });
    const pdf = await putCover(album.id, Buffer.from('%PDF-1.4'), 'application/pdf');
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().error.code).toBe('INVALID_IMAGE');
    const fake = await putCover(album.id, Buffer.from('non sono un png'), 'image/png');
    expect(fake.json().error.code).toBe('INVALID_IMAGE');
    expect((await getAlbum(album.id)).hasCustomCover).toBe(false);
  });

  test('album vuoto senza copertina: segnaposto', async () => {
    await setup();
    const album = await createAlbum({ title: 'Vuoto' });
    const img = await api.get(album.coverUrl);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
  });
});

describe('generi', () => {
  test('grafia canonica: "hip-hop" diventa "Hip-Hop"', async () => {
    await setup();
    const a = await insertTrack(ctx);
    const b = await insertTrack(ctx);
    await api.put(`/api/tracks/${a.id}/genres`, { genres: ['Hip-Hop'] });
    const res = await api.put(`/api/tracks/${b.id}/genres`, { genres: ['hip-hop', 'Jazz'] });
    expect(res.json().genres).toEqual(['Hip-Hop', 'Jazz']);
    expect((await api.get('/api/genres')).json().items).toEqual([
      { name: 'Hip-Hop', trackCount: 2 },
      { name: 'Jazz', trackCount: 1 },
    ]);
    expect((await api.put(`/api/tracks/${a.id}/genres`, { genres: ['  '] })).statusCode).toBe(400);
  });

  test('genere su tutto l’album; i generi dell’album sono quelli comuni a tutti i brani', async () => {
    await setup();
    const album = await createAlbum({ title: 'In Utero', artist: 'Nirvana' });
    const ts = [];
    for (let i = 0; i < 3; i++) ts.push(await insertTrack(ctx));
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: ts.map((t) => t.id) });
    const res = await api.post(`/api/albums/${album.id}/genres`, { add: ['Rock'] });
    expect((res.json() as AlbumDto).genres).toEqual(['Rock']);
    for (const t of ts) expect((await track(t.id)).genres).toEqual(['Rock']);

    await api.put(`/api/tracks/${ts[0]!.id}/genres`, { genres: ['Rock', 'Acustico'] });
    expect((await getAlbum(album.id)).genres).toEqual(['Rock']);

    const detail = (await api.get('/api/genres/rock')).json() as GenreDetailDto;
    expect(detail).toMatchObject({ name: 'Rock', trackCount: 3 });
    expect(detail.albums.map((a) => a.title)).toEqual(['In Utero']);
    expect(((await api.get('/api/genres/Acustico')).json() as GenreDetailDto).albums).toEqual([]);

    await api.post(`/api/albums/${album.id}/genres`, { remove: ['rock'] });
    expect((await track(ts[1]!.id)).genres).toEqual([]);
  });

  test('un genere non più usato sparisce', async () => {
    await setup();
    const t = await insertTrack(ctx);
    await api.put(`/api/tracks/${t.id}/genres`, { genres: ['Swing'] });
    await api.put(`/api/tracks/${t.id}/genres`, { genres: [] });
    expect((await api.get('/api/genres')).json().items).toEqual([]);
    expect((await api.get('/api/genres/Swing')).statusCode).toBe(404);
  });
});

describe('ricerca locale', () => {
  test('album per prefisso e brani per genere', async () => {
    await setup();
    await createAlbum({ title: 'Nevermind', artist: 'Nirvana' });
    const t = await insertTrack(ctx, { title: 'Alison', artist: 'Slowdive' });
    await api.put(`/api/tracks/${t.id}/genres`, { genres: ['Shoegaze'] });
    expect((await listAlbums('?q=nevermi')).map((a) => a.title)).toEqual(['Nevermind']);
    const hits = (await api.get('/api/tracks?q=shoeg')).json().items as TrackDto[];
    expect(hits.map((h) => h.id)).toEqual([t.id]);
  });
});

describe('tag dei file', () => {
  test('album, artista dell’album, numero di traccia e generi riscritti nel file', async () => {
    await setup();
    const album = await createAlbum({ title: 'Demo 2026', artist: 'Band' });
    const first = await insertTrack(ctx);
    const second = await insertTrack(ctx);
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [first.id] });
    await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [second.id] });
    await api.put(`/api/tracks/${second.id}/genres`, { genres: ['Indie', 'Rock'] });
    await ctx.app.catalog.tagWriter.idle();
    const tags = await readTags(second.audioFile);
    expect(tags).toMatchObject({
      album: 'Demo 2026',
      performerInfo: 'Band',
      trackNumber: '2/2',
      genre: 'Indie; Rock',
    });
    expect((await track(second.id)).sizeBytes).toBe(fs.statSync(second.audioFile).size);
  });

  test('un errore di scrittura non annulla la modifica nel catalogo', async () => {
    await setup();
    const t = await insertTrack(ctx);
    fs.rmSync(t.audioFile);
    const album = await createAlbum({ title: 'Demo' });
    const res = await api.post(`/api/albums/${album.id}/tracks`, { trackIds: [t.id] });
    expect(res.statusCode).toBe(200);
    await ctx.app.catalog.tagWriter.idle();
    expect((await track(t.id)).albumId).toBe(album.id);
  });
});

// ---------- ricerca online ----------

const MB = (title: string, artist: string, id = '1b022e01-4da6-387b-8658-8678046e4cef') => ({
  'release-groups': [
    {
      id,
      score: 100,
      title,
      'first-release-date': '1997-05-21',
      'artist-credit': [{ name: artist }],
      tags: [{ count: 5, name: 'art rock' }],
    },
  ],
});

interface FakeServices {
  mb?: () => Response | Promise<Response>;
  itunes?: () => Response | Promise<Response>;
  image?: () => Response | Promise<Response>;
}
async function fakeLookupFetch(s: FakeServices) {
  const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#10a040' } })
    .png()
    .toBuffer();
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('https://musicbrainz.org/')) {
      if (!s.mb) throw new TypeError('fetch failed');
      return s.mb();
    }
    if (url.startsWith('https://itunes.apple.com/')) {
      if (!s.itunes) throw new TypeError('fetch failed');
      return s.itunes();
    }
    if (url.startsWith('https://coverartarchive.org/'))
      return s.image ? s.image() : new Response(png, { headers: { 'content-type': 'image/png' } });
    throw new TypeError(`fetch failed: ${url}`);
  });
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('impostazioni della ricerca online', () => {
  test('valgono per tutti gli account; spenta: le rotte di ricerca rispondono 409', async () => {
    await setup();
    expect((await api.get('/api/settings')).json()).toEqual({ coverLookup: true, coverLookupLocked: false });
    expect((await api.patch('/api/settings', { coverLookup: false })).json().coverLookup).toBe(false);
    await createUser(ctx, 'anna');
    const anna = apiClient(ctx, await login(ctx, 'anna'));
    expect((await anna.get('/api/settings')).json().coverLookup).toBe(false);
    const res = await api.get('/api/lookup/albums?album=Nevermind');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LOOKUP_DISABLED');
    expect(
      (await api.get(`/api/lookup/image?url=${encodeURIComponent('https://coverartarchive.org/x')}`))
        .statusCode,
    ).toBe(409);
  });

  test('COVER_LOOKUP=off la forza spenta', async () => {
    await setup({ env: { COVER_LOOKUP: 'off' } });
    expect((await api.get('/api/settings')).json()).toEqual({ coverLookup: false, coverLookupLocked: true });
    expect((await api.patch('/api/settings', { coverLookup: true })).statusCode).toBe(409);
    expect((await api.get('/api/health')).json().features).not.toContain('cover-lookup');
  });
});

describe('ricerca online', () => {
  test('candidati, proxy dell’immagine e applicazione della sola copertina', async () => {
    const fetch = await fakeLookupFetch({ mb: () => json(MB('OK Computer', 'Radiohead')) });
    await setup({ buildOptions: { lookupFetch: fetch } });
    const album = await createAlbum({ title: 'Ok computer', artist: 'Radiohead', year: 2000 });
    await ctx.app.catalog.lookup.idle();

    const res = await api.get('/api/lookup/albums?album=OK%20Computer&artist=Radiohead');
    expect(res.statusCode, res.body).toBe(200);
    const [candidate] = res.json().items;
    expect(candidate).toMatchObject({ title: 'OK Computer', year: 1997, genres: ['art rock'] });

    const img = await api.get(`/api/lookup/image?url=${encodeURIComponent(candidate.thumbUrl)}`);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    // L'album era già stato completato in automatico: si prova l'applicazione manuale.
    await api.delete(`/api/albums/${album.id}/cover`);
    const applied = await api.post(`/api/albums/${album.id}/apply-candidate`, { candidate, fields: {} });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({
      hasCustomCover: true,
      title: 'Ok computer',
      year: 2000,
      genres: [],
    });

    const all = await api.post(`/api/albums/${album.id}/apply-candidate`, {
      candidate,
      fields: { title: true, year: true, genres: true },
    });
    expect(all.json()).toMatchObject({ title: 'OK Computer', year: 1997 });
  });

  test('host non consentito ed errori di rete', async () => {
    const fetch = await fakeLookupFetch({});
    await setup({ buildOptions: { lookupFetch: fetch } });
    const bad = await api.get(
      `/api/lookup/image?url=${encodeURIComponent('https://169.254.169.254/latest')}`,
    );
    expect(bad.statusCode).toBe(400);
    const down = await api.get('/api/lookup/albums?album=Nevermind');
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toMatchObject({ code: 'LOOKUP_UNAVAILABLE' });
    expect(fetch.mock.calls.some(([u]) => String(u).includes('169.254'))).toBe(false);
  });
});

describe('ricerca automatica', () => {
  test('corrispondenza sicura: copertina applicata senza intervento', async () => {
    const fetch = await fakeLookupFetch({ mb: () => json(MB('OK Computer', 'Radiohead')) });
    await setup({ buildOptions: { lookupFetch: fetch } });
    const t = await insertTrack(ctx, { artist: 'Radiohead' });
    albums().assignByMetadata(t.id, 'OK Computer', 'Radiohead');
    await ctx.app.catalog.lookup.idle();
    const [album] = await listAlbums();
    expect(album).toMatchObject({ hasCustomCover: true });
    // Solo la copertina: anno e generi restano quelli dell'utente.
    expect(await getAlbum(album!.id)).toMatchObject({ year: null, genres: [] });
  });

  test('nessuna corrispondenza sicura: album invariato e mai più cercato in automatico', async () => {
    const fetch = await fakeLookupFetch({
      mb: () => json(MB('Demo', 'Band del garage')),
      itunes: () => json({ results: [] }),
    });
    await setup({ buildOptions: { lookupFetch: fetch } });
    await createAlbum({ title: 'Demo 2026', artist: 'Band del garage' });
    await ctx.app.catalog.lookup.idle();
    const calls = fetch.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect((await listAlbums())[0]).toMatchObject({ hasCustomCover: false });
    ctx.app.catalog.lookup.kick();
    await ctx.app.catalog.lookup.idle();
    expect(fetch.mock.calls.length).toBe(calls);
  });

  test('servizi irraggiungibili: si ferma dopo 3 errori e riprende al riavvio', async () => {
    const fetch = await fakeLookupFetch({});
    await setup({ buildOptions: { lookupFetch: fetch } });
    for (const title of ['A', 'B', 'C', 'D']) await createAlbum({ title });
    await ctx.app.catalog.lookup.idle();
    const pending = () =>
      (
        ctx.database.sqlite
          .prepare("SELECT count(*) AS n FROM albums WHERE lookup_status = 'pending'")
          .get() as {
          n: number;
        }
      ).n;
    expect(pending()).toBe(4);
    const calls = fetch.mock.calls.length;
    expect((await api.get('/api/albums')).statusCode).toBe(200);
    // Al riavvio la ricerca riprende.
    ctx.app.catalog.lookup.start();
    await ctx.app.catalog.lookup.idle();
    expect(fetch.mock.calls.length).toBeGreaterThan(calls);
  });

  test('ricerca spenta: nessuna richiesta in uscita', async () => {
    const fetch = await fakeLookupFetch({ mb: () => json(MB('OK Computer', 'Radiohead')) });
    await setup({ buildOptions: { lookupFetch: fetch } });
    await api.patch('/api/settings', { coverLookup: false });
    await createAlbum({ title: 'OK Computer', artist: 'Radiohead' });
    await ctx.app.catalog.lookup.idle();
    expect(fetch).not.toHaveBeenCalled();
  });
});
