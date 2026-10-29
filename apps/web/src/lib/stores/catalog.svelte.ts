import type {
  AlbumDto,
  AlbumSort,
  AlbumSummaryDto,
  ApplyCandidateBody,
  CatalogSettingsDto,
  CreateAlbumBody,
  GenreDetailDto,
  GenreDto,
  TrackDto,
  UpdateAlbumBody,
} from '@spookyfy/shared';
import type { Api } from '../api';
import type { Library } from './library.svelte';

/**
 * Album, generi e impostazioni del catalogo: categorie separate dalle playlist.
 * Le modifiche che toccano i brani (copertina, album, generi) vengono propagate alle
 * altre liste e al player tramite la Libreria.
 */
export class Catalog {
  albums = $state<AlbumSummaryDto[] | null>(null);
  albumSort = $state<AlbumSort>('added');
  genres = $state<GenreDto[] | null>(null);
  details = $state<Record<string, AlbumDto>>({});
  settings = $state<CatalogSettingsDto | null>(null);

  constructor(
    private readonly api: Api,
    private readonly library: Library,
  ) {}

  async loadAlbums(sort: AlbumSort = this.albumSort): Promise<void> {
    this.albumSort = sort;
    this.albums = (await this.api.albums.list(sort)).items;
  }

  async loadAlbum(id: string): Promise<AlbumDto> {
    const a = await this.api.albums.get(id);
    this.details = { ...this.details, [id]: a };
    return a;
  }

  /** Dati cambiati in background (es. copertine trovate online): ricarica ciò che è già mostrato. */
  async refresh(): Promise<void> {
    if (this.albums) await this.loadAlbums().catch(() => {});
    for (const id of Object.keys(this.details)) {
      const a = await this.loadAlbum(id).catch(() => null);
      if (a) this.library.tracksChanged(a.tracks);
    }
  }

  async loadGenres(): Promise<void> {
    this.genres = (await this.api.genres.list()).items;
  }

  loadGenre(name: string): Promise<GenreDetailDto> {
    return this.api.genres.get(name);
  }

  async loadSettings(): Promise<CatalogSettingsDto> {
    this.settings = await this.api.settings.get();
    return this.settings;
  }

  async setCoverLookup(on: boolean): Promise<void> {
    this.settings = await this.api.settings.update({ coverLookup: on });
  }

  /** Album aggiornato: dettaglio, elenco e brani (copertina e campo album) ovunque nell'app. */
  private changed(a: AlbumDto): AlbumDto {
    this.details = { ...this.details, [a.id]: a };
    const { genres: _g, tracks: _t, ...summary } = a;
    if (this.albums)
      this.albums = this.albums.some((x) => x.id === a.id)
        ? this.albums.map((x) => (x.id === a.id ? summary : x))
        : [summary, ...this.albums];
    this.library.tracksChanged(a.tracks);
    return a;
  }

  private dropped(id: string): void {
    const { [id]: _removed, ...rest } = this.details;
    this.details = rest;
    this.albums = this.albums?.filter((a) => a.id !== id) ?? null;
  }

  async createAlbum(body: CreateAlbumBody): Promise<AlbumDto> {
    return this.changed(await this.api.albums.create(body));
  }

  async updateAlbum(id: string, body: UpdateAlbumBody): Promise<AlbumDto> {
    return this.changed(await this.api.albums.update(id, body));
  }

  async deleteAlbum(id: string): Promise<void> {
    const tracks = this.details[id]?.tracks ?? [];
    await this.api.albums.delete(id);
    this.dropped(id);
    this.library.tracksChanged(tracks.map((t) => ({ ...t, album: null, albumId: null })));
  }

  async addTracks(id: string, tracks: TrackDto[]): Promise<AlbumDto> {
    const before = new Set(tracks.map((t) => t.albumId).filter((x): x is string => !!x && x !== id));
    const a = this.changed(
      await this.api.albums.addTracks(
        id,
        tracks.map((t) => t.id),
      ),
    );
    // Gli album di provenienza perdono i brani (e quelli automatici vuoti spariscono).
    if (before.size) await this.loadAlbums().catch(() => {});
    for (const other of before)
      if (this.details[other]) await this.loadAlbum(other).catch(() => this.dropped(other));
    return a;
  }

  async removeTrack(id: string, track: TrackDto): Promise<AlbumDto | null> {
    const a = await this.api.albums.removeTrack(id, track.id);
    this.library.tracksChanged([await this.api.tracks.get(track.id)]);
    if (!a) {
      this.dropped(id);
      return null;
    }
    return this.changed(a);
  }

  /** Riordino ottimistico; in caso di errore si ricarica l'album. */
  async moveTrack(id: string, trackId: string, toIndex: number): Promise<void> {
    const d = this.details[id];
    if (d) {
      const tracks = [...d.tracks];
      const from = tracks.findIndex((t) => t.id === trackId);
      if (from >= 0) {
        const [moved] = tracks.splice(from, 1);
        tracks.splice(Math.min(toIndex, tracks.length), 0, moved!);
        this.details = { ...this.details, [id]: { ...d, tracks } };
      }
    }
    try {
      this.changed(await this.api.albums.moveTrack(id, trackId, toIndex));
    } catch (err) {
      await this.loadAlbum(id).catch(() => {});
      throw err;
    }
  }

  async setCover(id: string, image: Blob): Promise<AlbumDto> {
    return this.changed(await this.api.albums.setCover(id, image));
  }

  async removeCover(id: string): Promise<AlbumDto> {
    return this.changed(await this.api.albums.removeCover(id));
  }

  async applyCandidate(id: string, body: ApplyCandidateBody): Promise<AlbumDto> {
    const a = this.changed(await this.api.albums.applyCandidate(id, body));
    if (body.fields.genres) await this.loadGenres().catch(() => {});
    return a;
  }

  async updateAlbumGenres(id: string, change: { add?: string[]; remove?: string[] }): Promise<AlbumDto> {
    const a = this.changed(await this.api.albums.updateGenres(id, change));
    await this.loadGenres().catch(() => {});
    return a;
  }

  async setTrackGenres(track: TrackDto, genres: string[]): Promise<TrackDto> {
    const t = await this.api.genres.setForTrack(track.id, genres);
    this.library.tracksChanged([t]);
    if (t.albumId && this.details[t.albumId]) await this.loadAlbum(t.albumId).catch(() => {});
    await this.loadGenres().catch(() => {});
    return t;
  }

  /** Nomi dei generi in uso che iniziano con il testo digitato (per i suggerimenti). */
  suggestGenres(prefix: string, exclude: string[] = []): string[] {
    const p = prefix.trim().toLocaleLowerCase('it');
    const taken = new Set(exclude.map((g) => g.toLocaleLowerCase('it')));
    return (this.genres ?? [])
      .map((g) => g.name)
      .filter((n) => !taken.has(n.toLocaleLowerCase('it')) && (!p || n.toLocaleLowerCase('it').startsWith(p)))
      .slice(0, 8);
  }
}
