import { type IDBPDatabase, openDB } from 'idb';
import { DB_VERSION, MIGRATIONS, clearPersonalData, getMeta, openSpookyfyDb, setMeta } from './db';

let n = 0;
const uniqueName = () => `spk-test-${Date.now()}-${n++}`;

test('apertura su un database nuovo: tutti gli store e gli indici', async () => {
  const db = await openSpookyfyDb(uniqueName());
  expect(db.version).toBe(DB_VERSION);
  expect([...db.objectStoreNames].sort()).toEqual(
    [
      'downloadQueue',
      'downloads',
      'meta',
      'pendingPlays',
      'playlists',
      'tracks',
      'libTracks',
      'libFavorites',
      'libPlaylists',
      'libPlaylistItems',
      'libPlays',
      'imports',
      'settings',
      'libAlbums',
      'hybridPlaylists',
      'hybridItems',
      'hybridLinks',
    ].sort(),
  );
  expect([...db.transaction('downloadQueue').store.indexNames]).toEqual(['byEnqueued']);
  db.close();
});

test('riapertura: i dati restano', async () => {
  const name = uniqueName();
  const db = await openSpookyfyDb(name);
  await db.put('downloads', { trackId: 't1', sizeBytes: 10, downloadedAt: 1 });
  db.close();
  const again = await openSpookyfyDb(name);
  expect(await again.get('downloads', 't1')).toEqual({ trackId: 't1', sizeBytes: 10, downloadedAt: 1 });
  again.close();
});

test('migrazione: dall’ultima versione a una successiva i dati restano e la nuova migrazione viene applicata', async () => {
  const name = uniqueName();
  const v1 = await openSpookyfyDb(name, DB_VERSION);
  await v1.put('downloads', { trackId: 't1', sizeBytes: 10, downloadedAt: 1 });
  v1.close();

  // Migrazione di prova registrata solo per questo test.
  const next = DB_VERSION + 1;
  MIGRATIONS[next] = (db) => {
    (db as unknown as IDBPDatabase).createObjectStore('futuro');
  };
  try {
    const v2 = await openSpookyfyDb(name, next);
    expect(v2.version).toBe(next);
    expect(v2.objectStoreNames.contains('futuro' as never)).toBe(true);
    expect(await v2.get('downloads', 't1')).toMatchObject({ trackId: 't1' });
    v2.close();
  } finally {
    delete MIGRATIONS[next];
  }
});

test('un database a una versione intermedia viene portato all’ultima', async () => {
  const name = uniqueName();
  // Database creato "a mano" alla v1 da un client precedente (stesso schema).
  const legacy = await openDB(name, 1, {
    upgrade: (db, _o, _n, tx) => MIGRATIONS[1]!(db as never, tx as never),
  });
  legacy.close();
  const db = await openSpookyfyDb(name);
  expect(db.version).toBe(DB_VERSION);
  expect(db.objectStoreNames.contains('pendingPlays')).toBe(true);
  db.close();
});

test('migrazione v1 → v2: i dati esistenti restano e compaiono gli store della libreria sul dispositivo', async () => {
  const name = uniqueName();
  const v1 = await openSpookyfyDb(name, 1);
  await v1.put('downloads', { trackId: 't1', sizeBytes: 10, downloadedAt: 1 });
  await v1.put('pendingPlays', { id: 'p1', trackId: 't1', playedAt: 5 });
  v1.close();
  const v2 = await openSpookyfyDb(name, 2);
  expect(await v2.get('downloads', 't1')).toMatchObject({ sizeBytes: 10 });
  expect(await v2.get('pendingPlays', 'p1')).toMatchObject({ playedAt: 5 });
  for (const store of [
    'libTracks',
    'libFavorites',
    'libPlaylists',
    'libPlaylistItems',
    'libPlays',
    'imports',
    'settings',
  ]) {
    expect(v2.objectStoreNames.contains(store as never)).toBe(true);
  }
  await v2.put('libTracks', {
    id: 'a',
    sourceKey: 'youtube:abcdefghijk',
    title: 'A',
    artist: 'X',
    album: null,
    durationMs: 1,
    sizeBytes: 1,
    mimeType: 'audio/mp4',
    dominantColor: '#000000',
    addedAt: 1,
  });
  // sourceKey unico: un secondo brano con la stessa sorgente viene rifiutato.
  await expect(
    v2.add('libTracks', {
      id: 'b',
      sourceKey: 'youtube:abcdefghijk',
      title: 'B',
      artist: 'X',
      album: null,
      durationMs: 1,
      sizeBytes: 1,
      mimeType: 'audio/mp4',
      dominantColor: '#000000',
      addedAt: 2,
    }),
  ).rejects.toThrow();
  v2.close();
});

test('coda dei download ordinata per inserimento', async () => {
  const db = await openSpookyfyDb(uniqueName());
  await db.put('downloadQueue', { trackId: 'b', enqueuedAt: 2, batchId: 'x' });
  await db.put('downloadQueue', { trackId: 'a', enqueuedAt: 1, batchId: 'x' });
  expect((await db.getAllFromIndex('downloadQueue', 'byEnqueued')).map((q) => q.trackId)).toEqual(['a', 'b']);
  db.close();
});

test('meta tipizzati e pulizia dei dati personali al logout', async () => {
  const db = await openSpookyfyDb(uniqueName());
  await setMeta(db, 'user', { id: 'u', username: 'fede', createdAt: 1 });
  await db.put('downloads', { trackId: 't1', sizeBytes: 10, downloadedAt: 1 });
  expect((await getMeta(db, 'user'))?.username).toBe('fede');
  await clearPersonalData(db);
  expect(await getMeta(db, 'user')).toBeUndefined();
  expect(await db.count('downloads')).toBe(1);
  db.close();
});

test('migrazione v2 → v3: i brani con album vengono raggruppati, gli altri restano senza', async () => {
  const name = uniqueName();
  const v2 = await openSpookyfyDb(name, 2);
  const base = {
    sourceKey: '',
    artist: 'Radiohead',
    durationMs: 1,
    sizeBytes: 1,
    mimeType: 'audio/mp4',
    dominantColor: '#000000',
  };
  await v2.put('libTracks', {
    ...base,
    id: 'a',
    sourceKey: 'file:a',
    title: 'Airbag',
    album: 'OK Computer',
    addedAt: 1,
  });
  await v2.put('libTracks', {
    ...base,
    id: 'b',
    sourceKey: 'file:b',
    title: 'Lucky',
    album: 'ok computer',
    addedAt: 2,
  });
  await v2.put('libTracks', {
    ...base,
    id: 'c',
    sourceKey: 'file:c',
    title: 'Creep',
    album: null,
    addedAt: 3,
  });
  v2.close();

  const v3 = await openSpookyfyDb(name, 3);
  const albums = await v3.getAll('libAlbums');
  expect(albums).toEqual([
    expect.objectContaining({
      title: 'OK Computer',
      artist: 'Radiohead',
      origin: 'auto',
      lookupStatus: 'pending',
    }),
  ]);
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((id) => v3.get('libTracks', id)));
  expect(a).toMatchObject({ albumId: albums[0]!.id, albumPosition: 1, album: 'OK Computer', genres: [] });
  expect(b).toMatchObject({ albumId: albums[0]!.id, albumPosition: 2, album: 'OK Computer' });
  expect(c).toMatchObject({ album: null, genres: [] });
  expect(c?.albumId).toBeUndefined();
  v3.close();
});

test.each([1, 2, 3])(
  'v%d upgrades additively to v4 with cached downloads and playlists intact',
  async (version) => {
    const name = uniqueName();
    const old = await openSpookyfyDb(name, version);
    await old.put('downloads', { trackId: 'cached', sizeBytes: 7, downloadedAt: 1 });
    if (version >= 2) {
      await old.put('libPlaylists', { id: 'legacy', name: 'Legacy', createdAt: 1, updatedAt: 1 });
      await old.put('libPlaylistItems', {
        id: 'occ',
        playlistId: 'legacy',
        trackId: 't',
        position: 1,
        addedAt: 1,
      });
    }
    old.close();
    const upgraded = await openSpookyfyDb(name);
    expect(upgraded.version).toBe(4);
    expect(await upgraded.get('downloads', 'cached')).toEqual({
      trackId: 'cached',
      sizeBytes: 7,
      downloadedAt: 1,
    });
    expect(await upgraded.count('hybridPlaylists')).toBe(0);
    expect(await upgraded.count('hybridItems')).toBe(0);
    if (version >= 2) {
      expect(await upgraded.get('libPlaylists', 'legacy')).toMatchObject({ name: 'Legacy' });
      expect(await upgraded.get('libPlaylistItems', 'occ')).toMatchObject({ trackId: 't' });
    }
    upgraded.close();
  },
);
