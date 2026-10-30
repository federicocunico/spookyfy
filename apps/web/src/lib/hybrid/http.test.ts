import type { HybridPlaylistDto } from '@spookyfy/shared';
import { expect, test, vi } from 'vitest';
import { openSpookyfyDb } from '../offline/db';
import { HttpHybridRepository } from './http';
test('onprem snapshot serves refs offline partitioned by current owner without provider requests', async () => {
  const db = await openSpookyfyDb(crypto.randomUUID());
  let owner: string | null = 'a';
  let offline = false;
  const p: HybridPlaylistDto = {
    id: 'p',
    ownerId: 'a',
    name: 'P',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { itemId: 'local', ref: { provider: 'local', trackId: 't' }, addedAt: 1 },
      {
        itemId: 'remote',
        ref: { provider: 'spotify', uri: 'spotify:track:0123456789012345678901' },
        spotifyAccountId: 'remote',
        addedAt: 1,
      },
    ],
  };
  const request = vi.fn(async (path: string) =>
    path === '/api/spotify/status'
      ? { accountId: 'remote', generation: 1, linkState: 'linked' }
      : { items: [p] },
  );
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => owner,
    offline: () => offline,
    status: async () => request('/api/spotify/status') as never,
  });
  expect(await repo.list()).toEqual([p]);
  offline = true;
  request.mockClear();
  const cached = await repo.list();
  expect(cached[0]!.items[1]!.inert).toBe(true);
  expect(request).not.toHaveBeenCalled();
  owner = 'b';
  expect(await repo.list()).toEqual([]);
  owner = null;
  await expect(repo.list()).rejects.toThrow();
  db.close();
});
test('remote copy stages pages and sends one generation-guarded transaction, interrupted page sends nothing', async () => {
  const request = vi.fn(async (path: string) =>
    path === '/api/spotify/status'
      ? { accountId: 'remote', generation: 4 }
      : { id: 'p', ownerId: 'a', name: 'P', createdAt: 1, updatedAt: 1, items: [] },
  );
  const db = await openSpookyfyDb(crypto.randomUUID());
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status: async () => request('/api/spotify/status') as never,
  });
  await expect(
    repo.copySpotify('P', 'remote', async () => {
      throw new Error('network');
    }),
  ).rejects.toThrow('network');
  expect(request).toHaveBeenCalledTimes(1);
  request.mockClear();
  await repo.copySpotify('P', 'remote', async () => ({
    items: [{ itemId: 'null', position: 0, track: null }],
    nextOffset: null,
    total: 1,
    contentsAvailable: true,
  }));
  expect(request).toHaveBeenCalledTimes(3);
  const [, options] = request.mock.calls[2]! as unknown as [string, RequestInit];
  expect(JSON.parse(options.body as string)).toMatchObject({ accountId: 'remote', generation: 4, refs: [] });
  db.close();
});

const mixed: HybridPlaylistDto = {
  id: 'p',
  ownerId: 'a',
  name: 'Mixed',
  createdAt: 1,
  updatedAt: 1,
  items: [
    { itemId: 'local', ref: { provider: 'local', trackId: 't' }, addedAt: 1 },
    {
      itemId: 'remote',
      ref: { provider: 'spotify', uri: 'spotify:track:0123456789012345678901' },
      spotifyAccountId: 'remote',
      addedAt: 1,
    },
  ],
};
test.each(['list', 'get'] as const)(
  'unlink fences an inflight %s response and offline cache retains locals only',
  async (action) => {
    const db = await openSpookyfyDb(crypto.randomUUID());
    let offline = false;
    let status = { accountId: 'remote' as string | null, generation: 1, linkState: 'linked' };
    let finish!: () => void;
    let pending = false;
    let started!: () => void;
    const began = new Promise<void>((r) => {
      started = r;
    });
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const request = vi.fn(async (path: string) => {
      if (path === '/api/spotify/status') return status;
      if (pending) {
        started();
        await gate;
      }
      return path === '/api/hybrid-playlists' ? { items: [mixed] } : mixed;
    });
    const repo = new HttpHybridRepository(request as never, {
      db: async () => db,
      owner: () => 'a',
      offline: () => offline,
      status: async () => request('/api/spotify/status') as never,
    });
    await repo.list();
    pending = true;
    const stale = action === 'list' ? repo.list() : repo.get('p');
    await began;
    status = { accountId: null, generation: 2, linkState: 'unlinked' };
    await repo.reconcile(null, 2);
    await repo.purgeSpotify('remote');
    finish();
    await expect(stale).rejects.toThrow('Collegamento Spotify cambiato');
    offline = true;
    expect((await repo.get('p')).items.map((i) => i.itemId)).toEqual(['local']);
    expect(await db.get('hybridLinks', 'a')).toMatchObject({ accountId: null, generation: 2 });
    db.close();
  },
);
test('same account relink generation fences old response and inactive devices reconcile before showing refs', async () => {
  const db = await openSpookyfyDb(crypto.randomUUID());
  let status = { accountId: 'remote' as string | null, generation: 1, linkState: 'linked' };
  let finish!: () => void;
  let started!: () => void;
  let pending = false;
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  const began = new Promise<void>((r) => {
    started = r;
  });
  const request = vi.fn(async (path: string) => {
    if (path === '/api/spotify/status') return status;
    if (pending) {
      started();
      await gate;
    }
    return { items: [mixed] };
  });
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status: async () => request('/api/spotify/status') as never,
  });
  await repo.list();
  pending = true;
  const stale = repo.list();
  await began;
  await repo.reconcile(null, 2);
  await repo.reconcile('remote', 3);
  finish();
  await expect(stale).rejects.toThrow();
  expect(await db.count('hybridItems')).toBe(1);
  pending = false;
  status = { accountId: null, generation: 4, linkState: 'unlinked' };
  const inactive = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status: async () => request('/api/spotify/status') as never,
  });
  expect((await inactive.list())[0]!.items.map((i) => i.itemId)).toEqual(['local']);
  db.close();
});
test('unlink before initial status resolves fences that status without reintroducing remote refs', async () => {
  const db = await openSpookyfyDb(crypto.randomUUID());
  let finish!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  const began = new Promise<void>((r) => {
    started = r;
  });
  const request = vi.fn(async (path: string) => {
    if (path === '/api/spotify/status') {
      started();
      await gate;
      return { accountId: 'remote', generation: 1, linkState: 'linked' };
    }
    return { items: [mixed] };
  });
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status: async () => request('/api/spotify/status') as never,
  });
  const stale = repo.list();
  await began;
  await repo.purgeSpotify('remote');
  finish();
  await expect(stale).rejects.toThrow('Collegamento Spotify cambiato');
  expect(await db.count('hybridItems')).toBe(0);
  db.close();
});

test('concurrent equal status verification succeeds and restored refs require explicit consent', async () => {
  const db = await openSpookyfyDb(crypto.randomUUID());
  const request = vi.fn(async (path: string) =>
    path === '/api/spotify/status'
      ? { accountId: 'remote', generation: 1, linkState: 'linked' }
      : { items: [mixed] },
  );
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status: async () => request('/api/spotify/status') as never,
  });
  await expect(Promise.all([repo.list(), repo.list()])).resolves.toHaveLength(2);
  await db.put('hybridItems', {
    ownerId: 'a',
    playlistId: 'p',
    itemId: 'restored',
    position: 2,
    addedAt: 1,
    ref: { provider: 'spotify', uri: 'spotify:track:0123456789012345678901' },
    spotifyAccountId: 'remote',
    inert: true,
  });
  await repo.reconcile('other', 2);
  const restored = await db.get('hybridItems', ['a', 'p', 'restored']);
  expect(restored?.inert).toBe(true);
  expect(await db.get('hybridItems', ['a', 'p', 'local'])).toBeDefined();
  expect(await db.get('hybridItems', ['a', 'p', 'remote'])).toBeUndefined();
  await repo.purgeSpotify('remote');
  expect(await db.get('hybridItems', ['a', 'p', 'restored'])).toBeUndefined();
  expect(await db.get('hybridLinks', 'a')).toMatchObject({ accountId: 'other', generation: 2 });
  db.close();
});

test('provider 503 leaves local create/list/add available and never changes the app transport', async () => {
  const db = await openSpookyfyDb(crypto.randomUUID());
  const status = vi.fn(async () => {
    throw Object.assign(new Error('Spotify unavailable'), { status: 503 });
  });
  const request = vi.fn(async (path: string, options?: RequestInit) =>
    path === '/api/hybrid-playlists' && options?.method === 'GET' ? { items: [mixed] } : mixed,
  );
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status,
  });
  await repo.reconcile('remote', 1);
  const created = await repo.create('Local');
  expect(created.items[0]!.ref.provider).toBe('local');
  expect(created.items[1]!.inert).toBe(true);
  expect((await repo.list())[0]!.items[1]!.inert).toBe(true);
  expect((await repo.add('p', { provider: 'local', trackId: 't' })).items[0]!.itemId).toBe('local');
  expect(request.mock.calls.every(([path]) => path.startsWith('/api/hybrid-playlists'))).toBe(true);
  await repo.purgeSpotify('remote');
  const staleServer = await repo.list();
  expect(staleServer[0]!.items.map((i) => i.itemId)).toEqual(['local']);
  expect(status).toHaveBeenCalledTimes(4);
  db.close();
});
test('provider status timeout is bounded, aborts its signal, and continues local reads without retry', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const db = await openSpookyfyDb(crypto.randomUUID());
  let signal: AbortSignal | undefined;
  const status = vi.fn(async (value: AbortSignal) => {
    signal = value;
    return new Promise<never>(() => {});
  });
  const request = vi.fn(async () => ({ items: [mixed] }));
  const repo = new HttpHybridRepository(request as never, {
    db: async () => db,
    owner: () => 'a',
    offline: () => false,
    status,
  });
  try {
    const reading = repo.list();
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(8001);
    const result = await reading;
    expect(result[0]!.items[0]!.itemId).toBe('local');
    expect(result[0]!.items[1]!.inert).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(status).toHaveBeenCalledOnce();
  } finally {
    db.close();
    vi.useRealTimers();
  }
});
