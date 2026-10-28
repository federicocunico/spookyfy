import {
  ErrorCode,
  Feature,
  type HealthDto,
  YOUTUBE_ID_PATTERN,
  remoteSearchQuerySchema,
} from '@spookyfy/shared';
import { z } from 'zod';
import { type AuthDeps, requireUser } from './auth.js';
import { HttpError, json, parseOrThrow } from './http.js';
import { proxyAudio } from './proxy.js';
import { type YoutubeClient, YoutubeError } from './youtube.js';

export interface GatewayDeps extends AuthDeps {
  youtube: YoutubeClient;
  fetch: typeof fetch;
}

const idSchema = z.string().regex(YOUTUBE_ID_PATTERN, 'Identificativo di video YouTube non valido');

/** Errori di YouTube → risposte HTTP con codici specifici per l'app. */
export function youtubeHttpError(err: unknown): HttpError {
  if (!(err instanceof YoutubeError)) throw err;
  switch (err.kind) {
    case 'blocked':
      return new HttpError(503, ErrorCode.YoutubeBlocked, err.message);
    case 'unavailable':
      return new HttpError(404, ErrorCode.VideoUnavailable, err.message);
    case 'too_long':
      return new HttpError(422, ErrorCode.VideoTooLong, err.message);
    case 'timeout':
      return new HttpError(503, ErrorCode.RemoteSearchUnavailable, err.message);
    default:
      return new HttpError(502, ErrorCode.RemoteSearchUnavailable, err.message);
  }
}

async function yt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw youtubeHttpError(err);
  }
}

export function handleHealth(d: GatewayDeps): Response {
  const body: HealthDto = {
    status: 'ok',
    mode: 'client',
    version: d.config.version,
    features: [
      Feature.RemoteSearch,
      Feature.DeviceIngest,
      ...(d.config.registrationToken ? [Feature.Registration] : []),
    ],
  };
  return json(200, body);
}

export async function handleSearch(req: Request, d: GatewayDeps): Promise<Response> {
  const { headers } = await requireUser(req, d);
  const { q } = parseOrThrow(remoteSearchQuerySchema, Object.fromEntries(new URL(req.url).searchParams));
  const items = await yt(() => d.youtube.search(q));
  // Il gateway non conosce la libreria del dispositivo: è l'app a segnare i brani già presenti.
  return json(200, { items: items.map((i) => ({ ...i, trackId: null })) }, headers);
}

export async function handleMeta(req: Request, id: string, d: GatewayDeps): Promise<Response> {
  const { headers } = await requireUser(req, d);
  const sourceId = parseOrThrow(idSchema, id);
  const meta = await yt(() => d.youtube.meta(sourceId));
  return json(200, { ...meta, thumbnailUrl: `/api/cover/${sourceId}` }, headers);
}

export async function handleAudio(req: Request, id: string, d: GatewayDeps): Promise<Response> {
  const { headers } = await requireUser(req, d);
  const sourceId = parseOrThrow(idSchema, id);
  const source = await yt(() => d.youtube.audioSource(sourceId));
  const res = await proxyAudio(source, req.headers.get('range'), d.fetch, req.signal);
  headers.forEach((v, k) => res.headers.append(k, v));
  return res;
}

export async function handleCover(req: Request, id: string, d: GatewayDeps): Promise<Response> {
  const { headers } = await requireUser(req, d);
  const sourceId = parseOrThrow(idSchema, id);
  const upstream = await d.fetch(d.youtube.thumbnailUrl(sourceId));
  if (!upstream.ok || !upstream.body)
    throw new HttpError(404, ErrorCode.NotFound, 'Copertina non disponibile');
  headers.set('content-type', upstream.headers.get('content-type') ?? 'image/jpeg');
  headers.set('cache-control', 'private, max-age=86400');
  return new Response(upstream.body, { status: 200, headers });
}
