import type {
  FavoriteDto,
  MeDto,
  PlayEvent,
  PlaylistDto,
  PlaylistSummaryDto,
  TrackDto,
} from '@spookyfy/shared';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export interface DownloadRecord {
  trackId: string;
  sizeBytes: number;
  downloadedAt: number;
}

export interface QueuedDownload {
  trackId: string;
  enqueuedAt: number;
  /** Raggruppa i brani di uno stesso "scarica playlist". */
  batchId: string;
}

export interface MetaValues {
  user: MeDto;
  favorites: FavoriteDto[];
  playlists: PlaylistSummaryDto[];
  persisted: boolean;
}

export interface SpookyfyDB extends DBSchema {
  /** Metadati dei brani noti (scaricati o presenti in liste salvate offline). */
  tracks: { key: string; value: TrackDto };
  downloads: { key: string; value: DownloadRecord };
  /** Ultimo dettaglio caricato online di ogni playlist. */
  playlists: { key: string; value: PlaylistDto };
  meta: { key: keyof MetaValues; value: MetaValues[keyof MetaValues] };
  pendingPlays: { key: string; value: PlayEvent };
  downloadQueue: { key: string; value: QueuedDownload; indexes: { byEnqueued: number } };
}

export const DB_NAME = 'spookyfy';
export const DB_VERSION = 1;

export type Db = IDBPDatabase<SpookyfyDB>;

/**
 * Migrazioni per versione: ognuna porta lo schema dalla versione precedente alla
 * successiva, così un client fermo a una versione vecchia si aggiorna per gradi.
 */
export const MIGRATIONS: Record<number, (db: IDBPDatabase<SpookyfyDB>) => void> = {
  1: (db) => {
    db.createObjectStore('tracks', { keyPath: 'id' });
    db.createObjectStore('downloads', { keyPath: 'trackId' });
    db.createObjectStore('playlists', { keyPath: 'id' });
    db.createObjectStore('meta');
    db.createObjectStore('pendingPlays', { keyPath: 'id' });
    const queue = db.createObjectStore('downloadQueue', { keyPath: 'trackId' });
    queue.createIndex('byEnqueued', 'enqueuedAt');
  },
};

export function openSpookyfyDb(name = DB_NAME, version = DB_VERSION): Promise<Db> {
  return openDB<SpookyfyDB>(name, version, {
    upgrade(db, oldVersion, newVersion) {
      for (let v = oldVersion + 1; v <= (newVersion ?? version); v++) MIGRATIONS[v]?.(db);
    },
    blocking(_current, _blocked, event) {
      // Un'altra scheda chiede una versione più nuova: chiudiamo per non bloccarla.
      (event.target as IDBDatabase).close();
    },
  });
}

let dbPromise: Promise<Db> | undefined;
export function getDb(): Promise<Db> {
  dbPromise ??= openSpookyfyDb();
  return dbPromise;
}

export async function getMeta<K extends keyof MetaValues>(
  db: Db,
  key: K,
): Promise<MetaValues[K] | undefined> {
  return (await db.get('meta', key)) as MetaValues[K] | undefined;
}

export async function setMeta<K extends keyof MetaValues>(
  db: Db,
  key: K,
  value: MetaValues[K],
): Promise<void> {
  await db.put('meta', value, key);
}

/** Cancella i dati personali dell'utente (al logout); i download restano. */
export async function clearPersonalData(db: Db): Promise<void> {
  const tx = db.transaction(['playlists', 'meta', 'pendingPlays'], 'readwrite');
  await Promise.all([
    tx.objectStore('playlists').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('pendingPlays').clear(),
    tx.done,
  ]);
}
