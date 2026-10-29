import {
  type AlbumLookup,
  CoverImageError,
  ErrorCode,
  LookupError,
  createAlbumLookup,
  fetchCoverImage,
  lookupQuerySchema,
} from '@spookyfy/shared';
import { z } from 'zod';
import { requireUser } from './auth.js';
import type { GatewayDeps } from './handlers.js';
import { HttpError, json, parseOrThrow } from './http.js';

const imageQuery = z.object({ url: z.string().url().max(2000) });

const lookups = new WeakMap<GatewayDeps, AlbumLookup>();
const userAgent = (d: GatewayDeps) =>
  `Spookyfy/${d.config.version} ( https://github.com/federicocunico/spookyfy )`;

/** Client dei database musicali, uno per istanza della funzione (con la sua coda per MusicBrainz). */
function albumLookup(d: GatewayDeps): AlbumLookup {
  let l = lookups.get(d);
  if (!l) {
    l = createAlbumLookup({ fetch: d.fetch, userAgent: userAgent(d), ...d.config.lookup });
    lookups.set(d, l);
  }
  return l;
}

const unavailable = () =>
  new HttpError(
    503,
    ErrorCode.LookupUnavailable,
    'Ricerca online non disponibile al momento, riprova più tardi',
  );

/**
 * `api/lookup/[action]`: `albums` cerca album e copertine su MusicBrainz e iTunes,
 * `image` restituisce dalla stessa origine dell'app l'immagine di un candidato. Nessuno
 * stato: niente ricerche né immagini conservate.
 */
export async function handleLookup(req: Request, action: string, d: GatewayDeps): Promise<Response> {
  const { headers } = await requireUser(req, d);
  if (d.config.coverLookupForcedOff)
    throw new HttpError(409, ErrorCode.LookupDisabled, 'La ricerca online di copertine è disattivata');
  const params = Object.fromEntries(new URL(req.url).searchParams);

  if (action === 'albums') {
    const q = parseOrThrow(lookupQuerySchema, params);
    try {
      return json(200, { items: await albumLookup(d).search(q, req.signal) }, headers);
    } catch (err) {
      if (err instanceof LookupError) throw unavailable();
      throw err;
    }
  }

  if (action === 'image') {
    const { url } = parseOrThrow(imageQuery, params);
    try {
      const img = await fetchCoverImage(url, {
        fetch: d.fetch,
        hosts: d.config.lookup.imageHosts?.length ? d.config.lookup.imageHosts : undefined,
        userAgent: userAgent(d),
        signal: req.signal,
      });
      headers.set('content-type', img.contentType);
      headers.set('cache-control', 'private, max-age=86400');
      return new Response(img.bytes, { status: 200, headers });
    } catch (err) {
      if (!(err instanceof CoverImageError)) throw err;
      if (err.reason === 'not_allowed')
        throw new HttpError(400, ErrorCode.ValidationFailed, 'Indirizzo non consentito');
      if (err.reason === 'unavailable') throw unavailable();
      throw new HttpError(422, ErrorCode.InvalidImage, 'La copertina scelta non è disponibile');
    }
  }

  throw new HttpError(404, ErrorCode.NotFound, 'Endpoint non trovato');
}
