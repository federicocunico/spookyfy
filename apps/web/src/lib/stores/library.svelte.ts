import type {
  FavoriteDto,
  PlaylistDto,
  PlaylistSummaryDto,
  TrackDto,
  UpdateTrackBody,
} from '@spookyfy/shared';
import { type Api, ApiError } from '../api';
import { type Db, getMeta, setMeta } from '../offline/db';

/** Esegue `online`; se il server non è raggiungibile usa `offline` (snapshot locale). */
async function withFallback<T>(
  online: () => Promise<T>,
  offline: () => Promise<T | undefined>,
): Promise<T | undefined> {
  try {
    return await online();
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return offline();
    throw err;
  }
}

/**
 * Dati della libreria con cache in memoria (la vista si ridisegna subito con
 * l'ultimo valore noto) e snapshot in IndexedDB per la consultazione offline.
 */
export class Library {
  playlists = $state<PlaylistSummaryDto[] | null>(null);
  favorites = $state<FavoriteDto[] | null>(null);
  recent = $state<TrackDto[] | null>(null);
  recentlyAdded = $state<TrackDto[] | null>(null);
  details = $state<Record<string, PlaylistDto>>({});
  /** Ascoltatori di modifiche ai brani (es. il player aggiorna i metadati). */
  private trackListeners = new Set<(t: TrackDto) => void>();
  private removedListeners = new Set<(id: string) => void>();

  constructor(
    private readonly api: Api,
    private readonly db: () => Promise<Db>,
  ) {}

  private async saveTracks(tracks: TrackDto[]): Promise<void> {
    if (tracks.length === 0) return;
    const db = await this.db();
    const tx = db.transaction('tracks', 'readwrite');
    await Promise.all([...tracks.map((t) => tx.store.put($state.snapshot(t) as TrackDto)), tx.done]);
  }

  async loadPlaylists(): Promise<void> {
    const items = await withFallback(
      async () => {
        const { items } = await this.api.playlists.list();
        await setMeta(await this.db(), 'playlists', items);
        return items;
      },
      async () => getMeta(await this.db(), 'playlists'),
    );
    this.playlists = items ?? this.playlists ?? [];
  }

  async loadPlaylist(id: string): Promise<PlaylistDto | undefined> {
    const p = await withFallback(
      async () => {
        const p = await this.api.playlists.get(id);
        const db = await this.db();
        await db.put('playlists', p);
        await this.saveTracks(p.items.map((i) => i.track));
        return p;
      },
      async () => (await this.db()).get('playlists', id),
    );
    if (p) this.details = { ...this.details, [id]: p };
    return p;
  }

  async loadFavorites(): Promise<void> {
    const items = await withFallback(
      async () => {
        const { items } = await this.api.favorites.list();
        await setMeta(await this.db(), 'favorites', items);
        await this.saveTracks(items.map((f) => f.track));
        return items;
      },
      async () => getMeta(await this.db(), 'favorites'),
    );
    this.favorites = items ?? this.favorites ?? [];
  }

  async loadHome(): Promise<void> {
    const [recent, added] = await Promise.allSettled([
      this.api.plays.recent(12),
      this.api.tracks.list({ sort: 'added', limit: 20 }),
    ]);
    if (recent.status === 'fulfilled') this.recent = recent.value.items;
    else this.recent ??= [];
    if (added.status === 'fulfilled') this.recentlyAdded = added.value.items;
    else this.recentlyAdded ??= [];
    await this.loadPlaylists().catch(() => {});
  }

  /** Brani noti localmente, per id (per la vista Scaricati offline). */
  async knownTracks(ids: string[]): Promise<TrackDto[]> {
    const db = await this.db();
    const found = await Promise.all(ids.map((id) => db.get('tracks', id)));
    return found.filter((t): t is TrackDto => Boolean(t));
  }

  // ---------- aggiornamenti propagati a tutte le liste ----------

  onTrackChanged(listener: (t: TrackDto) => void): () => void {
    this.trackListeners.add(listener);
    return () => this.trackListeners.delete(listener);
  }

  onTrackRemoved(listener: (id: string) => void): () => void {
    this.removedListeners.add(listener);
    return () => this.removedListeners.delete(listener);
  }

  private patchTrack(id: string, patch: Partial<TrackDto>): void {
    const apply = (t: TrackDto) => (t.id === id ? { ...t, ...patch } : t);
    this.recent = this.recent?.map(apply) ?? null;
    this.recentlyAdded = this.recentlyAdded?.map(apply) ?? null;
    this.favorites = this.favorites?.map((f) => ({ ...f, track: apply(f.track) })) ?? null;
    this.details = Object.fromEntries(
      Object.entries(this.details).map(([k, p]) => [
        k,
        { ...p, items: p.items.map((i) => ({ ...i, track: apply(i.track) })) },
      ]),
    );
  }

  private emitChanged(track: TrackDto): void {
    this.patchTrack(track.id, track);
    void this.saveTracks([track]).catch(() => {});
    for (const l of this.trackListeners) l(track);
  }

  async setFavorite(track: TrackDto, favorite: boolean): Promise<void> {
    const before = this.favorites;
    const updated = { ...track, isFavorite: favorite };
    this.emitChanged(updated);
    if (this.favorites) {
      this.favorites = favorite
        ? [
            { track: updated, favoritedAt: Date.now() },
            ...this.favorites.filter((f) => f.track.id !== track.id),
          ]
        : this.favorites.filter((f) => f.track.id !== track.id);
    }
    try {
      if (favorite) await this.api.favorites.add(track.id);
      else await this.api.favorites.remove(track.id);
      if (this.favorites)
        await setMeta(await this.db(), 'favorites', $state.snapshot(this.favorites) as FavoriteDto[]);
    } catch (err) {
      this.favorites = before;
      this.emitChanged(track);
      throw err;
    }
  }

  async updateTrack(id: string, body: UpdateTrackBody): Promise<TrackDto> {
    const track = await this.api.tracks.update(id, body);
    this.emitChanged(track);
    return track;
  }

  async deleteTrack(id: string): Promise<void> {
    await this.api.tracks.delete(id);
    this.recent = this.recent?.filter((t) => t.id !== id) ?? null;
    this.recentlyAdded = this.recentlyAdded?.filter((t) => t.id !== id) ?? null;
    this.favorites = this.favorites?.filter((f) => f.track.id !== id) ?? null;
    this.details = Object.fromEntries(
      Object.entries(this.details).map(([k, p]) => [
        k,
        { ...p, items: p.items.filter((i) => i.track.id !== id) },
      ]),
    );
    for (const l of this.removedListeners) l(id);
    void this.loadPlaylists().catch(() => {});
  }

  // ---------- playlist ----------

  async createPlaylist(name: string): Promise<PlaylistDto> {
    const p = await this.api.playlists.create(name);
    this.details = { ...this.details, [p.id]: p };
    await this.loadPlaylists();
    return p;
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    const summary = await this.api.playlists.rename(id, name);
    const d = this.details[id];
    if (d) this.details = { ...this.details, [id]: { ...d, name: summary.name } };
    this.playlists = this.playlists?.map((p) => (p.id === id ? { ...p, name: summary.name } : p)) ?? null;
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.api.playlists.delete(id);
    const { [id]: _removed, ...rest } = this.details;
    this.details = rest;
    this.playlists = this.playlists?.filter((p) => p.id !== id) ?? null;
    await (await this.db()).delete('playlists', id).catch(() => {});
  }

  async addToPlaylist(id: string, track: TrackDto): Promise<void> {
    await this.api.playlists.addItem(id, track.id);
    if (this.details[id]) await this.loadPlaylist(id);
    await this.loadPlaylists();
  }

  async removeFromPlaylist(id: string, itemId: string): Promise<void> {
    const d = this.details[id];
    if (d)
      this.details = { ...this.details, [id]: { ...d, items: d.items.filter((i) => i.itemId !== itemId) } };
    try {
      await this.api.playlists.removeItem(id, itemId);
    } finally {
      await this.loadPlaylist(id).catch(() => {});
    }
    await this.loadPlaylists().catch(() => {});
  }

  /** Riordino ottimistico; in caso di errore si ricarica lo stato del server. */
  async moveItem(id: string, itemId: string, toIndex: number): Promise<void> {
    const d = this.details[id];
    if (d) {
      const items = [...d.items];
      const from = items.findIndex((i) => i.itemId === itemId);
      if (from >= 0) {
        const [moved] = items.splice(from, 1);
        items.splice(Math.min(toIndex, items.length), 0, moved!);
        this.details = { ...this.details, [id]: { ...d, items } };
      }
    }
    try {
      const updated = await this.api.playlists.moveItem(id, itemId, toIndex);
      this.details = { ...this.details, [id]: updated };
      await (await this.db()).put('playlists', updated);
    } catch (err) {
      await this.loadPlaylist(id).catch(() => {});
      throw err;
    }
  }
}
