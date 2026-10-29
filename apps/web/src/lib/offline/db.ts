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

/** Brano della libreria sul dispositivo (modalità client). */
export interface LocalTrackRecord {
  id: string;
  /** `youtube:<id>` o `file:<hash>`: deduplicazione fra importazioni e dispositivi. */
  sourceKey: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  /** Auto-trim (vedi @spookyfy/shared, silence.ts): assenti = brano riprodotto per intero. */
  trimStartMs?: number;
  trimEndMs?: number;
  /** Silenzio ai bordi già analizzato; i brani senza vengono analizzati in background. */
  silenceChecked?: boolean;
  sizeBytes: number;
  mimeType: string;
  dominantColor: string;
  addedAt: number;
  /** Il file è stato eliminato dal sistema: il brano va riscaricato. */
  lost?: boolean;
}

export interface LocalPlaylistRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalPlaylistItemRecord {
  id: string;
  playlistId: string;
  trackId: string;
  position: number;
  addedAt: number;
}

export type ImportKind = 'youtube' | 'bridge' | 'redownload';

/** Importazione in coda sul dispositivo (persistente: riprende dopo la chiusura dell'app). */
export interface ImportRecord {
  id: string;
  kind: ImportKind;
  sourceId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  error: string | null;
  errorCode: string | null;
  trackId: string | null;
  /** Brano da sostituire (riscaricamento di un brano perso). */
  replaceTrackId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceSettings {
  bridge: { url: string; token: string } | null;
  lastBackupAt: number | null;
  addedSinceBackup: number;
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
  // v2: libreria sul dispositivo (modalità client).
  libTracks: { key: string; value: LocalTrackRecord; indexes: { bySourceKey: string; byAddedAt: number } };
  libFavorites: { key: string; value: { trackId: string; createdAt: number } };
  libPlaylists: { key: string; value: LocalPlaylistRecord };
  libPlaylistItems: {
    key: string;
    value: LocalPlaylistItemRecord;
    indexes: { byPlaylist: string; byTrack: string };
  };
  libPlays: { key: string; value: PlayEvent; indexes: { byTrack: string; byPlayedAt: number } };
  imports: { key: string; value: ImportRecord; indexes: { byCreatedAt: number } };
  settings: { key: 'device'; value: DeviceSettings };
}

export const DB_NAME = 'spookyfy';
export const DB_VERSION = 2;

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
  // Aggiunta non distruttiva: in modalità on-premise questi store restano vuoti.
  2: (db) => {
    const tracks = db.createObjectStore('libTracks', { keyPath: 'id' });
    tracks.createIndex('bySourceKey', 'sourceKey', { unique: true });
    tracks.createIndex('byAddedAt', 'addedAt');
    db.createObjectStore('libFavorites', { keyPath: 'trackId' });
    db.createObjectStore('libPlaylists', { keyPath: 'id' });
    const items = db.createObjectStore('libPlaylistItems', { keyPath: 'id' });
    items.createIndex('byPlaylist', 'playlistId');
    items.createIndex('byTrack', 'trackId');
    const plays = db.createObjectStore('libPlays', { keyPath: 'id' });
    plays.createIndex('byTrack', 'trackId');
    plays.createIndex('byPlayedAt', 'playedAt');
    const imports = db.createObjectStore('imports', { keyPath: 'id' });
    imports.createIndex('byCreatedAt', 'createdAt');
    db.createObjectStore('settings');
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
