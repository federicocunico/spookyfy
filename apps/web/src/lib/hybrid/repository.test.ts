import { afterEach, beforeEach, expect, test } from 'vitest';
import { type Db, openSpookyfyDb } from '../offline/db';
import { HybridRepository } from './repository';
let db: Db;
let repo: HybridRepository;
let owner: string | null;
const uri = 'spotify:track:0123456789012345678901';
beforeEach(async () => {
  db = await openSpookyfyDb(crypto.randomUUID());
  owner = 'a';
  repo = new HybridRepository(
    async () => db,
    () => owner,
  );
  await db.put('libTracks', {
    id: 't',
    sourceKey: 'file:t',
    title: 't',
    artist: 'a',
    album: null,
    durationMs: 1,
    sizeBytes: 1,
    mimeType: 'audio/mpeg',
    dominantColor: '#000000',
    addedAt: 1,
  });
});
afterEach(() => db.close());
test('separate owners, preserve duplicates and remove occurrence identity', async () => {
  const p = await repo.create('P');
  await repo.add(p.id, { provider: 'local', trackId: 't' });
  const full = await repo.add(p.id, { provider: 'local', trackId: 't' });
  expect(full.items).toHaveLength(2);
  expect(full.items[0]!.itemId).not.toBe(full.items[1]!.itemId);
  await repo.move(p.id, full.items[1]!.itemId, 0);
  await repo.remove(p.id, full.items[0]!.itemId);
  expect((await repo.get(p.id)).items[0]!.itemId).toBe(full.items[1]!.itemId);
  owner = 'b';
  expect(await repo.list()).toEqual([]);
  await expect(repo.get(p.id)).rejects.toThrow();
  owner = null;
  await expect(repo.list()).rejects.toThrow();
});
test('legacy copy preserves original and order', async () => {
  await db.put('libPlaylists', { id: 'old', name: 'Original', createdAt: 1, updatedAt: 1 });
  await db.put('libPlaylistItems', { id: 'one', playlistId: 'old', trackId: 't', position: 1, addedAt: 1 });
  const p = await repo.copyLegacy('old');
  expect(p.items[0]!.ref).toEqual({ provider: 'local', trackId: 't' });
  expect(await db.get('libPlaylists', 'old')).toBeDefined();
});
test('portable restore assigns owner, remains inert and is idempotent', async () => {
  await repo.reconcile('spotify-a', 1);
  const p = await repo.create('P');
  await repo.add(p.id, { provider: 'spotify', uri }, 'spotify-a');
  await repo.add(p.id, { provider: 'local', trackId: 't' });
  const backup = await repo.snapshot();
  owner = 'b';
  await repo.restore(backup, new Map());
  await repo.restore(backup, new Map());
  let restored = await repo.get(p.id);
  expect(restored.ownerId).toBe('b');
  expect(restored.items).toHaveLength(2);
  expect(restored.items[0]!.inert).toBe(true);
  await repo.reconcile('different', 1, true);
  expect((await repo.get(p.id)).items[0]!.inert).toBe(true);
  await repo.reconcile('spotify-a', 2, true);
  expect((await repo.get(p.id)).items[0]!.inert).toBe(false);
  await repo.reconcile(null, 3);
  restored = await repo.get(p.id);
  expect(restored.items).toHaveLength(1);
  expect(restored.items[0]!.ref.provider).toBe('local');
});
test('whole backup validation precedes writes and strips no hidden secrets', async () => {
  await expect(
    repo.restore(
      {
        version: 1,
        collections: [
          { id: 'ok', name: 'ok', createdAt: 1, updatedAt: 1, items: [] },
          { id: 'bad', name: '', createdAt: 1, updatedAt: 1, items: [] },
        ],
      } as never,
      new Map(),
    ),
  ).rejects.toThrow();
  expect(await repo.list()).toEqual([]);
});
test('interrupted Spotify copy creates nothing; complete copy counts unsupported occurrences', async () => {
  await repo.reconcile('a', 1);
  await expect(
    repo.copySpotify('P', 'a', async (offset) => {
      if (offset) throw new Error('network');
      return { items: [], nextOffset: 10, total: 20, contentsAvailable: true };
    }),
  ).rejects.toThrow('network');
  expect(await repo.list()).toEqual([]);
  const result = await repo.copySpotify('P', 'a', async () => ({
    items: [{ itemId: 'x', position: 0, track: null }],
    nextOffset: null,
    total: 1,
    contentsAvailable: true,
  }));
  expect(result.excluded).toBe(1);
  expect(result.playlist.items).toEqual([]);
});

test('owner switches during a remote page fetch do not copy into either account', async () => {
  await repo.reconcile('remote', 1);
  let finish!: (value: never) => void;
  const page = new Promise<never>((r) => {
    finish = r;
  });
  const copying = repo.copySpotify('P', 'remote', async () => page);
  await new Promise((r) => setTimeout(r, 0));
  owner = 'b';
  finish({ items: [], nextOffset: null, total: 0, contentsAvailable: true } as never);
  await expect(copying).rejects.toThrow('Account cambiato');
  expect(await repo.list()).toEqual([]);
  owner = 'a';
  expect(await repo.list()).toEqual([]);
});
test('unlink then relink same identity fences staged remote copies', async () => {
  await repo.reconcile('remote', 1);
  let finish!: (value: never) => void;
  const page = new Promise<never>((r) => {
    finish = r;
  });
  const copying = repo.copySpotify('P', 'remote', async () => page);
  await new Promise((r) => setTimeout(r, 0));
  await repo.reconcile(null, 2);
  await repo.reconcile('remote', 3);
  finish({ items: [], nextOffset: null, total: 0, contentsAvailable: true } as never);
  await expect(copying).rejects.toThrow('Collegamento Spotify cambiato');
  expect(await repo.list()).toEqual([]);
  await repo.reconcile('remote', 1);
  expect((await db.get('hybridLinks', 'a'))?.generation).toBe(3);
});
test('local files removed after adding are exposed unavailable; mutations notify subscribers', async () => {
  const changed = vi.fn();
  const unsubscribe = repo.subscribe(changed);
  const p = await repo.create('P');
  await repo.add(p.id, { provider: 'local', trackId: 't' });
  await repo.rename(p.id, 'Renamed');
  await db.delete('libTracks', 't');
  expect((await repo.get(p.id)).items[0]!.inert).toBe(true);
  expect((await repo.get(p.id)).name).toBe('Renamed');
  await repo.delete(p.id);
  expect(changed).toHaveBeenCalledTimes(4);
  unsubscribe();
});

test('purge broadcasts owner-scoped invalidation to another tab only', async () => {
  const channels = new Set<{ name: string; onmessage: ((event: { data: unknown }) => void) | null }>();
  class FakeChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(public name: string) {
      channels.add(this);
    }
    postMessage(data: unknown) {
      for (const c of channels) if (c !== this && c.name === this.name) c.onmessage?.({ data });
    }
    close() {
      channels.delete(this);
    }
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  try {
    const same = new HybridRepository(
      async () => db,
      () => 'a',
    );
    const other = new HybridRepository(
      async () => db,
      () => 'b',
    );
    const changed = vi.fn();
    const unrelated = vi.fn();
    const off = same.subscribe(changed);
    const offOther = other.subscribe(unrelated);
    await repo.reconcile('remote', 1);
    changed.mockClear();
    await repo.purgeSpotify('remote');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(unrelated).not.toHaveBeenCalled();
    off();
    offOther();
  } finally {
    vi.unstubAllGlobals();
  }
});
