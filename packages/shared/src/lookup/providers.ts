import { z } from 'zod';
import { GENRES_PER_TRACK_MAX, albumKey, normalizeGenres } from '../catalog.js';
import { isConfidentMatch, matchKey } from './match.js';
import { type RateLimiter, createRateLimiter } from './rate-limit.js';

export type LookupSource = 'musicbrainz' | 'itunes';

export const lookupCandidateSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.enum(['musicbrainz', 'itunes']),
  title: z.string().min(1).max(300),
  artist: z.string().min(1).max(300),
  year: z.number().int().nullable(),
  genres: z.array(z.string().max(100)).max(20),
  /** Immagine grande sul servizio d'origine (il client la riceve tramite il proprio backend). */
  coverUrl: z.string().url().max(2000),
  thumbUrl: z.string().url().max(2000),
  score: z.number(),
});
export type LookupCandidateDto = z.infer<typeof lookupCandidateSchema>;

export const lookupQuerySchema = z
  .object({
    album: z.string().trim().max(300).optional(),
    artist: z.string().trim().max(300).optional(),
    title: z.string().trim().max(300).optional(),
  })
  .refine((q) => !!q.album || !!q.title, { message: "Indica l'album o il titolo del brano" });
export type LookupQuery = z.infer<typeof lookupQuerySchema>;

export const applyCandidateBodySchema = z.object({
  candidate: lookupCandidateSchema,
  /** Campi dell'album da sostituire con quelli del candidato, oltre alla copertina. */
  fields: z
    .object({
      title: z.boolean().optional(),
      artist: z.boolean().optional(),
      year: z.boolean().optional(),
      genres: z.boolean().optional(),
    })
    .default({}),
});
export type ApplyCandidateBody = z.infer<typeof applyCandidateBodySchema>;

export const LOOKUP_MAX_CANDIDATES = 10;
const MB_ENOUGH = 3;

export class LookupError extends Error {
  constructor(message = 'Ricerca online non disponibile, riprova più tardi') {
    super(message);
    this.name = 'LookupError';
  }
}

export interface LookupConfig {
  fetch?: typeof fetch;
  userAgent: string;
  musicbrainzUrl?: string;
  coverArtUrl?: string;
  itunesUrl?: string;
  timeoutMs?: number;
  /** Coda condivisa per le chiamate a MusicBrainz (una per istanza). */
  limiter?: RateLimiter;
}

export interface AlbumLookup {
  search(q: LookupQuery, signal?: AbortSignal): Promise<LookupCandidateDto[]>;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
/** Escape per la sintassi Lucene della ricerca di MusicBrainz. */
const lucene = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;
const yearOf = (date: unknown) => {
  const m = typeof date === 'string' ? /^(\d{4})/.exec(date) : null;
  return m ? Number(m[1]) : null;
};

interface MbCredit {
  name?: string;
  joinphrase?: string;
  artist?: { name?: string };
}
const creditName = (credits: MbCredit[] | undefined) =>
  (credits ?? [])
    .map((c) => `${c.name ?? c.artist?.name ?? ''}${c.joinphrase ?? ''}`)
    .join('')
    .trim();

interface MbTag {
  name?: string;
  count?: number;
}
const mbGenres = (tags: MbTag[] | undefined) =>
  normalizeGenres(
    (tags ?? [])
      .filter((t) => (t.count ?? 0) > 0 && t.name)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .map((t) => t.name!),
  ).slice(0, GENRES_PER_TRACK_MAX);

export function createAlbumLookup(config: LookupConfig): AlbumLookup {
  const doFetch = config.fetch ?? fetch;
  const mbUrl = trimSlash(config.musicbrainzUrl ?? 'https://musicbrainz.org');
  const caaUrl = trimSlash(config.coverArtUrl ?? 'https://coverartarchive.org');
  const itunesUrl = trimSlash(config.itunesUrl ?? 'https://itunes.apple.com');
  const timeoutMs = config.timeoutMs ?? 8000;
  const limiter = config.limiter ?? createRateLimiter(1100);

  async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(url, {
      headers: { accept: 'application/json', 'user-agent': config.userAgent },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new LookupError(`Servizio non disponibile (${res.status})`);
    return res.json();
  }

  const caa = (id: string) => ({
    coverUrl: `${caaUrl}/release-group/${id}/front-500`,
    thumbUrl: `${caaUrl}/release-group/${id}/front-250`,
  });

  async function musicbrainz(q: LookupQuery, signal?: AbortSignal): Promise<LookupCandidateDto[]> {
    if (q.album) {
      const query = [`releasegroup:${lucene(q.album)}`, q.artist ? `artist:${lucene(q.artist)}` : null]
        .filter(Boolean)
        .join(' AND ');
      const data = (await limiter.schedule(() =>
        getJson(`${mbUrl}/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=10`, signal),
      )) as {
        'release-groups'?: {
          id: string;
          score?: number;
          title?: string;
          'first-release-date'?: string;
          'artist-credit'?: MbCredit[];
          tags?: MbTag[];
          genres?: MbTag[];
        }[];
      };
      return (data['release-groups'] ?? [])
        .filter((g) => g.id && g.title)
        .map((g) => ({
          id: `mb:${g.id}`,
          source: 'musicbrainz' as const,
          title: g.title!,
          artist: creditName(g['artist-credit']) || q.artist || '',
          year: yearOf(g['first-release-date']),
          genres: mbGenres(g.genres?.length ? g.genres : g.tags),
          ...caa(g.id),
          score: g.score ?? 0,
        }));
    }
    // Solo album ufficiali: senza filtri i primi risultati sono spesso bootleg e registrazioni dal vivo.
    const query = [
      `recording:${lucene(q.title ?? '')}`,
      q.artist ? `artist:${lucene(q.artist)}` : null,
      'primarytype:album',
      'status:official',
      '-secondarytype:live',
      '-secondarytype:compilation',
    ]
      .filter(Boolean)
      .join(' AND ');
    const data = (await limiter.schedule(() =>
      getJson(`${mbUrl}/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=10`, signal),
    )) as {
      recordings?: {
        score?: number;
        'artist-credit'?: MbCredit[];
        tags?: MbTag[];
        releases?: {
          date?: string;
          status?: string;
          'artist-credit'?: MbCredit[];
          'release-group'?: {
            id?: string;
            title?: string;
            'primary-type'?: string;
            'secondary-types'?: string[];
          };
        }[];
      }[];
    };
    // Un candidato per album; l'album in cui il brano compare più volte (edizioni, ristampe) va in testa.
    const byGroup = new Map<string, LookupCandidateDto & { hits: number }>();
    for (const r of data.recordings ?? []) {
      for (const rel of r.releases ?? []) {
        const g = rel['release-group'];
        if (!g?.id || !g.title) continue;
        if (rel.status && rel.status !== 'Official') continue;
        if (g['secondary-types']?.some((t) => t === 'Live' || t === 'Compilation')) continue;
        const prev = byGroup.get(g.id);
        if (prev) {
          prev.hits++;
          const year = yearOf(rel.date);
          if (year !== null && (prev.year === null || year < prev.year)) prev.year = year;
          continue;
        }
        byGroup.set(g.id, {
          id: `mb:${g.id}`,
          source: 'musicbrainz',
          title: g.title,
          artist: creditName(rel['artist-credit']) || creditName(r['artist-credit']) || q.artist || '',
          year: yearOf(rel.date),
          genres: mbGenres(r.tags),
          ...caa(g.id),
          // Gli album veri prima di raccolte e singoli.
          score: (r.score ?? 0) - (g['primary-type'] === 'Album' ? 0 : 5),
          hits: 1,
        });
      }
    }
    return [...byGroup.values()].map(({ hits, ...c }) => ({ ...c, score: c.score + Math.min(hits, 10) }));
  }

  async function itunes(q: LookupQuery, signal?: AbortSignal): Promise<LookupCandidateDto[]> {
    const term = [q.artist, q.album ?? q.title].filter(Boolean).join(' ');
    const entity = q.album ? 'album' : 'song';
    const data = (await getJson(
      `${itunesUrl}/search?term=${encodeURIComponent(term)}&media=music&entity=${entity}&limit=10`,
      signal,
    )) as {
      results?: {
        collectionId?: number;
        collectionName?: string;
        artistName?: string;
        collectionArtistName?: string;
        releaseDate?: string;
        primaryGenreName?: string;
        artworkUrl100?: string;
      }[];
    };
    return (data.results ?? [])
      .filter((r) => r.collectionId && r.collectionName && r.artworkUrl100)
      .map((r, i) => ({
        id: `itunes:${r.collectionId}`,
        source: 'itunes' as const,
        title: r.collectionName!,
        artist: r.collectionArtistName ?? r.artistName ?? q.artist ?? '',
        year: yearOf(r.releaseDate),
        genres: normalizeGenres(r.primaryGenreName ? [r.primaryGenreName] : []),
        coverUrl: r.artworkUrl100!.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
        thumbUrl: r.artworkUrl100!.replace(/\/\d+x\d+bb\./, '/250x250bb.'),
        score: 80 - i * 3,
      }));
  }

  return {
    async search(q, signal) {
      const target = { title: q.album ?? '', artist: q.artist ?? '' };
      let mb: LookupCandidateDto[] = [];
      let failures = 0;
      try {
        mb = await musicbrainz(q, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        failures++;
      }
      let it: LookupCandidateDto[] = [];
      if (mb.length < MB_ENOUGH) {
        try {
          it = await itunes(q, signal);
        } catch (e) {
          if (signal?.aborted) throw e;
          failures++;
        }
      }
      if (failures === 2) throw new LookupError();
      return rankCandidates([...mb, ...it], q.album ? target : null);
    },
  };
}

/**
 * Unisce i candidati dei provider: un album per sorgente, titolo e artista (vince il punteggio
 * più alto, completato con anno e generi dei doppioni; lo stesso album da iTunes resta come
 * copertina alternativa), corrispondenze sicure in testa, massimo 10.
 */
export function rankCandidates(
  all: LookupCandidateDto[],
  target: { title: string; artist: string } | null,
): LookupCandidateDto[] {
  const scored = all
    .filter((c) => c.title && c.artist)
    .map((c) => ({ ...c, score: c.score + (target && isConfidentMatch(target, c) ? 100 : 0) }))
    .sort((a, b) => b.score - a.score);
  const byKey = new Map<string, LookupCandidateDto>();
  for (const c of scored) {
    const key = `${c.source}\u0000${matchKey(c.title) || albumKey(c.title)}\u0000${matchKey(c.artist)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    if (prev.year === null && c.year !== null) prev.year = c.year;
    if (prev.genres.length === 0) prev.genres = c.genres;
  }
  return [...byKey.values()].slice(0, LOOKUP_MAX_CANDIDATES);
}
