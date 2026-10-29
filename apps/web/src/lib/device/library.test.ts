import { openSpookyfyDb } from '../offline/db';
import { DEVICE_AUDIO_CACHE, DeviceLibrary, localAudioUrl } from './library';

let n = 0;
async function makeLibrary() {
  const db = await openSpookyfyDb(`spk-lib-${Date.now()}-${++n}`);
  let t = 1_000;
  const lib = new DeviceLibrary({ db: async () => db, now: () => ++t });
  await lib.ready();
  return { lib, db };
}

const blob = (n: number, type = 'audio/mp4') => new Blob([new Uint8Array(n)], { type });

async function add(
  lib: DeviceLibrary,
  o: { title: string; artist?: string; album?: string | null; key?: string; size?: number },
) {
  return lib.addTrack({
    record: {
      sourceKey: o.key ?? `youtube:${o.title.slice(0, 11).padEnd(11, 'x')}`,
      title: o.title,
      artist: o.artist ?? 'Artista',
      album: o.album ?? null,
      durationMs: 180_000,
      sizeBytes: o.size ?? 100,
      mimeType: 'audio/mp4',
      dominantColor: '#c02020',
    },
    audio: blob(o.size ?? 100),
    cover512: blob(10, 'image/jpeg'),
    cover128: blob(5, 'image/jpeg'),
  });
}

describe('catalogo sul dispositivo', () => {
  test('120 brani, pagine da 50 per data di aggiunta decrescente', async () => {
    const { lib } = await makeLibrary();
    for (let i = 0; i < 120; i++) await add(lib, { title: `T${i}`, key: `file:${i}` });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await lib.list({ limit: 50, cursor });
      if (pages === 0) {
        expect(page.items).toHaveLength(50);
        expect(page.items[0]!.title).toBe('T119');
      }
      seen.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(120);
  });

  test('ricerca per prefisso senza maiuscole e accenti; ordinamenti', async () => {
    const { lib } = await makeLibrary();
    await add(lib, { title: 'Come As You Are', artist: 'Nirvana', key: 'file:a' });
    await add(lib, { title: 'Jóga', artist: 'Björk', key: 'file:b' });
    await add(lib, { title: 'altro', artist: 'Zed', key: 'file:c' });
    expect((await lib.list({ q: 'nirv' })).items.map((t) => t.artist)).toEqual(['Nirvana']);
    expect((await lib.list({ q: 'BJORK jog' })).items.map((t) => t.title)).toEqual(['Jóga']);
    expect((await lib.list({ q: 'zzz' })).items).toEqual([]);
    expect((await lib.list({ sort: 'title' })).items.map((t) => t.title)).toEqual([
      'altro',
      'Come As You Are',
      'Jóga',
    ]);
    expect((await lib.list({ sort: 'artist' })).items.map((t) => t.artist)).toEqual([
      'Björk',
      'Nirvana',
      'Zed',
    ]);
  });

  test('URL locali e dati del brano', async () => {
    const { lib } = await makeLibrary();
    const t = await add(lib, { title: 'Song', key: 'youtube:abcdefghijk' });
    expect(t).toMatchObject({
      sourceId: 'abcdefghijk',
      audioUrl: `/local/audio/${t.id}`,
      coverUrl: `/local/cover/${t.id}?size=512`,
      coverThumbUrl: `/local/cover/${t.id}?size=128`,
      isFavorite: false,
    });
    expect(lib.isLocal(t.id)).toBe(true);
  });

  test('modifica ed eliminazione: lo spazio occupato diminuisce e i riferimenti spariscono', async () => {
    const { lib } = await makeLibrary();
    const a = await add(lib, { title: 'A', key: 'file:a', size: 300 });
    const b = await add(lib, { title: 'B', key: 'file:b', size: 200 });
    const p = await lib.createPlaylist('Notte');
    await lib.addItem(p.id, a.id);
    await lib.addItem(p.id, b.id);
    await lib.setFavorite(a.id, true);
    expect(lib.usage()).toEqual({ count: 2, bytes: 500 });

    expect((await lib.updateTrack(a.id, { title: 'A (Live)', album: 'Disco' })).title).toBe('A (Live)');
    await expect(lib.updateTrack(a.id, { title: '  ' })).rejects.toMatchObject({ status: 400 });

    await lib.deleteTrack(a.id);
    expect(lib.usage()).toEqual({ count: 1, bytes: 200 });
    expect((await lib.getPlaylist(p.id)).items.map((i) => i.track.title)).toEqual(['B']);
    expect(await lib.listFavorites()).toEqual([]);
    const cache = await caches.open(DEVICE_AUDIO_CACHE);
    expect(await cache.match(new URL(localAudioUrl(a.id), location.href).href)).toBeUndefined();
    await expect(lib.get(a.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('preferiti, playlist e ascolti', () => {
  test('preferiti dal più recente', async () => {
    const { lib } = await makeLibrary();
    const a = await add(lib, { title: 'A', key: 'file:a' });
    const b = await add(lib, { title: 'B', key: 'file:b' });
    await lib.setFavorite(a.id, true);
    await lib.setFavorite(b.id, true);
    await lib.setFavorite(b.id, true);
    expect((await lib.listFavorites()).map((f) => f.track.title)).toEqual(['B', 'A']);
    expect((await lib.get(a.id)).isFavorite).toBe(true);
  });

  test('playlist: duplicati, riordino ripetuto e nome 1–100', async () => {
    const { lib } = await makeLibrary();
    const tracks = [
      await add(lib, { title: 'A', key: 'file:a' }),
      await add(lib, { title: 'B', key: 'file:b' }),
      await add(lib, { title: 'C', key: 'file:c' }),
    ];
    const p = await lib.createPlaylist('  Notte  ');
    expect(p.name).toBe('Notte');
    for (const t of [...tracks, tracks[0]!]) await lib.addItem(p.id, t.id);
    let full = await lib.getPlaylist(p.id);
    expect(full.items.map((i) => i.track.title)).toEqual(['A', 'B', 'C', 'A']);
    full = await lib.moveItem(p.id, full.items[3]!.itemId, 0);
    expect(full.items.map((i) => i.track.title)).toEqual(['A', 'A', 'B', 'C']);
    for (let i = 0; i < 80; i++) full = await lib.moveItem(p.id, full.items[3]!.itemId, 1);
    expect(full.items).toHaveLength(4);
    await expect(lib.createPlaylist('')).rejects.toMatchObject({ status: 400 });
    await expect(lib.createPlaylist('x'.repeat(101))).rejects.toMatchObject({ status: 400 });
    await expect(lib.renamePlaylist(p.id, ' ')).rejects.toMatchObject({ status: 400 });
    expect((await lib.renamePlaylist(p.id, 'Giorno')).name).toBe('Giorno');
  });

  test('riordino offline salvato e mantenuto alla riapertura', async () => {
    const { lib, db } = await makeLibrary();
    const [a, b] = [
      await add(lib, { title: 'A', key: 'file:a' }),
      await add(lib, { title: 'B', key: 'file:b' }),
    ];
    const p = await lib.createPlaylist('Viaggio');
    await lib.addItem(p.id, a.id);
    const item = await lib.addItem(p.id, b.id);
    await lib.moveItem(p.id, item.itemId, 0);
    const reopened = new DeviceLibrary({ db: async () => db });
    expect((await reopened.getPlaylist(p.id)).items.map((i) => i.track.title)).toEqual(['B', 'A']);
  });

  test('ascolti idempotenti e ascoltati di recente A, B, A → A, B', async () => {
    const { lib } = await makeLibrary();
    const a = await add(lib, { title: 'A', key: 'file:a' });
    const b = await add(lib, { title: 'B', key: 'file:b' });
    const plays = [
      { id: '1', trackId: a.id, playedAt: 10 },
      { id: '2', trackId: b.id, playedAt: 20 },
      { id: '3', trackId: a.id, playedAt: 30 },
    ];
    expect(await lib.submitPlays(plays)).toEqual({ recorded: 3, ignored: 0 });
    expect(await lib.submitPlays(plays)).toEqual({ recorded: 0, ignored: 3 });
    expect((await lib.recent(10)).map((t) => t.title)).toEqual(['A', 'B']);
    expect((await lib.get(a.id)).playCount).toBe(2);
  });
});

describe('eliminazione da parte del sistema', () => {
  test('i brani senza file diventano persi, non riproducibili, e restano in libreria', async () => {
    const { lib } = await makeLibrary();
    const a = await add(lib, { title: 'A', key: 'youtube:aaaaaaaaaaa' });
    const b = await add(lib, { title: 'B', key: 'file:b' });
    const changed = vi.fn();
    lib.onChange = changed;
    await (await caches.open(DEVICE_AUDIO_CACHE)).delete(new URL(localAudioUrl(a.id), location.href).href);
    expect(await lib.reconcile()).toEqual([a.id]);
    expect(lib.isLocal(a.id)).toBe(false);
    expect(lib.isLocal(b.id)).toBe(true);
    expect(lib.lostTracks().map((t) => t.id)).toEqual([a.id]);
    expect(changed).toHaveBeenCalled();
    expect(await lib.reconcile()).toEqual([]); // già noto
    await lib.restoreFiles(a.id, {
      audio: blob(50),
      cover512: blob(1),
      cover128: blob(1),
      sizeBytes: 50,
      mimeType: 'audio/mp4',
    });
    expect(lib.isLocal(a.id)).toBe(true);
  });
});

describe('auto-trim del silenzio', () => {
  async function makeAnalyzed(
    analyze: (b: Blob) => Promise<{ trimStartMs?: number; trimEndMs?: number } | null>,
  ) {
    const db = await openSpookyfyDb(`spk-lib-trim-${Date.now()}-${++n}`);
    let t = 1_000;
    const lib = new DeviceLibrary({ db: async () => db, now: () => ++t, analyzeSilence: analyze });
    await lib.ready();
    return { lib, db };
  }

  test('all’aggiunta il brano riceve i punti di trim, che restano dopo la riapertura', async () => {
    const analyze = vi.fn(async () => ({ trimStartMs: 6750, trimEndMs: 170_250 }));
    const { lib, db } = await makeAnalyzed(analyze);
    const dto = await add(lib, { title: 'Con silenzio', size: 321 });
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ size: 321 }));
    expect(dto).toMatchObject({ trimStartMs: 6750, trimEndMs: 170_250 });
    const reopened = new DeviceLibrary({ db: async () => db, analyzeSilence: analyze });
    expect((await reopened.list({})).items[0]).toMatchObject({ trimStartMs: 6750, trimEndMs: 170_250 });
  });

  test('analisi non riuscita: il brano si aggiunge intero e viene ripreso in background', async () => {
    let result: { trimStartMs?: number } | null = null;
    const { lib } = await makeAnalyzed(async () => result);
    const dto = await add(lib, { title: 'Da analizzare' });
    expect(dto).not.toHaveProperty('trimStartMs');
    result = { trimStartMs: 8000 };
    expect(await lib.analyzeSilenceBacklog()).toBe(1);
    expect(lib.toDto(lib.record(dto.id)!)).toMatchObject({ trimStartMs: 8000 });
    expect(await lib.analyzeSilenceBacklog()).toBe(0);
  });

  test('un brano già analizzato (es. da backup) non si rianalizza', async () => {
    const analyze = vi.fn(async () => ({}));
    const { lib } = await makeAnalyzed(analyze);
    const dto = await lib.addTrack({
      record: {
        sourceKey: 'file:abc',
        title: 'Dal backup',
        artist: 'A',
        album: null,
        durationMs: 180_000,
        trimEndMs: 150_000,
        silenceChecked: true,
        sizeBytes: 10,
        mimeType: 'audio/mpeg',
        dominantColor: '#c02020',
      },
      audio: blob(10),
      cover512: blob(1),
      cover128: blob(1),
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(dto.trimEndMs).toBe(150_000);
  });

  test('il backlog legge l’audio dal dispositivo e si ferma dopo 3 fallimenti di fila', async () => {
    const analyze = vi.fn(async () => null);
    const { lib } = await makeAnalyzed(analyze);
    for (let i = 0; i < 5; i++) await add(lib, { title: `T${i}`, key: `file:${i}` });
    analyze.mockClear();
    expect(await lib.analyzeSilenceBacklog()).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(3);
  });
});
