import { ALBUM_COVER_MAX_BYTES } from '../catalog.js';

/** Host da cui si accettano immagini di copertina (Cover Art Archive, archive.org, iTunes). */
export const DEFAULT_IMAGE_HOSTS = ['coverartarchive.org', 'archive.org', '*.archive.org', '*.mzstatic.com'];

const MAX_REDIRECTS = 5;

export type ImageErrorReason = 'not_allowed' | 'not_image' | 'too_large' | 'not_found' | 'unavailable';

export class CoverImageError extends Error {
  constructor(
    readonly reason: ImageErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'CoverImageError';
  }
}

/**
 * True se l'URL è consentito: `https` su un host dell'elenco (`*.dominio` per i sottodomini),
 * oppure un'origine scritta per intero nell'elenco (`http://127.0.0.1:4599`, per i test).
 */
export function isAllowedImageUrl(raw: string, hosts: readonly string[] = DEFAULT_IMAGE_HOSTS): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return hosts.some((h) => {
    if (h.includes('://')) return url.origin === h.replace(/\/+$/, '');
    if (url.protocol !== 'https:' || url.port) return false;
    if (h.startsWith('*.')) return url.hostname.endsWith(h.slice(1));
    return url.hostname === h;
  });
}

export interface FetchedImage {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * Scarica un'immagine di copertina seguendo i redirect a mano, così che ogni passo
 * resti sugli host consentiti: il backend non può essere usato per raggiungere altri indirizzi.
 */
export async function fetchCoverImage(
  rawUrl: string,
  opts: {
    fetch?: typeof fetch;
    hosts?: readonly string[];
    maxBytes?: number;
    userAgent?: string;
    signal?: AbortSignal;
  } = {},
): Promise<FetchedImage> {
  const doFetch = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? ALBUM_COVER_MAX_BYTES;
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImageUrl(url, opts.hosts))
      throw new CoverImageError('not_allowed', 'Indirizzo non consentito');
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: 'manual',
        signal: opts.signal,
        headers: opts.userAgent ? { 'user-agent': opts.userAgent } : undefined,
      });
    } catch {
      throw new CoverImageError('unavailable', 'Servizio delle copertine non raggiungibile');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new CoverImageError('unavailable', 'Risposta non valida');
      url = new URL(location, url).toString();
      continue;
    }
    if (res.status === 404) throw new CoverImageError('not_found', 'Copertina non trovata');
    if (!res.ok)
      throw new CoverImageError('unavailable', `Servizio delle copertine non disponibile (${res.status})`);
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!contentType.startsWith('image/'))
      throw new CoverImageError('not_image', 'Il file non è un’immagine');
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new CoverImageError('too_large', 'Immagine troppo grande');
    return { bytes: await readLimited(res, maxBytes), contentType };
  }
  throw new CoverImageError('unavailable', 'Troppi reindirizzamenti');
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new CoverImageError('too_large', 'Immagine troppo grande');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CoverImageError('too_large', 'Immagine troppo grande');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
