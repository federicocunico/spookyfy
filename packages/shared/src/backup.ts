import { z } from 'zod';
import { mediaRefSchema } from './providers.js';

/** Portable references only; remote metadata and credentials are deliberately excluded. */
export const backupHybridCollectionsSchema = z
  .object({
    version: z.literal(1),
    collections: z.array(
      z
        .object({
          id: z.string().min(1).max(64),
          name: z.string().trim().min(1).max(100),
          createdAt: z.number().int().nonnegative(),
          updatedAt: z.number().int().nonnegative(),
          items: z.array(
            z
              .object({
                itemId: z.string().min(1).max(64),
                ref: mediaRefSchema,
                addedAt: z.number().int().nonnegative(),
                spotifyAccountId: z.string().min(1).max(256).optional(),
              })
              .strict()
              .superRefine((item, ctx) => {
                if ((item.ref.provider === 'spotify') !== Boolean(item.spotifyAccountId))
                  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid remote account reference' });
              }),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.collections.map((p) => p.id)).size !== value.collections.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate collection ID' });
    for (const p of value.collections)
      if (new Set(p.items.map((i) => i.itemId)).size !== p.items.length)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate occurrence ID' });
  });
export type BackupHybridCollections = z.infer<typeof backupHybridCollectionsSchema>;

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

export const backupLibrarySchema = z
  .object({
    hybridCollections: backupHybridCollectionsSchema.optional(),
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
  })
  .superRefine((library, ctx) => {
    const tracks = new Set(library.tracks.map((track) => track.id));
    for (const collection of library.hybridCollections?.collections ?? [])
      for (const item of collection.items)
        if (item.ref.provider === 'local' && !tracks.has(item.ref.trackId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Hybrid collection references an absent local track',
          });
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
