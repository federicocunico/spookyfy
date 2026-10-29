import { z } from 'zod';

/** Formato del backup della libreria in modalità client (ZIP con JSON e copertine). */
export const BACKUP_FORMAT = 'spookyfy-backup';
export const BACKUP_VERSION = 1;
/** Dimensione massima di una parte audio del backup. */
export const BACKUP_AUDIO_PART_BYTES = 300 * 1024 * 1024;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const backupTrackSchema = z.object({
  id: z.string().min(1).max(64),
  /** `youtube:<id>` oppure `file:<hash>`: chiave di deduplicazione fra dispositivi. */
  sourceKey: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  artist: z.string().min(1).max(300),
  album: z.string().max(300).nullable(),
  durationMs: z.number().int().nonnegative(),
  /** Auto-trim già calcolato (assente nei backup precedenti: si ricalcola). */
  trimStartMs: z.number().int().nonnegative().optional(),
  trimEndMs: z.number().int().nonnegative().optional(),
  silenceChecked: z.boolean().optional(),
  /** Generi del brano (assenti nei backup precedenti agli album). */
  genres: z.array(z.string().min(1).max(40)).max(10).optional(),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(100),
  dominantColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  addedAt: z.number().int().nonnegative(),
  /** Percorso della copertina nello ZIP dei metadati. */
  cover: z.string().max(200).nullable(),
  /** Parte audio che contiene il file, o null se il backup è senza audio. */
  audioPart: z.number().int().positive().nullable(),
});
export type BackupTrack = z.infer<typeof backupTrackSchema>;

export const backupAlbumSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(300),
  year: z.number().int().nullable(),
  origin: z.enum(['auto', 'manual']),
  /** Ricerca automatica della copertina già eseguita. */
  lookupDone: z.boolean(),
  /** Percorso della copertina assegnata nello ZIP dei metadati, o null. */
  cover: z.string().max(200).nullable(),
  coverColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  addedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** Id dei brani nell'ordine dell'album. */
  trackIds: z.array(z.string()),
});
export type BackupAlbum = z.infer<typeof backupAlbumSchema>;

export const backupLibrarySchema = z.object({
  tracks: z.array(backupTrackSchema),
  favorites: z.array(z.object({ trackId: z.string(), createdAt: z.number().int() })),
  playlists: z.array(
    z.object({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(100),
      createdAt: z.number().int(),
      updatedAt: z.number().int(),
      /** Id dei brani nell'ordine della playlist (duplicati ammessi). */
      trackIds: z.array(z.string()),
    }),
  ),
  plays: z.array(
    z.object({ id: z.string().min(1).max(64), trackId: z.string(), playedAt: z.number().int() }),
  ),
  /** Album (assenti nei backup precedenti: i brani si raggruppano dal campo album). */
  albums: z.array(backupAlbumSchema).optional(),
});
export type BackupLibrary = z.infer<typeof backupLibrarySchema>;

export const backupManifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION, {
    errorMap: () => ({ message: 'Versione del backup non supportata' }),
  }),
  exportedAt: z.number().int(),
  appVersion: z.string().max(50),
  counts: z.object({
    tracks: z.number().int().nonnegative(),
    playlists: z.number().int().nonnegative(),
    favorites: z.number().int().nonnegative(),
    plays: z.number().int().nonnegative(),
    albums: z.number().int().nonnegative().optional(),
  }),
  /** Hash di `library.json`: rileva file troncati o modificati. */
  librarySha256: sha256,
  audioParts: z.array(
    z.object({
      index: z.number().int().positive(),
      fileName: z.string().min(1).max(200),
      trackIds: z.array(z.string()),
      bytes: z.number().int().nonnegative(),
    }),
  ),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;
