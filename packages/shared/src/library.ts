import { z } from 'zod';

export type CoverSize = 512 | 128;

export const trackAudioUrl = (trackId: string) => `/api/tracks/${encodeURIComponent(trackId)}/audio`;
export const trackCoverUrl = (trackId: string, size: CoverSize = 512) =>
  `/api/tracks/${encodeURIComponent(trackId)}/cover?size=${size}`;

/** Un brano del catalogo condiviso, con i dati personali dell'utente che lo richiede. */
export interface TrackDto {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string | null;
  /** Album del catalogo a cui appartiene il brano (il campo `album` ne riporta il titolo). */
  albumId: string | null;
  /** Generi del brano, nella grafia in uso in libreria. */
  genres: string[];
  durationMs: number;
  /** Auto-trim (vedi silence.ts): la riproduzione parte da qui, saltando il silenzio iniziale. */
  trimStartMs?: number;
  /** Auto-trim: la riproduzione finisce qui, saltando il silenzio finale. */
  trimEndMs?: number;
  sizeBytes: number;
  /** Colore dominante della copertina (quella dell'album, se assegnata), `#rrggbb`. */
  dominantColor: string;
  addedAt: number;
  audioUrl: string;
  coverUrl: string;
  coverThumbUrl: string;
  isFavorite: boolean;
  playCount: number;
  lastPlayedAt: number | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const trackSortSchema = z.enum(['added', 'title', 'artist']);
export type TrackSort = z.infer<typeof trackSortSchema>;

export const listTracksQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: trackSortSchema.default('added'),
  q: z.string().trim().max(200, 'La ricerca può avere al massimo 200 caratteri').optional(),
});
export type ListTracksQuery = z.infer<typeof listTracksQuerySchema>;

const metadataText = (label: string) =>
  z.string().trim().min(1, `${label} non può essere vuoto`).max(300, `${label} è troppo lungo`);

export const updateTrackBodySchema = z
  .object({
    title: metadataText('Il titolo').optional(),
    artist: metadataText("L'artista").optional(),
    album: z.string().trim().max(300, "L'album è troppo lungo").nullable().optional(),
  })
  .refine((b) => b.title !== undefined || b.artist !== undefined || b.album !== undefined, {
    message: 'Nessuna modifica indicata',
  });
export type UpdateTrackBody = z.infer<typeof updateTrackBodySchema>;

export interface FavoriteDto {
  track: TrackDto;
  favoritedAt: number;
}

export const PLAYLIST_NAME_MAX = 100;
export const playlistNameSchema = z
  .string({ required_error: 'Il nome è obbligatorio' })
  .trim()
  .min(1, 'Il nome non può essere vuoto')
  .max(PLAYLIST_NAME_MAX, `Il nome può avere al massimo ${PLAYLIST_NAME_MAX} caratteri`);

export const playlistNameBodySchema = z.object({ name: playlistNameSchema });
export const addPlaylistItemBodySchema = z.object({ trackId: z.string().min(1).max(64) });
export const movePlaylistItemBodySchema = z.object({ toIndex: z.number().int().min(0) });

export interface PlaylistSummaryDto {
  id: string;
  name: string;
  trackCount: number;
  durationMs: number;
  /** Fino a 4 brani per il collage della copertina. */
  coverTrackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistItemDto {
  itemId: string;
  addedAt: number;
  track: TrackDto;
}

export interface PlaylistDto extends PlaylistSummaryDto {
  items: PlaylistItemDto[];
}

export const playEventSchema = z.object({
  /** Generato dal client: rende idempotente il reinvio. */
  id: z.string().uuid(),
  trackId: z.string().min(1).max(64),
  playedAt: z.number().int().positive(),
});
export type PlayEvent = z.infer<typeof playEventSchema>;

export const submitPlaysBodySchema = z.object({ plays: z.array(playEventSchema).min(1).max(500) });

export interface SubmitPlaysResult {
  /** Ascolti nuovi registrati. */
  recorded: number;
  /** Duplicati o riferiti a brani non più presenti. */
  ignored: number;
}

/** Soglia per contare un ascolto: 30 s, o metà durata se il brano è più corto di 60 s. */
export function playThresholdMs(durationMs: number): number {
  return Math.min(30_000, durationMs / 2);
}
