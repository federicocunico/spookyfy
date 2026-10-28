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
