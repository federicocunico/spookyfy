import {
  type BackupHybridCollections,
  type HybridPlaylistDto,
  type MediaRef,
  type SpotifyPlaylistItemsDto,
  backupHybridCollectionsSchema,
  mediaRefSchema,
} from '@spookyfy/shared';
import type { Db } from '../offline/db';

export interface HybridRepositoryApi {
  reconcile?(accountId: string | null, generation: number): Promise<void>;
  purgeSpotify?(accountId: string): Promise<void>;
  list(): Promise<HybridPlaylistDto[]>;
  get(id: string): Promise<HybridPlaylistDto>;
  create(name: string): Promise<HybridPlaylistDto>;
  rename(id: string, name: string): Promise<HybridPlaylistDto>;
  add(id: string, ref: MediaRef, spotifyAccountId?: string): Promise<HybridPlaylistDto>;
  remove(id: string, itemId: string): Promise<HybridPlaylistDto>;
  move(id: string, itemId: string, toIndex: number): Promise<HybridPlaylistDto>;
  delete(id: string): Promise<void>;
  copyLegacy?(id: string): Promise<HybridPlaylistDto>;
  subscribe?(listener: () => void): () => void;
  copySpotify(
    name: string,
    accountId: string,
    page: (offset: number) => Promise<SpotifyPlaylistItemsDto>,
    signal?: AbortSignal,
  ): Promise<{ playlist: HybridPlaylistDto; excluded: number }>;
}
const nameOf = (name: string) => {
  if (!name.trim() || name.trim().length > 100) throw new Error('Nome non valido');
  return name.trim();
};

/** Every operation captures its owner before its first await. No provider metadata is persisted. */
export class HybridRepository implements HybridRepositoryApi {
  private channel?: BroadcastChannel;
  private listeners = new Set<() => void>();
  constructor(
    private db: () => Promise<Db>,
    private owner: () => string | null | undefined,
  ) {}
  subscribe(listener: () => void) {
    if (!this.channel && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('spookyfy-hybrid');
      this.channel.onmessage = (event) => {
        if (event.data?.ownerId === this.owner()) for (const fn of this.listeners) fn();
      };
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.channel?.close();
        this.channel = undefined;
      }
    };
  }
  private changed(ownerId: string) {
    // Short-lived channel also reaches tabs when this instance has no UI subscriber.
    if (this.channel) this.channel.postMessage({ ownerId });
    else if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('spookyfy-hybrid');
      channel.postMessage({ ownerId });
      channel.close();
    }
    for (const fn of this.listeners) fn();
  }
  private user() {
    const id = this.owner();
    if (!id) throw new Error('Accesso richiesto');
    return id;
  }
  assertOwner(expected?: string) {
    const owner = this.user();
    if (expected && expected !== owner) throw new Error('Account cambiato');
    return owner;
  }
  private async read(db: Db, owner: string, id: string): Promise<HybridPlaylistDto> {
    const p = await db.get('hybridPlaylists', [owner, id]);
    if (!p) throw new Error('Raccolta non trovata');
    const rows = await db.getAllFromIndex('hybridItems', 'byPlaylist', [owner, id]);
    const available = new Set(
      (await db.getAll('libTracks')).filter((track) => !track.lost).map((track) => track.id),
    );
    if (this.user() !== owner) throw new Error('Account cambiato');
    return {
      ...p,
      items: rows
        .sort((a, b) => a.position - b.position || a.itemId.localeCompare(b.itemId))
        .map(({ ownerId: _o, playlistId: _p, position: _n, ...i }) => ({
          ...i,
          ...(i.ref.provider === 'local' && !available.has(i.ref.trackId) ? { inert: true } : {}),
        })),
    };
  }
  async list() {
    const owner = this.user();
    const db = await this.db();
    const rows = await db.getAllFromIndex('hybridPlaylists', 'byOwner', owner);
    if (this.user() !== owner) throw new Error('Account cambiato');
    return Promise.all(rows.map((p) => this.read(db, owner, p.id)));
  }
  async get(id: string) {
    const owner = this.user();
    return this.read(await this.db(), owner, id);
  }
  async create(name: string) {
    const ownerId = this.user();
    const now = Date.now();
    const p = { ownerId, id: crypto.randomUUID(), name: nameOf(name), createdAt: now, updatedAt: now };
    const db = await this.db();
    if (this.user() !== ownerId) throw new Error('Account cambiato');
    await db.put('hybridPlaylists', p);
    this.changed(ownerId);
    return { ...p, items: [] };
  }
  private async edit(
    id: string,
    action: (p: HybridPlaylistDto) => void,
    expectedOwner?: string,
    expectedAccount?: string,
    localTrackId?: string,
    expectedGeneration?: number,
  ) {
    const owner = expectedOwner ?? this.user();
    const db = await this.db();
    if (this.user() !== owner) throw new Error('Account cambiato');
    // Read and write under one transaction so simultaneous tabs cannot lose occurrences.
    const tx = db.transaction(['hybridPlaylists', 'hybridItems', 'hybridLinks', 'libTracks'], 'readwrite');
    void tx.done.catch(() => {});
    if (localTrackId && !(await tx.objectStore('libTracks').get(localTrackId))) {
      tx.abort();
      throw new Error('Brano locale non trovato');
    }
    if (expectedAccount) {
      const link = await tx.objectStore('hybridLinks').get(owner);
      if (link?.accountId !== expectedAccount || link.generation !== expectedGeneration) {
        tx.abort();
        throw new Error('Collegamento Spotify cambiato');
      }
    }
    const row = await tx.objectStore('hybridPlaylists').get([owner, id]);
    if (!row) {
      tx.abort();
      throw new Error('Raccolta non trovata');
    }
    const rows = await tx.objectStore('hybridItems').index('byPlaylist').getAll([owner, id]);
    const p = {
      ...row,
      items: rows
        .sort((a, b) => a.position - b.position)
        .map(({ ownerId: _o, playlistId: _p, position: _n, ...i }) => i),
    };
    try {
      action(p);
    } catch (e) {
      tx.abort();
      throw e;
    }
    for (const r of rows) await tx.objectStore('hybridItems').delete([owner, id, r.itemId]);
    for (const [position, i] of p.items.entries())
      await tx.objectStore('hybridItems').put({ ...i, ownerId: owner, playlistId: id, position });
    p.updatedAt = Date.now();
    const { items: _items, ...head } = p;
    await tx.objectStore('hybridPlaylists').put(head);
    await tx.done;
    this.changed(owner);
    return p;
  }
  async add(id: string, ref: MediaRef, spotifyAccountId?: string) {
    const valid = mediaRefSchema.parse(ref);
    const owner = this.user();
    const db = await this.db();
    let generation: number | undefined;
    if (valid.provider === 'local' && !(await db.get('libTracks', valid.trackId)))
      throw new Error('Brano locale non trovato');
    if (valid.provider === 'spotify') {
      const link = await db.get('hybridLinks', owner);
      if (!spotifyAccountId || link?.accountId !== spotifyAccountId)
        throw new Error('Confermare il collegamento Spotify');
      generation = link.generation;
    }
    return this.edit(
      id,
      (p) =>
        p.items.push({
          itemId: crypto.randomUUID(),
          ref: valid,
          addedAt: Date.now(),
          ...(valid.provider === 'spotify' ? { spotifyAccountId, inert: false } : {}),
        }),
      owner,
      valid.provider === 'spotify' ? spotifyAccountId : undefined,
      valid.provider === 'local' ? valid.trackId : undefined,
      generation,
    );
  }
  rename(id: string, name: string) {
    return this.edit(id, (p) => {
      p.name = nameOf(name);
    });
  }
  remove(id: string, itemId: string) {
    return this.edit(id, (p) => {
      if (!p.items.some((i) => i.itemId === itemId)) throw new Error('Occorrenza non trovata');
      p.items = p.items.filter((i) => i.itemId !== itemId);
    });
  }
  move(id: string, itemId: string, toIndex: number) {
    return this.edit(id, (p) => {
      const from = p.items.findIndex((i) => i.itemId === itemId);
      if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= p.items.length)
        throw new Error('Posizione non valida');
      const [item] = p.items.splice(from, 1);
      p.items.splice(toIndex, 0, item!);
    });
  }
  async delete(id: string) {
    const p = await this.get(id);
    const db = await this.db();
    if (this.user() !== p.ownerId) throw new Error('Account cambiato');
    const tx = db.transaction(['hybridPlaylists', 'hybridItems'], 'readwrite');
    void tx.done.catch(() => {});
    for (const i of p.items) await tx.objectStore('hybridItems').delete([p.ownerId, id, i.itemId]);
    await tx.objectStore('hybridPlaylists').delete([p.ownerId, id]);
    await tx.done;
    this.changed(p.ownerId);
  }
  private async insertCopy(
    owner: string,
    name: string,
    refs: MediaRef[],
    link?: { accountId: string; generation: number },
  ) {
    const db = await this.db();
    if (this.user() !== owner) throw new Error('Account cambiato');
    const tx = db.transaction(['hybridPlaylists', 'hybridItems', 'hybridLinks', 'libTracks'], 'readwrite');
    void tx.done.catch(() => {});
    const current = await tx.objectStore('hybridLinks').get(owner);
    if (link && (current?.accountId !== link.accountId || current.generation !== link.generation)) {
      tx.abort();
      throw new Error('Collegamento Spotify cambiato');
    }
    for (const ref of refs)
      if (ref.provider === 'local' && !(await tx.objectStore('libTracks').get(ref.trackId))) {
        tx.abort();
        throw new Error('Brano locale non trovato');
      }
    const now = Date.now();
    const id = crypto.randomUUID();
    const head = { ownerId: owner, id, name: nameOf(name), createdAt: now, updatedAt: now };
    await tx.objectStore('hybridPlaylists').put(head);
    const items = refs.map((ref) => ({
      itemId: crypto.randomUUID(),
      ref: mediaRefSchema.parse(ref),
      addedAt: now,
      ...(ref.provider === 'spotify' ? { spotifyAccountId: link!.accountId, inert: false } : {}),
    }));
    for (const [position, item] of items.entries())
      await tx.objectStore('hybridItems').put({ ...item, ownerId: owner, playlistId: id, position });
    if (this.user() !== owner) {
      tx.abort();
      throw new Error('Account cambiato');
    }
    await tx.done;
    this.changed(owner);
    return { ...head, items };
  }
  async copyLegacy(id: string) {
    const owner = this.user();
    const db = await this.db();
    this.user();
    const p = await db.get('libPlaylists', id);
    if (!p) throw new Error('Playlist non trovata');
    const items = await db.getAllFromIndex('libPlaylistItems', 'byPlaylist', id);
    return this.insertCopy(
      owner,
      p.name,
      items.sort((a, b) => a.position - b.position).map((i) => ({ provider: 'local', trackId: i.trackId })),
    );
  }
  /** Stage every page first: interrupted/limited reads never create a misleading complete collection. */
  async copySpotify(
    name: string,
    accountId: string,
    page: (offset: number) => Promise<SpotifyPlaylistItemsDto>,
    signal?: AbortSignal,
  ) {
    const owner = this.user();
    const db = await this.db();
    const link = await db.get('hybridLinks', owner);
    if (link?.accountId !== accountId) throw new Error('Confermare il collegamento Spotify');
    const refs: MediaRef[] = [];
    let excluded = 0;
    let offset = 0;
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
    return {
      playlist: await this.insertCopy(owner, name, refs, { accountId, generation: link.generation }),
      excluded,
    };
  }
  async snapshot(): Promise<BackupHybridCollections> {
    const owner = this.user();
    const localIds = new Set(await (await this.db()).getAllKeys('libTracks'));
    if (this.user() !== owner) throw new Error('Account cambiato');
    return backupHybridCollectionsSchema.parse({
      version: 1,
      collections: (await this.list()).map(({ ownerId: _o, ...p }) => ({
        ...p,
        items: p.items
          .filter((i) => i.ref.provider !== 'local' || localIds.has(i.ref.trackId))
          .map(({ inert: _i, ...i }) => i),
      })),
    });
  }
  async restore(input: BackupHybridCollections, idMap: Map<string, string>) {
    const data = backupHybridCollectionsSchema.parse(input);
    const owner = this.user();
    const db = await this.db();
    if (this.user() !== owner) throw new Error('Account cambiato');
    const tx = db.transaction(['hybridPlaylists', 'hybridItems'], 'readwrite');
    void tx.done.catch(() => {});
    for (const p of data.collections) {
      if (await tx.objectStore('hybridPlaylists').get([owner, p.id])) continue;
      const { items, ...head } = p;
      await tx.objectStore('hybridPlaylists').put({ ...head, ownerId: owner });
      for (const [position, i] of items.entries()) {
        const ref =
          i.ref.provider === 'local'
            ? { provider: 'local' as const, trackId: idMap.get(i.ref.trackId) ?? i.ref.trackId }
            : i.ref;
        await tx.objectStore('hybridItems').put({
          ...i,
          ref,
          ownerId: owner,
          playlistId: p.id,
          position,
          ...(ref.provider === 'spotify' ? { inert: true } : {}),
        });
      }
    }
    await tx.done;
    this.changed(owner);
  }
  async purgeSpotify(accountId: string) {
    const owner = this.user();
    const db = await this.db();
    const tx = db.transaction(['hybridItems', 'hybridLinks'], 'readwrite');
    void tx.done.catch(() => {});
    const link = await tx.objectStore('hybridLinks').get(owner);
    if (link?.accountId === accountId)
      await tx
        .objectStore('hybridLinks')
        .put({ ownerId: owner, accountId: null, generation: link.generation + 1 });
    for (const i of await tx.objectStore('hybridItems').index('byOwner').getAll(owner))
      if (i.ref.provider === 'spotify' && i.spotifyAccountId === accountId)
        await tx.objectStore('hybridItems').delete([owner, i.playlistId, i.itemId]);
    await tx.done;
    this.changed(owner);
  }
  /** Called before exposing remote references after reconnect. Explicit consent reactivates restored refs. */
  async reconcile(accountId: string | null, generation: number, consent = false) {
    const owner = this.user();
    const db = await this.db();
    const tx = db.transaction(['hybridItems', 'hybridLinks'], 'readwrite');
    void tx.done.catch(() => {});
    const previous = await tx.objectStore('hybridLinks').get(owner);
    if (previous && generation < previous.generation) {
      await tx.done;
      return;
    }
    for (const i of await tx.objectStore('hybridItems').index('byOwner').getAll(owner)) {
      if (i.ref.provider !== 'spotify') continue;
      if (previous && (previous.accountId !== accountId || previous.generation !== generation) && !i.inert)
        await tx.objectStore('hybridItems').delete([owner, i.playlistId, i.itemId]);
      else if (consent && accountId === i.spotifyAccountId)
        await tx.objectStore('hybridItems').put({ ...i, inert: false });
    }
    await tx.objectStore('hybridLinks').put({ ownerId: owner, accountId, generation });
    await tx.done;
    this.changed(owner);
  }
}
