import { type IDBPDatabase, openDB } from 'idb';
import { DB_VERSION, MIGRATIONS, clearPersonalData, getMeta, openSpookyfyDb, setMeta } from './db';

let n = 0;
const uniqueName = () => `spk-test-${Date.now()}-${n++}`;

test('apertura su un database nuovo: tutti gli store e gli indici', async () => {
  const db = await openSpookyfyDb(uniqueName());
  expect(db.version).toBe(DB_VERSION);
  expect([...db.objectStoreNames].sort()).toEqual(
    ['downloadQueue', 'downloads', 'meta', 'pendingPlays', 'playlists', 'tracks'].sort(),
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

test('migrazione: da v1 a una versione successiva i dati restano e la nuova migrazione viene applicata', async () => {
  const name = uniqueName();
  const v1 = await openSpookyfyDb(name, 1);
  await v1.put('downloads', { trackId: 't1', sizeBytes: 10, downloadedAt: 1 });
  v1.close();

  // Migrazione di prova registrata solo per questo test.
  MIGRATIONS[2] = (db) => {
    (db as unknown as IDBPDatabase).createObjectStore('futuro');
  };
  try {
    const v2 = await openSpookyfyDb(name, 2);
    expect(v2.version).toBe(2);
    expect(v2.objectStoreNames.contains('futuro' as never)).toBe(true);
    expect(await v2.get('downloads', 't1')).toMatchObject({ trackId: 't1' });
    v2.close();
  } finally {
    // biome-ignore lint/performance/noDelete: la chiave va rimossa, non solo azzerata
    delete MIGRATIONS[2];
  }
});

test('un database a una versione intermedia viene portato all’ultima', async () => {
  const name = uniqueName();
  // Database creato "a mano" alla v1 da un client precedente (stesso schema).
  const legacy = await openDB(name, 1, { upgrade: (db) => MIGRATIONS[1]!(db as never) });
  legacy.close();
  const db = await openSpookyfyDb(name);
  expect(db.version).toBe(DB_VERSION);
  expect(db.objectStoreNames.contains('pendingPlays')).toBe(true);
  db.close();
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
