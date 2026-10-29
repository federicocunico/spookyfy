import { z } from 'zod';
import type { CoverSize, TrackDto } from './library.js';

/**
 * Album e generi: categorie del catalogo separate dalle playlist. Un brano appartiene al
 * massimo a un album; può avere più generi.
 */

/** Forma di confronto di titoli, artisti e generi: senza accenti, maiuscole e spazi superflui. */
export function albumKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export const genreKey = albumKey;

export const ALBUM_TITLE_MAX = 200;
export const ALBUM_ARTIST_MAX = 300;
export const ALBUM_YEAR_MIN = 1000;
export const ALBUM_YEAR_MAX = 2100;
/** Artista di un album creato a mano senza indicarne uno. */
export const ALBUM_DEFAULT_ARTIST = 'Artisti vari';
export const GENRE_NAME_MAX = 40;
export const GENRES_PER_TRACK_MAX = 10;
/** Dimensione massima di un'immagine caricata come copertina. */
export const ALBUM_COVER_MAX_BYTES = 10 * 1024 * 1024;
export const ALBUM_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AlbumOrigin = 'auto' | 'manual';

export const albumCoverUrl = (albumId: string, size: CoverSize, version: number) =>
  `/api/albums/${encodeURIComponent(albumId)}/cover?size=${size}&v=${version}`;
export const albumPath = (albumId: string) => `/album/${encodeURIComponent(albumId)}`;
export const genrePath = (name: string) => `/genre/${encodeURIComponent(name)}`;

export interface AlbumSummaryDto {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  origin: AlbumOrigin;
  trackCount: number;
  durationMs: number;
  /** Copertina assegnata o, in sua assenza, quella del primo brano. */
  coverUrl: string;
  coverThumbUrl: string;
  dominantColor: string;
  /** True se la copertina è stata assegnata (dal dispositivo o dalla ricerca online). */
  hasCustomCover: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface AlbumDto extends AlbumSummaryDto {
  /** Generi presenti in tutti i brani dell'album. */
  genres: string[];
  tracks: TrackDto[];
}

export interface GenreDto {
  name: string;
  trackCount: number;
}

export interface GenreDetailDto extends GenreDto {
  tracks: TrackDto[];
  /** Album che hanno il genere su tutti i brani. */
  albums: AlbumSummaryDto[];
}

export const albumSortSchema = z.enum(['added', 'title', 'artist']);
export type AlbumSort = z.infer<typeof albumSortSchema>;

export const albumTitleSchema = z
  .string({ required_error: 'Il titolo è obbligatorio' })
  .trim()
  .min(1, 'Il titolo non può essere vuoto')
  .max(ALBUM_TITLE_MAX, `Il titolo può avere al massimo ${ALBUM_TITLE_MAX} caratteri`);
export const albumArtistSchema = z
  .string()
  .trim()
  .min(1, "L'artista non può essere vuoto")
  .max(ALBUM_ARTIST_MAX, "L'artista è troppo lungo");
export const albumYearSchema = z
  .number({ invalid_type_error: "L'anno deve essere un numero" })
  .int("L'anno deve essere un numero intero")
  .min(ALBUM_YEAR_MIN, `L'anno deve essere fra ${ALBUM_YEAR_MIN} e ${ALBUM_YEAR_MAX}`)
  .max(ALBUM_YEAR_MAX, `L'anno deve essere fra ${ALBUM_YEAR_MIN} e ${ALBUM_YEAR_MAX}`);

export const listAlbumsQuerySchema = z.object({
  sort: albumSortSchema.default('added'),
  q: z.string().trim().max(200).optional(),
});

export const createAlbumBodySchema = z.object({
  title: albumTitleSchema,
  artist: albumArtistSchema.optional(),
  year: albumYearSchema.nullable().optional(),
});
export type CreateAlbumBody = z.infer<typeof createAlbumBodySchema>;

export const updateAlbumBodySchema = z
  .object({
    title: albumTitleSchema.optional(),
    artist: albumArtistSchema.optional(),
    year: albumYearSchema.nullable().optional(),
  })
  .refine((b) => b.title !== undefined || b.artist !== undefined || b.year !== undefined, {
    message: 'Nessuna modifica indicata',
  });
export type UpdateAlbumBody = z.infer<typeof updateAlbumBodySchema>;

export const addAlbumTracksBodySchema = z.object({
  trackIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  /** Posizione d'inserimento; assente = in coda. */
  toIndex: z.number().int().min(0).optional(),
});
export const moveAlbumTrackBodySchema = z.object({ toIndex: z.number().int().min(0) });

export const genreNameSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Il genere non può essere vuoto')
      .max(GENRE_NAME_MAX, `Un genere può avere al massimo ${GENRE_NAME_MAX} caratteri`),
  );
export const trackGenresBodySchema = z.object({
  genres: z
    .array(genreNameSchema)
    .max(GENRES_PER_TRACK_MAX, `Un brano può avere al massimo ${GENRES_PER_TRACK_MAX} generi`),
});
export const albumGenresBodySchema = z
  .object({
    add: z.array(genreNameSchema).max(GENRES_PER_TRACK_MAX).optional(),
    remove: z.array(genreNameSchema).max(GENRES_PER_TRACK_MAX).optional(),
  })
  .refine((b) => (b.add?.length ?? 0) + (b.remove?.length ?? 0) > 0, {
    message: 'Nessuna modifica indicata',
  });

/**
 * Generi letti dai tag di un file: valori multipli separati da `;`, `,` o NUL, codici
 * numerici ID3 (`(17)`, `17`) scartati, nomi non validi ignorati, al massimo 10.
 */
export function splitGenres(raw: string | readonly string[] | null | undefined): string[] {
  const values = raw == null ? [] : typeof raw === 'string' ? [raw] : raw;
  const out: string[] = [];
  for (const v of values) {
    // ID3v2.4 separa i valori multipli con NUL.
    for (const part of v.replaceAll(String.fromCharCode(0), ';').split(/[;,]/)) {
      const name = part
        .replace(/^(\(\d+\))+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!name || /^\d+$/.test(name) || name.length > GENRE_NAME_MAX) continue;
      out.push(name);
    }
  }
  return normalizeGenres(out);
}

/**
 * Generi senza duplicati (a parità di `genreKey`), al massimo 10, con la grafia già in uso
 * in libreria quando esiste (`existing`), altrimenti quella del primo inserimento.
 */
export function normalizeGenres(names: readonly string[], existing: Iterable<string> = []): string[] {
  const canonical = new Map<string, string>();
  for (const e of existing) if (!canonical.has(genreKey(e))) canonical.set(genreKey(e), e);
  const out = new Map<string, string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim();
    const key = genreKey(name);
    if (!key || out.has(key)) continue;
    out.set(key, canonical.get(key) ?? name);
    if (out.size >= GENRES_PER_TRACK_MAX) break;
  }
  return [...out.values()];
}

/** Generi comuni a tutti gli elenchi (nella grafia del primo). */
export function commonGenres(lists: readonly (readonly string[])[]): string[] {
  const [first, ...rest] = lists;
  if (!first) return [];
  const others = rest.map((l) => new Set(l.map(genreKey)));
  return first.filter((g) => others.every((s) => s.has(genreKey(g))));
}

/** Impostazioni che valgono per tutto il backend (on-premise) o per il dispositivo (client). */
export interface CatalogSettingsDto {
  /** Ricerca online di copertine e metadati degli album. */
  coverLookup: boolean;
  /** True se la ricerca è forzata spenta dalla configurazione del server (`COVER_LOOKUP=off`). */
  coverLookupLocked: boolean;
}
export const updateSettingsBodySchema = z.object({ coverLookup: z.boolean() });
