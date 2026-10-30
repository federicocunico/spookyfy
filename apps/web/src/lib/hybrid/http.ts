import type {
  HybridPlaylistDto,
  MediaRef,
  SpotifyPlaylistItemsDto,
  SpotifyStatusDto,
} from '@spookyfy/shared';
import type { Db } from '../offline/db';
import { HybridRepository, type HybridRepositoryApi } from './repository';
type LinkFence = { accountId: string | null; generation: number } | undefined;
type VerifiedFence = { link: LinkFence; verified: boolean };
const sameFence = (a: LinkFence, b: LinkFence) =>
  a?.accountId === b?.accountId && a?.generation === b?.generation;
/** Uses the authenticated app transport; hybrid endpoints never contact Spotify themselves. */
export class HttpHybridRepository implements HybridRepositoryApi {
  subscribe(listener: () => void) {
    if (!this.cache) return () => {};
    return new HybridRepository(this.cache.db, this.cache.owner).subscribe(listener);
  }
  private changed(ownerId: string | undefined | null) {
    if (ownerId && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('spookyfy-hybrid');
      channel.postMessage({ ownerId });
      channel.close();
    }
  }
  constructor(
    private request: <T>(path: string, options?: RequestInit) => Promise<T>,
    private cache?: {
      db: () => Promise<Db>;
      owner: () => string | null | undefined;
      offline: () => boolean;
      status?: (signal: AbortSignal) => Promise<SpotifyStatusDto>;
    },
  ) {}
  private async providerStatus() {
    if (!this.cache?.status) throw new Error('Stato Spotify non disponibile');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.cache.status(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Timeout Spotify'));
          }, 8000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Verified status must complete before the caller exposes remote references. */
  async reconcile(accountId: string | null, generation: number) {
    if (!this.cache) return;
    const owner = this.cache.owner();
    if (!owner) throw new Error('Accesso richiesto');
    const db = await this.cache.db();
    if (this.cache.owner() !== owner) throw new Error('Account cambiato');
    const tx = db.transaction(['hybridLinks', 'hybridItems'], 'readwrite');
    const previous = await tx.objectStore('hybridLinks').get(owner);
    if (previous && generation < previous.generation) {
      await tx.done;
      return;
    }
    const linkChanged = !sameFence(previous, { accountId, generation });
    let changed = linkChanged;
    // Also handles caches written by older clients before hybridLinks existed.
    for (const item of await tx.objectStore('hybridItems').index('byOwner').getAll(owner))
      if (
        item.ref.provider === 'spotify' &&
        !item.inert &&
        (item.spotifyAccountId !== accountId || Boolean(previous && linkChanged))
      ) {
        await tx.objectStore('hybridItems').delete([owner, item.playlistId, item.itemId]);
        changed = true;
      }
    await tx.objectStore('hybridLinks').put({ ownerId: owner, accountId, generation });
    await tx.done;
    if (changed) this.changed(owner);
  }
  async purgeSpotify(accountId: string) {
    if (!this.cache) return;
    const owner = this.cache.owner();
    if (!owner) throw new Error('Accesso richiesto');
    const db = await this.cache.db();
    if (this.cache.owner() !== owner) throw new Error('Account cambiato');
    const tx = db.transaction(['hybridLinks', 'hybridItems'], 'readwrite');
    const previous = await tx.objectStore('hybridLinks').get(owner);
    // A tombstone is required even before this device's first verified status.
    if (!previous || previous.accountId === accountId)
      await tx
        .objectStore('hybridLinks')
        .put({ ownerId: owner, accountId: null, generation: (previous?.generation ?? -1) + 1 });
    for (const item of await tx.objectStore('hybridItems').index('byOwner').getAll(owner))
      if (item.ref.provider === 'spotify' && item.spotifyAccountId === accountId)
        await tx.objectStore('hybridItems').delete([owner, item.playlistId, item.itemId]);
    await tx.done;
    this.changed(owner);
  }
  private async verifiedFence(owner: string | null | undefined): Promise<VerifiedFence> {
    if (!this.cache) return { link: undefined, verified: false };
    if (!owner) throw new Error('Accesso richiesto');
    const db = await this.cache.db();
    const before = await db.get('hybridLinks', owner);
    let status: SpotifyStatusDto;
    try {
      status = await this.providerStatus();
    } catch {
      if (this.cache.owner() !== owner) throw new Error('Account cambiato');
      return { link: await db.get('hybridLinks', owner), verified: false };
    }
    if (this.cache.owner() !== owner) throw new Error('Account cambiato');
    const current = await db.get('hybridLinks', owner);
    const verified = {
      accountId: status.linkState === 'unlinked' ? null : status.accountId,
      generation: status.generation,
    };
    if (!sameFence(before, current) && !sameFence(current, verified))
      throw new Error('Collegamento Spotify cambiato');
    await this.reconcile(status.linkState === 'unlinked' ? null : status.accountId, status.generation);
    return { link: await db.get('hybridLinks', owner), verified: true };
  }
  private async cached(id?: string) {
    const owner = this.cache?.owner();
    if (!owner) throw new Error('Accesso richiesto');
    const db = await this.cache!.db();
    const rows = await db.getAllFromIndex('hybridPlaylists', 'byOwner', owner);
    const result = await Promise.all(
      rows
        .filter((p) => !id || p.id === id)
        .map(async (p) => ({
          ...p,
          items: (await db.getAllFromIndex('hybridItems', 'byPlaylist', [owner, p.id]))
            .sort((a, b) => a.position - b.position)
            .map(({ ownerId: _o, playlistId: _p, position: _n, ...i }) => ({
              ...i,
              ...(i.ref.provider === 'spotify' ? { inert: true } : {}),
            })),
        })),
    );
    if (this.cache!.owner() !== owner) throw new Error('Account cambiato');
    return result;
  }
  private async rememberMany(
    playlists: HybridPlaylistDto[],
    owner: string | null | undefined,
    fence: VerifiedFence,
    replace = false,
  ) {
    if (!this.cache) return playlists;
    if (!owner || this.cache.owner() !== owner || playlists.some((p) => p.ownerId !== owner))
      throw new Error('Account cambiato');
    const db = await this.cache.db();
    if (this.cache.owner() !== owner) throw new Error('Account cambiato');
    const tx = db.transaction(['hybridPlaylists', 'hybridItems', 'hybridLinks'], 'readwrite');
    void tx.done.catch(() => {});
    const current = await tx.objectStore('hybridLinks').get(owner);
    if (!sameFence(current, fence.link)) {
      tx.abort();
      throw new Error('Collegamento Spotify cambiato');
    }
    const retained = playlists.map((p) => ({
      ...p,
      items: p.items.filter(
        (item) =>
          item.ref.provider === 'local' ||
          item.inert ||
          (!current && !fence.verified) ||
          Boolean(current?.accountId && item.spotifyAccountId === current.accountId),
      ),
    }));
    for (const p of retained) {
      const { items, ...head } = p;
      await tx.objectStore('hybridPlaylists').put(head);
      for (const i of await tx.objectStore('hybridItems').index('byPlaylist').getAll([owner, p.id]))
        await tx.objectStore('hybridItems').delete([owner, p.id, i.itemId]);
      for (const [position, item] of items.entries())
        await tx.objectStore('hybridItems').put({ ...item, ownerId: owner, playlistId: p.id, position });
    }
    if (replace) {
      const ids = new Set(retained.map((p) => p.id));
      for (const p of await tx.objectStore('hybridPlaylists').index('byOwner').getAll(owner))
        if (!ids.has(p.id)) {
          await tx.objectStore('hybridPlaylists').delete([owner, p.id]);
          for (const item of await tx.objectStore('hybridItems').index('byPlaylist').getAll([owner, p.id]))
            await tx.objectStore('hybridItems').delete([owner, p.id, item.itemId]);
        }
    }
    await tx.done;
    return retained.map((p) => ({
      ...p,
      items: p.items.map((item) =>
        item.ref.provider === 'spotify' && !fence.verified ? { ...item, inert: true } : item,
      ),
    }));
  }
  private async mutate(path: string, method: string, body?: unknown) {
    const owner = this.cache?.owner();
    if (this.cache?.offline()) throw new Error('Operazione disponibile online');
    const fence = await this.verifiedFence(owner);
    const p = (
      await this.rememberMany([await this.send<HybridPlaylistDto>(path, method, body)], owner, fence)
    )[0]!;
    this.changed(owner);
    return p;
  }
  private send<T>(path: string, method: string, body?: unknown) {
    return this.request<T>(`/api/hybrid-playlists${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  }
  async list() {
    if (this.cache?.offline()) return this.cached();
    const owner = this.cache?.owner();
    const fence = await this.verifiedFence(owner);
    const items = (await this.send<{ items: HybridPlaylistDto[] }>('', 'GET')).items;
    return this.rememberMany(items, owner, fence, true);
  }
  async get(id: string) {
    if (this.cache?.offline()) {
      const p = (await this.cached(id))[0];
      if (!p) throw new Error('Raccolta non salvata offline');
      return p;
    }
    const owner = this.cache?.owner();
    const fence = await this.verifiedFence(owner);
    return (await this.rememberMany([await this.send<HybridPlaylistDto>(`/${id}`, 'GET')], owner, fence))[0]!;
  }
  create(name: string) {
    return this.mutate('', 'POST', { name });
  }
  rename(id: string, name: string) {
    return this.mutate(`/${id}`, 'PATCH', { name });
  }
  add(id: string, ref: MediaRef, spotifyAccountId?: string) {
    return this.mutate(`/${id}/items`, 'POST', { ref, spotifyAccountId });
  }
  remove(id: string, itemId: string) {
    return this.mutate(`/${id}/items/${itemId}`, 'DELETE');
  }
  move(id: string, itemId: string, toIndex: number) {
    return this.mutate(`/${id}/items/${itemId}/move`, 'POST', { toIndex });
  }
  async delete(id: string) {
    if (this.cache?.offline()) throw new Error('Operazione disponibile online');
    const owner = this.cache?.owner();
    await this.send<void>(`/${id}`, 'DELETE');
    if (this.cache && owner) {
      const db = await this.cache.db();
      const tx = db.transaction(['hybridPlaylists', 'hybridItems'], 'readwrite');
      await tx.objectStore('hybridPlaylists').delete([owner, id]);
      for (const i of await tx.objectStore('hybridItems').index('byPlaylist').getAll([owner, id]))
        await tx.objectStore('hybridItems').delete([owner, id, i.itemId]);
      await tx.done;
    }
    this.changed(owner);
  }
  copyLegacy(id: string) {
    return this.mutate(`/copy/${id}`, 'POST');
  }
  async copySpotify(
    name: string,
    accountId: string,
    page: (offset: number) => Promise<SpotifyPlaylistItemsDto>,
    signal?: AbortSignal,
  ) {
    const owner = this.cache?.owner();
    const status = await this.providerStatus();
    if (status.accountId !== accountId) throw new Error('Collegamento Spotify cambiato');
    const refs: MediaRef[] = [];
    let offset = 0;
    let excluded = 0;
    const seen = new Set<number>();
    while (true) {
      signal?.throwIfAborted();
      if (seen.has(offset) || seen.size >= 1000) throw new Error('Paginazione non valida');
      seen.add(offset);
      const p = await page(offset);
      signal?.throwIfAborted();
      if (!p.contentsAvailable) throw new Error('Contenuto Spotify non disponibile');
      for (const i of p.items) {
        if (i.track?.available) refs.push({ provider: 'spotify', uri: i.track.uri });
        else excluded++;
      }
      if (p.nextOffset === null) break;
      offset = p.nextOffset;
    }
    if (this.cache && owner !== this.cache.owner()) throw new Error('Account cambiato');
    const playlist = await this.mutate('/copy-spotify', 'POST', {
      name,
      accountId,
      generation: status.generation,
      refs,
    });
    return { playlist, excluded };
  }
}
