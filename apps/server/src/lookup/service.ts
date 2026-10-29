import {
  type AlbumDto,
  type AlbumLookup,
  type ApplyCandidateBody,
  type CatalogSettingsDto,
  CoverImageError,
  ErrorCode,
  type FetchedImage,
  type LookupCandidateDto,
  LookupError,
  type LookupQuery,
  isConfidentMatch,
} from '@spookyfy/shared';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { HttpError } from '../http-errors.js';
import type { AlbumService } from '../library/albums.js';
import type { GenreService } from '../library/genres.js';

const COVER_LOOKUP_KEY = 'cover_lookup';
/** Errori di fila dopo i quali la ricerca automatica si ferma fino al prossimo avvio. */
const MAX_FAILURES = 3;

/** Impostazioni del server: valgono per tutti gli account, come il catalogo. */
export class SettingsService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly forcedOff: boolean,
  ) {}

  get(): CatalogSettingsDto {
    const row = this.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(COVER_LOOKUP_KEY) as
      | { value: string }
      | undefined;
    return { coverLookup: !this.forcedOff && row?.value !== 'false', coverLookupLocked: this.forcedOff };
  }

  set(patch: { coverLookup: boolean }): CatalogSettingsDto {
    if (this.forcedOff && patch.coverLookup)
      throw new HttpError(
        409,
        ErrorCode.LookupDisabled,
        'La ricerca online è disattivata dalla configurazione del server',
      );
    this.sqlite
      .prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(COVER_LOOKUP_KEY, String(patch.coverLookup));
    return this.get();
  }
}

export interface CoverLookupOptions {
  albums: AlbumService;
  genres: GenreService;
  settings: SettingsService;
  lookup: AlbumLookup;
  fetchImage: (url: string, signal?: AbortSignal) => Promise<FetchedImage>;
  log: FastifyBaseLogger;
}

/**
 * Ricerca online di copertine e metadati: su richiesta dell'utente e, in background,
 * per gli album nuovi senza copertina (solo con corrispondenza sicura, una volta per album).
 */
export class CoverLookupService {
  private started = false;
  private halted = false;
  private run: { abort: AbortController; done: Promise<void> } | null = null;

  constructor(private readonly o: CoverLookupOptions) {}

  private ensureEnabled(): void {
    if (!this.o.settings.get().coverLookup)
      throw new HttpError(409, ErrorCode.LookupDisabled, 'La ricerca online di copertine è disattivata');
  }

  async search(q: LookupQuery): Promise<LookupCandidateDto[]> {
    this.ensureEnabled();
    try {
      return await this.o.lookup.search(q);
    } catch (err) {
      if (err instanceof LookupError) throw unavailable();
      throw err;
    }
  }

  /** Immagine di un candidato, per il proxy verso il client (stessa origine dell'app). */
  async image(url: string): Promise<FetchedImage> {
    this.ensureEnabled();
    return this.fetchImage(url);
  }

  /** Applica a un album la copertina di un candidato e, a scelta, titolo, artista, anno e generi. */
  async apply(userId: string, albumId: string, body: ApplyCandidateBody): Promise<AlbumDto> {
    this.ensureEnabled();
    const { candidate: c, fields } = body;
    const img = await this.fetchImage(c.coverUrl);
    await this.o.albums.setCover(userId, albumId, Buffer.from(img.bytes));
    const patch = {
      ...(fields.title ? { title: c.title.slice(0, 200) } : {}),
      ...(fields.artist ? { artist: c.artist } : {}),
      ...(fields.year && c.year !== null ? { year: c.year } : {}),
    };
    if (Object.keys(patch).length > 0) this.o.albums.update(userId, albumId, patch);
    if (fields.genres && c.genres.length > 0)
      this.o.genres.updateAlbumGenres(
        albumId,
        c.genres.filter((g) => g.length <= 40),
        [],
      );
    return this.o.albums.get(userId, albumId);
  }

  private async fetchImage(url: string): Promise<FetchedImage> {
    try {
      return await this.o.fetchImage(url);
    } catch (err) {
      if (!(err instanceof CoverImageError)) throw err;
      if (err.reason === 'not_allowed')
        throw new HttpError(400, ErrorCode.ValidationFailed, 'Indirizzo non consentito');
      if (err.reason === 'unavailable') throw unavailable();
      throw new HttpError(422, ErrorCode.InvalidImage, 'La copertina scelta non è disponibile');
    }
  }

  // ---------- ricerca automatica ----------

  start(): void {
    this.started = true;
    this.halted = false;
    this.kick();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.run?.abort.abort();
    await this.run?.done;
  }

  /** Avvia la ricerca automatica, se non è già in corso (es. dopo la creazione di un album). */
  kick(): void {
    if (!this.started || this.halted || this.run || !this.o.settings.get().coverLookup) return;
    const abort = new AbortController();
    this.run = {
      abort,
      done: this.backlog(abort.signal)
        .then(() => {})
        .catch((err) => this.o.log.error({ err }, 'ricerca automatica delle copertine interrotta'))
        .finally(() => {
          this.run = null;
        }),
    };
  }

  /** Attende la fine della ricerca automatica in corso (test). */
  async idle(): Promise<void> {
    while (this.run) await this.run.done;
  }

  /** Restituisce il numero di copertine applicate. */
  async backlog(signal: AbortSignal): Promise<number> {
    const failed: string[] = [];
    let failures = 0;
    let applied = 0;
    while (!signal.aborted && failures < MAX_FAILURES && this.o.settings.get().coverLookup) {
      const album = this.o.albums.nextPendingLookup(failed);
      if (!album) break;
      try {
        if (await this.autoApply(album, signal)) applied++;
        failures = 0;
      } catch {
        if (signal.aborted) break;
        failed.push(album.id);
        failures++;
      }
    }
    if (failures >= MAX_FAILURES) {
      this.halted = true;
      this.o.log.warn(
        'ricerca automatica delle copertine sospesa: servizi non raggiungibili, si riprova al riavvio',
      );
    }
    if (applied) this.o.log.info({ albums: applied }, 'copertine trovate online');
    return applied;
  }

  private async autoApply(album: { id: string; title: string; artist: string }, signal: AbortSignal) {
    const candidates = await this.o.lookup.search({ album: album.title, artist: album.artist }, signal);
    for (const c of candidates.filter((c) => isConfidentMatch(album, c))) {
      let img: FetchedImage;
      try {
        img = await this.o.fetchImage(c.coverUrl, signal);
      } catch (err) {
        // Copertina assente per quel candidato: si prova il successivo.
        if (err instanceof CoverImageError && err.reason !== 'unavailable') continue;
        throw err;
      }
      if (!this.o.albums.exists(album.id)) return false;
      await this.o.albums.setCover('', album.id, Buffer.from(img.bytes));
      return true;
    }
    this.o.albums.markLookupDone(album.id);
    return false;
  }
}

const unavailable = () =>
  new HttpError(
    503,
    ErrorCode.LookupUnavailable,
    'Ricerca online non disponibile al momento, riprova più tardi',
  );
