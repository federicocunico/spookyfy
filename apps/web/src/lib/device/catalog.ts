import {
  type AlbumDto,
  type ApplyCandidateBody,
  type CatalogSettingsDto,
  ErrorCode,
  GENRE_NAME_MAX,
  isConfidentMatch,
} from '@spookyfy/shared';
import { ApiError } from '../api';
import type { Db } from '../offline/db';
import type { DeviceLibrary } from './library';
import type { GatewayClient } from './remote';
import { getSettings, patchSettings } from './settings';

/** Impostazioni del catalogo sul dispositivo (la ricerca online passa dal gateway). */
export async function catalogSettings(db: Db): Promise<CatalogSettingsDto> {
  return { coverLookup: (await getSettings(db)).coverLookup !== false, coverLookupLocked: false };
}

export async function updateCatalogSettings(
  db: Db,
  patch: { coverLookup: boolean },
): Promise<CatalogSettingsDto> {
  await patchSettings(db, { coverLookup: patch.coverLookup });
  return catalogSettings(db);
}

export async function ensureLookupEnabled(db: Db): Promise<void> {
  if (!(await catalogSettings(db)).coverLookup)
    throw new ApiError(409, ErrorCode.LookupDisabled, 'La ricerca online di copertine è disattivata');
}

/** Applica a un album del dispositivo la copertina di un candidato e, a scelta, gli altri campi. */
export async function applyCandidateOnDevice(
  library: DeviceLibrary,
  gateway: GatewayClient,
  albumId: string,
  { candidate: c, fields }: ApplyCandidateBody,
): Promise<AlbumDto> {
  const image = await gateway.lookupImage(c.coverUrl);
  await library.setAlbumCover(albumId, image);
  const patch = {
    ...(fields.title ? { title: c.title.slice(0, 200) } : {}),
    ...(fields.artist ? { artist: c.artist } : {}),
    ...(fields.year && c.year !== null ? { year: c.year } : {}),
  };
  if (Object.keys(patch).length > 0) await library.updateAlbum(albumId, patch);
  const genres = c.genres.filter((g) => g.length <= GENRE_NAME_MAX);
  if (fields.genres && genres.length > 0) await library.updateAlbumGenres(albumId, genres);
  return library.getAlbum(albumId);
}

/** Errori di fila dopo i quali la ricerca automatica si ferma fino alla prossima apertura. */
const MAX_FAILURES = 3;

/**
 * Ricerca automatica delle copertine per gli album senza: dal più recente, uno alla volta,
 * solo con corrispondenza sicura e solo la copertina; ogni album una volta. Gli errori di
 * rete lasciano l'album da cercare. Restituisce le copertine applicate e se si è fermata.
 */
export async function runCoverLookupBacklog(
  library: DeviceLibrary,
  gateway: GatewayClient,
  signal: AbortSignal,
): Promise<{ applied: number; halted: boolean }> {
  const failed: string[] = [];
  let failures = 0;
  let applied = 0;
  while (!signal.aborted && failures < MAX_FAILURES) {
    const album = library.nextPendingLookup(failed);
    if (!album) break;
    try {
      const { items } = await gateway.lookupAlbums({ album: album.title, artist: album.artist }, signal);
      let done = false;
      for (const c of items.filter((c) => isConfidentMatch(album, c))) {
        let image: Blob;
        try {
          image = await gateway.lookupImage(c.coverUrl, signal);
        } catch (err) {
          // Copertina assente per quel candidato: si prova il successivo.
          if (err instanceof ApiError && !err.isNetwork && err.status < 500) continue;
          throw err;
        }
        await library.setAlbumCover(album.id, image);
        applied++;
        done = true;
        break;
      }
      if (!done) await library.markLookupDone(album.id);
      failures = 0;
    } catch {
      if (signal.aborted) break;
      failed.push(album.id);
      failures++;
    }
  }
  return { applied, halted: failures >= MAX_FAILURES };
}

/** La ricerca automatica parte poco dopo l'avvio, per non rallentarlo, e a ogni nuovo album. */
export const COVER_LOOKUP_DELAY_MS = 8000;
const NEW_ALBUM_DELAY_MS = 1000;

/**
 * Pianifica la ricerca automatica delle copertine sul dispositivo; `onApplied` riceve il
 * numero di copertine applicate (per aggiornare la coda del player). Restituisce lo stop.
 */
export function scheduleCoverLookup(
  library: DeviceLibrary,
  gateway: GatewayClient,
  opts: { enabled: () => Promise<boolean>; onApplied?: (n: number) => void; delayMs?: number },
): () => void {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let halted = false;
  const run = async () => {
    timer = null;
    if (abort.signal.aborted || halted) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (!(await opts.enabled().catch(() => false))) return;
      const r = await runCoverLookupBacklog(library, gateway, abort.signal);
      halted = r.halted;
      if (r.applied) opts.onApplied?.(r.applied);
    } finally {
      running = false;
      if (again && !halted && !abort.signal.aborted) {
        again = false;
        void run();
      }
    }
  };
  const later = (ms: number) => {
    if (timer === null && !abort.signal.aborted) timer = setTimeout(run, ms);
  };
  later(opts.delayMs ?? COVER_LOOKUP_DELAY_MS);
  library.onAlbumCreated = () => later(NEW_ALBUM_DELAY_MS);
  return () => {
    abort.abort();
    if (timer !== null) clearTimeout(timer);
    library.onAlbumCreated = null;
  };
}
