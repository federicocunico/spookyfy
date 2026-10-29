import { ApiError } from '../api';
import { openSpookyfyDb } from '../offline/db';
import type { CoverProcessor } from './cover';
import { DEVICE_COVER_CACHE, DeviceLibrary, localAlbumCoverUrl } from './library';

let n = 0;
const processCover: CoverProcessor = async (source) => ({
  large: new Blob([new Uint8Array(512)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(128)], { type: 'image/jpeg' }),
  dominantColor: source ? '#2040e0' : '#b69cff',
});

async function makeLibrary() {
  const db = await openSpookyfyDb(`spk-cat-${Date.now()}-${++n}`);
  let t = 1_000;
  const lib = new DeviceLibrary({ db: async () => db, now: () => ++t, processCover });
  await lib.ready();
  return { lib, db };
}

const blob = (size: number, type = 'audio/mp4') => new Blob([new Uint8Array(size)], { type });

async function add(
  lib: DeviceLibrary,
  title: string,
  o: {
    artist?: string;
    album?: string | null;
    albumArtist?: string;
    trackNo?: number;
    genres?: string[];
  } = {},
) {
  return lib.addTrack({
    record: {
      sourceKey: `file:${title}`,
      title,
      artist: o.artist ?? 'Artista',
      album: o.album ?? null,
      genres: o.genres,
      durationMs: 2000,
      sizeBytes: 100,
      mimeType: 'audio/mp4',
      dominantColor: '#c02020',
    },
    audio: blob(100),
    cover512: blob(10, 'image/jpeg'),
    cover128: blob(5, 'image/jpeg'),
    albumArtist: o.albumArtist,
    trackNo: o.trackNo,
  });
}

const titles = (a: { tracks: { title: string }[] }) => a.tracks.map((t) => t.title);

describe('album sul dispositivo', () => {
  test('raggruppamento all’importazione: un album per disco, ordine del numero di traccia', async () => {
    const { lib } = await makeLibrary();
    await add(lib, 'Due', { artist: 'Nirvana', album: 'In Utero', trackNo: 2 });
    await add(lib, 'Uno', { artist: 'Nirvana', album: 'in utero', trackNo: 1 });
    const solo = await add(lib, 'Sciolto');
    const albums = await lib.listAlbums();
    expect(albums).toEqual([
      expect.objectContaining({ title: 'In Utero', artist: 'Nirvana', trackCount: 2 }),
    ]);
    expect(titles(await lib.getAlbum(albums[0]!.id))).toEqual(['Uno', 'Due']);
    expect(solo.albumId).toBeNull();
  });

  test('l’artista dell’album dai tag prevale su quello del brano', async () => {
    const { lib } = await makeLibrary();
    await add(lib, 'A', { artist: 'Ospite', album: 'Raccolta', albumArtist: 'Artisti vari' });
    await add(lib, 'B', { artist: 'Altro', album: 'Raccolta', albumArtist: 'Artisti vari' });
    expect(await lib.listAlbums()).toEqual([
      expect.objectContaining({ artist: 'Artisti vari', trackCount: 2 }),
    ]);
  });

  test('campo album del brano: sposta nell’album corrispondente; vuoto lo toglie', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'Brano', { artist: 'Nirvana', album: 'Nevermind (Remastered)' });
    const moved = await lib.updateTrack(t.id, { album: 'Nevermind' });
    const albums = await lib.listAlbums();
    expect(albums.map((a) => a.title)).toEqual(['Nevermind']);
    expect(moved).toMatchObject({ album: 'Nevermind', albumId: albums[0]!.id });
    expect(await lib.updateTrack(t.id, { album: '' })).toMatchObject({ album: null, albumId: null });
    expect(await lib.listAlbums()).toEqual([]);
  });

  test('creazione manuale, aggiunta, riordino, rimozione', async () => {
    const { lib } = await makeLibrary();
    const ts = [await add(lib, 'A'), await add(lib, 'B'), await add(lib, 'C')];
    const album = await lib.createAlbum({ title: 'Demo 2026', year: 2026 });
    expect(album).toMatchObject({ artist: 'Artisti vari', year: 2026, origin: 'manual', trackCount: 0 });
    for (const t of ts) await lib.addAlbumTracks(album.id, [t.id]);
    expect(titles(await lib.getAlbum(album.id))).toEqual(['A', 'B', 'C']);
    expect(titles(await lib.moveAlbumTrack(album.id, ts[2]!.id, 0))).toEqual(['C', 'A', 'B']);
    expect(titles((await lib.removeAlbumTrack(album.id, ts[0]!.id))!)).toEqual(['C', 'B']);
    // Un brano sta in un solo album.
    const other = await lib.createAlbum({ title: 'Altro' });
    await lib.addAlbumTracks(other.id, [ts[1]!.id]);
    expect(titles(await lib.getAlbum(album.id))).toEqual(['C']);
  });

  test('errori di validazione e conflitti', async () => {
    const { lib } = await makeLibrary();
    const album = await lib.createAlbum({ title: 'Demo' });
    await expect(lib.createAlbum({ title: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(lib.createAlbum({ title: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
    await expect(lib.updateAlbum(album.id, { year: 999 })).rejects.toMatchObject({ status: 400 });
    await expect(lib.createAlbum({ title: 'DEMO' })).rejects.toMatchObject({ status: 409 });
    await expect(lib.getAlbum('nessuno')).rejects.toBeInstanceOf(ApiError);
    expect((await lib.getAlbum(album.id)).title).toBe('Demo');
  });

  test('modifica: titolo, artista, anno; il campo album dei brani segue', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'Brano');
    const album = await lib.createAlbum({ title: 'Bozza' });
    await lib.addAlbumTracks(album.id, [t.id]);
    expect(
      await lib.updateAlbum(album.id, { title: 'Definitivo', artist: 'Band', year: 1999 }),
    ).toMatchObject({
      title: 'Definitivo',
      artist: 'Band',
      year: 1999,
    });
    expect((await lib.get(t.id)).album).toBe('Definitivo');
  });

  test('eliminazione: i brani restano, senza album; album automatico svuotato sparisce', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'Brano');
    const album = await lib.createAlbum({ title: 'Demo' });
    await lib.addAlbumTracks(album.id, [t.id]);
    await lib.setFavorite(t.id, true);
    await lib.deleteAlbum(album.id);
    expect(await lib.get(t.id)).toMatchObject({ albumId: null, album: null, isFavorite: true });

    const auto = await add(lib, 'Auto', { album: 'Sparisce' });
    expect(await lib.listAlbums()).toHaveLength(1);
    await lib.deleteTrack(auto.id);
    expect(await lib.listAlbums()).toEqual([]);
  });

  test('ordinamento e ricerca degli album', async () => {
    const { lib } = await makeLibrary();
    await lib.createAlbum({ title: 'Zeta', artist: 'Alfa' });
    await lib.createAlbum({ title: 'Nevermind', artist: 'Nirvana' });
    expect((await lib.listAlbums('added')).map((a) => a.title)).toEqual(['Nevermind', 'Zeta']);
    expect((await lib.listAlbums('title')).map((a) => a.title)).toEqual(['Nevermind', 'Zeta']);
    expect((await lib.listAlbums('artist')).map((a) => a.title)).toEqual(['Zeta', 'Nevermind']);
    expect((await lib.listAlbums('added', 'nevermi')).map((a) => a.title)).toEqual(['Nevermind']);
  });
});

describe('copertina dell’album sul dispositivo', () => {
  test('assegnata: i brani la mostrano con il colore dell’album; tolto dall’album il brano torna alla propria', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'Brano');
    const album = await lib.createAlbum({ title: 'Demo' });
    await lib.addAlbumTracks(album.id, [t.id]);
    expect((await lib.getAlbum(album.id)).coverUrl).toBe(`/local/cover/${t.id}?size=512`);

    const withCover = await lib.setAlbumCover(album.id, blob(1000, 'image/png'));
    expect(withCover).toMatchObject({ hasCustomCover: true, coverUrl: localAlbumCoverUrl(album.id, 512, 1) });
    expect(await lib.get(t.id)).toMatchObject({ coverUrl: withCover.coverUrl, dominantColor: '#2040e0' });
    const cache = await caches.open(DEVICE_COVER_CACHE);
    expect(await cache.match(new URL(withCover.coverUrl, location.href).href)).toBeTruthy();

    await lib.removeAlbumTrack(album.id, t.id);
    expect(await lib.get(t.id)).toMatchObject({
      coverUrl: `/local/cover/${t.id}?size=512`,
      dominantColor: '#c02020',
    });
  });

  test('rimozione della copertina: file eliminati, brani alla propria copertina', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'Brano', { album: 'Demo' });
    const [album] = await lib.listAlbums();
    const first = await lib.setAlbumCover(album!.id, blob(1000, 'image/jpeg'));
    const second = await lib.setAlbumCover(album!.id, blob(1000, 'image/jpeg'));
    expect(second.coverUrl).not.toBe(first.coverUrl);
    const cache = await caches.open(DEVICE_COVER_CACHE);
    expect(await cache.match(new URL(first.coverUrl, location.href).href)).toBeUndefined();

    const removed = await lib.removeAlbumCover(album!.id);
    expect(removed.hasCustomCover).toBe(false);
    expect((await lib.get(t.id)).coverUrl).toBe(`/local/cover/${t.id}?size=512`);
    expect(await cache.match(new URL(second.coverUrl, location.href).href)).toBeUndefined();
  });

  test('un PDF o un’immagine troppo grande vengono rifiutati', async () => {
    const { lib } = await makeLibrary();
    const album = await lib.createAlbum({ title: 'Demo' });
    await expect(lib.setAlbumCover(album.id, blob(10, 'application/pdf'))).rejects.toMatchObject({
      code: 'INVALID_IMAGE',
    });
    await expect(lib.setAlbumCover(album.id, blob(10 * 1024 * 1024 + 1, 'image/jpeg'))).rejects.toMatchObject(
      {
        code: 'INVALID_IMAGE',
      },
    );
    expect((await lib.getAlbum(album.id)).hasCustomCover).toBe(false);
  });
});

describe('generi sul dispositivo', () => {
  test('grafia canonica e conteggi', async () => {
    const { lib } = await makeLibrary();
    const a = await add(lib, 'A');
    const b = await add(lib, 'B');
    await lib.setTrackGenres(a.id, ['Hip-Hop']);
    expect((await lib.setTrackGenres(b.id, ['hip-hop', 'Jazz'])).genres).toEqual(['Hip-Hop', 'Jazz']);
    expect(await lib.listGenres()).toEqual([
      { name: 'Hip-Hop', trackCount: 2 },
      { name: 'Jazz', trackCount: 1 },
    ]);
    await expect(lib.setTrackGenres(a.id, ['  '])).rejects.toMatchObject({ status: 400 });
  });

  test('generi dai tag all’importazione', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'A', { genres: ['Alternative', 'Indie'] });
    expect(t.genres).toEqual(['Alternative', 'Indie']);
  });

  test('genere su tutto l’album; generi comuni; pagina del genere', async () => {
    const { lib } = await makeLibrary();
    const album = await lib.createAlbum({ title: 'In Utero', artist: 'Nirvana' });
    const ts = [await add(lib, 'A'), await add(lib, 'B'), await add(lib, 'C')];
    await lib.addAlbumTracks(
      album.id,
      ts.map((t) => t.id),
    );
    expect((await lib.updateAlbumGenres(album.id, ['Rock'])).genres).toEqual(['Rock']);
    for (const t of ts) expect((await lib.get(t.id)).genres).toEqual(['Rock']);
    await lib.setTrackGenres(ts[0]!.id, ['Rock', 'Acustico']);
    expect((await lib.getAlbum(album.id)).genres).toEqual(['Rock']);

    const rock = await lib.getGenre('rock');
    expect(rock).toMatchObject({ name: 'Rock', trackCount: 3 });
    expect(rock.albums.map((a) => a.title)).toEqual(['In Utero']);
    expect((await lib.getGenre('Acustico')).albums).toEqual([]);

    await lib.updateAlbumGenres(album.id, [], ['ROCK']);
    expect((await lib.get(ts[1]!.id)).genres).toEqual([]);
  });

  test('un genere non più usato sparisce', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'A', { genres: ['Swing'] });
    await lib.setTrackGenres(t.id, []);
    expect(await lib.listGenres()).toEqual([]);
    await expect(lib.getGenre('Swing')).rejects.toMatchObject({ status: 404 });
  });

  test('ricerca: brani per genere', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, 'Alison', { artist: 'Slowdive', genres: ['Shoegaze'] });
    await add(lib, 'Altro');
    expect((await lib.list({ q: 'shoeg' })).items.map((i) => i.id)).toEqual([t.id]);
  });
});
