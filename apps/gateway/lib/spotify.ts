import { ErrorCode } from '@spookyfy/shared';
import { SpotifyApi, SpotifyError, SpotifyService, spotifyConfig } from '@spookyfy/spotify';
import { requireUser } from './auth.js';
import type { GatewayDeps } from './handlers.js';
import { HttpError, json, readJson } from './http.js';
import { KvSpotifyStore } from './spotify-store.js';
const modules = new WeakMap<GatewayDeps, SpotifyApi>();
export async function handleSpotify(req: Request, action: string, deps: GatewayDeps): Promise<Response> {
  // Spotify uses exact configured origin even if another Vercel preview serves the request.
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    req.headers.get('origin') !== deps.config.publicOrigin
  )
    throw new HttpError(403, ErrorCode.ForbiddenOrigin, 'Origine non consentita');
  const { user, sessionId, headers } = await requireUser(req, deps);
  headers.set('cache-control', 'no-store');
  headers.set('vary', 'Cookie');
  let api = modules.get(deps);
  if (!api) {
    api = new SpotifyApi(
      new SpotifyService(deps.config.spotify ?? spotifyConfig(), new KvSpotifyStore(deps.kv), {
        now: () => deps.clock.now(),
        fetch: deps.fetch,
      }),
    );
    modules.set(deps, api);
  }
  try {
    const result = await api.dispatch(
      user.id,
      sessionId,
      action,
      req.method,
      new URL(req.url).searchParams,
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readJson(req) : undefined,
      req.signal,
    );
    if (result.redirect) {
      headers.set('location', result.redirect);
      return new Response(null, { status: 303, headers });
    }
    return json(result.status, result.body, headers);
  } catch (e) {
    if (e instanceof SpotifyError) {
      if (e.retryAfter) headers.set('retry-after', String(e.retryAfter));
      return json(e.status, { error: { code: e.code, message: e.code } }, headers);
    }
    throw e;
  }
}
