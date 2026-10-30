import { SpotifyErrorCode as E, type SpotifyStatusDto } from '@spookyfy/shared';
import { z } from 'zod';
import {
  type SpotifyConfig,
  SpotifyError,
  type SpotifyLink,
  type SpotifyStore,
  TokenCipher,
  hash,
  random,
} from './model.js';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
const profileSchema = z.object({
  account_id: z.string().min(1),
  display_name: z.string().nullable().optional(),
  product: z.string().optional(),
});
const playbackScopes = [
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
];
const scopeSets: Record<string, string[]> = {
  profile: [],
  library: ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'],
  'playlist-write': ['playlist-modify-private', 'playlist-modify-public'],
  'library-write': ['user-library-modify'],
  playback: playbackScopes,
};
/** Six calendar months, clamped to the final day for month-end authorizations. */
export function authorizationExpiresAt(authorizedAt: number): number {
  const end = new Date(authorizedAt);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 6);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end.getTime();
}
export interface Credentials {
  accessToken: string;
  refreshToken: string;
}
export class SpotifyService {
  readonly cipher: TokenCipher;
  readonly now: () => number;
  readonly fetch: typeof globalThis.fetch;
  private flights = new Map<string, Promise<{ accessToken: string; expiresAt: number }>>();
  constructor(
    readonly config: SpotifyConfig,
    readonly store: SpotifyStore,
    deps: { now?: () => number; fetch?: typeof globalThis.fetch } = {},
  ) {
    this.cipher = new TokenCipher(config);
    this.now = deps.now ?? Date.now;
    this.fetch = deps.fetch ?? globalThis.fetch;
  }
  assertEnabled() {
    if (!['live', 'fake'].includes(this.config.mode)) throw new SpotifyError(E.NotConfigured, 503);
    if (this.config.mode === 'live' && !this.config.policyResolved)
      throw new SpotifyError(E.PolicyDisabled, 403);
  }
  async status(id: string): Promise<SpotifyStatusDto> {
    const l = await this.store.get(id);
    if (l) {
      if (this.now() >= authorizationExpiresAt(l.authorizedAt)) l.reauth = true;
    }
    const enabled =
      ['live', 'fake'].includes(this.config.mode) &&
      (this.config.mode === 'fake' || this.config.policyResolved);
    const linked = !!l && !l.reauth;
    const canStream =
      enabled &&
      linked &&
      l?.entitlement !== 'non-premium' &&
      playbackScopes.every((scope) => l?.scopes.includes(scope));
    return {
      mode: this.config.mode,
      linkState: l ? (l.reauth ? 'reauth-required' : 'linked') : 'unlinked',
      accountId: l?.accountId ?? null,
      displayName: l?.displayName ?? null,
      entitlement: l?.entitlement ?? 'unknown',
      scopes: l?.scopes ?? [],
      generation: await this.store.generation(id),
      capabilities: {
        canBrowse: enabled && linked,
        canEditLibrary: enabled && linked && !!l?.scopes.includes('user-library-modify'),
        canEditPlaylist:
          enabled &&
          linked &&
          !!l?.scopes.some(
            (scope) => scope === 'playlist-modify-private' || scope === 'playlist-modify-public',
          ),
        canStream,
        canDownload: false,
        canEditTags: false,
        canHybridPlayback: canStream && this.config.hybridPlayback,
      },
      ...(!enabled ? { reason: this.config.mode === 'live' ? E.PolicyDisabled : E.NotConfigured } : {}),
    };
  }
  async link(userId: string, session: string, capability: string) {
    this.assertEnabled();
    const previous = await this.store.get(userId);
    const state = random();
    const verifier = random();
    const generation = await this.store.generation(userId);
    const scopes = [
      ...new Set(['user-read-private', ...(previous?.scopes ?? []), ...(scopeSets[capability] ?? [])]),
    ];
    await this.store.putAttempt(hash(state), {
      userId,
      sessionHash: hash(session),
      protectedVerifier: this.cipher.seal(userId, { verifier }),
      redirectUri: this.config.redirectUri,
      scopes,
      generation,
      expiresAt: this.now() + 600000,
    });
    if (this.config.mode === 'fake') return { url: `/api/spotify/callback?state=${state}&code=fake` };
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: hash(verifier),
    }).toString();
    return { url: url.toString() };
  }
  async callback(
    userId: string,
    session: string,
    q: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<'linked' | 'denied' | 'failed'> {
    this.assertEnabled();
    const state = q.get('state');
    if (!state || state.length > 256) return 'failed';
    const attempt = await this.store.consumeAttempt(hash(state), userId, hash(session), this.now());
    if (!attempt || attempt.generation !== (await this.store.generation(userId))) return 'failed';
    if (q.has('error')) return 'denied';
    const code = q.get('code');
    if (!code || code.length > 4096) return 'failed';
    try {
      const verifier = this.cipher.open<{ verifier: string }>(userId, attempt.protectedVerifier).verifier;
      const token =
        this.config.mode === 'fake'
          ? {
              access_token: 'fake-access',
              refresh_token: 'fake-refresh',
              expires_in: 3600,
              scope: attempt.scopes.join(' '),
            }
          : await this.exchange(
              {
                grant_type: 'authorization_code',
                code,
                redirect_uri: attempt.redirectUri,
                code_verifier: verifier,
              },
              signal,
            );
      const profile =
        this.config.mode === 'fake'
          ? { account_id: `fake-${userId}`, display_name: 'Spotify demo', product: 'premium' }
          : profileSchema.parse(
              await this.raw('https://api.spotify.com/v1/me', {
                signal,
                headers: { authorization: `Bearer ${token.access_token}` },
              }),
            );
      const old = await this.store.get(userId);
      if (old && old.accountId !== profile.account_id) return 'failed';
      if (!token.refresh_token) return 'failed';
      const link: SpotifyLink = {
        userId,
        accountId: profile.account_id,
        displayName: profile.display_name ?? null,
        entitlement:
          profile.product === 'premium'
            ? 'premium'
            : ['free', 'open'].includes(profile.product ?? '')
              ? 'non-premium'
              : 'unknown',
        envelope: this.cipher.seal(userId, {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
        }),
        scopes: (token.scope ?? attempt.scopes.join(' ')).split(' ').filter(Boolean),
        expiresAt: this.now() + token.expires_in * 1000,
        authorizedAt: this.now(),
        generation: attempt.generation,
        version: (old?.version ?? 0) + 1,
        reauth: false,
      };
      return (await this.store.save(link, old?.version ?? null)) ? 'linked' : 'failed';
    } catch {
      return 'failed';
    }
  }
  async raw(url: string, init: RequestInit = {}): Promise<unknown> {
    const target = new URL(url);
    if (
      target.username ||
      target.password ||
      target.hash ||
      !(
        (target.origin === 'https://api.spotify.com' && target.pathname.startsWith('/v1/')) ||
        (target.origin === 'https://accounts.spotify.com' && target.pathname === '/api/token')
      )
    )
      throw new SpotifyError(E.Unsupported, 400);
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000);
    const bounded = async () => {
      const r = await this.fetch(url, { ...init, signal, redirect: 'error' });
      if (!r.ok) {
        let body: unknown;
        try {
          body = await r.json();
        } catch {}
        throw classify(r.status, body, r.headers.get('retry-after'), this.now());
      }
      if (r.status === 204) return null;
      const text = await r.text();
      if (!text.trim()) return null;
      if (text.length > 2000000) throw new SpotifyError(E.ContractChanged);
      try {
        return JSON.parse(text);
      } catch {
        throw new SpotifyError(E.ContractChanged);
      }
    };
    try {
      return await abortable(bounded(), signal);
    } catch (e) {
      if (e instanceof SpotifyError) throw e;
      throw new SpotifyError(E.Unavailable);
    }
  }
  async exchange(params: Record<string, string>, signal?: AbortSignal) {
    const data = await this.raw('https://accounts.spotify.com/api/token', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: this.config.clientId }),
    });
    const result = tokenSchema.safeParse(data);
    if (!result.success) throw new SpotifyError(E.ContractChanged);
    return result.data;
  }
  token(
    id: string,
    force = false,
    signal?: AbortSignal,
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const running = this.flights.get(id);
    if (running) return signal ? abortable(running, signal) : running;
    const flight = this.refresh(id, force, signal).finally(() => this.flights.delete(id));
    this.flights.set(id, flight);
    return flight;
  }
  private async refresh(id: string, force: boolean, signal?: AbortSignal) {
    this.assertEnabled();
    let l = await this.store.get(id);
    if (!l || l.reauth) throw new SpotifyError(E.ReauthRequired, 409);
    if (this.now() >= authorizationExpiresAt(l.authorizedAt)) {
      await this.store.save({ ...l, reauth: true, version: l.version + 1 }, l.version);
      throw new SpotifyError(E.ReauthRequired, 409);
    }
    let credentials = this.cipher.open<Credentials>(id, l.envelope);
    if (!force && l.expiresAt > this.now() + 60000)
      return { accessToken: credentials.accessToken, expiresAt: l.expiresAt };
    const owner = random();
    if (!(await this.store.acquire(id, owner, this.now(), 10000))) {
      // A bounded wait lets a sibling instance finish without an OAuth refresh storm.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const fresh = await this.store.get(id);
        if (!fresh) throw new SpotifyError(E.ReauthRequired, 409);
        if (fresh.version !== l.version && fresh.expiresAt > this.now() + 60000) {
          const c = this.cipher.open<Credentials>(id, fresh.envelope);
          return { accessToken: c.accessToken, expiresAt: fresh.expiresAt };
        }
      }
      throw new SpotifyError(E.Unavailable, 503);
    }
    try {
      const current = await this.store.get(id);
      if (!current || current.generation !== l.generation) throw new SpotifyError(E.ReauthRequired, 409);
      if (current.version !== l.version && current.expiresAt > this.now() + 60000) {
        l = current;
        const c = this.cipher.open<Credentials>(id, l.envelope);
        return { accessToken: c.accessToken, expiresAt: l.expiresAt };
      }
      l = current;
      credentials = this.cipher.open<Credentials>(id, current.envelope);
      const t =
        this.config.mode === 'fake'
          ? { access_token: 'fake-access', expires_in: 3600, refresh_token: undefined, scope: undefined }
          : await this.exchange(
              { grant_type: 'refresh_token', refresh_token: credentials.refreshToken },
              signal,
            );
      const next = {
        ...l,
        version: l.version + 1,
        expiresAt: this.now() + t.expires_in * 1000,
        scopes: t.scope ? t.scope.split(' ') : l.scopes,
        envelope: this.cipher.seal(id, {
          accessToken: t.access_token,
          refreshToken: t.refresh_token ?? credentials.refreshToken,
        }),
      };
      if (!(await this.store.save(next, l.version, { owner, now: this.now() })))
        throw new SpotifyError(E.ReauthRequired, 409);
      return { accessToken: t.access_token, expiresAt: next.expiresAt };
    } catch (e) {
      if (e instanceof SpotifyError && e.code === E.ReauthRequired)
        await this.store.save({ ...l, reauth: true, version: l.version + 1 }, l.version, {
          owner,
          now: this.now(),
        });
      throw e;
    } finally {
      await this.store.release(id, owner);
    }
  }
  async requireScopes(id: string, scopes: string[]) {
    this.assertEnabled();
    const link = await this.store.get(id);
    if (!link || link.reauth) throw new SpotifyError(E.ReauthRequired, 409);
    if (scopes.some((s) => !link.scopes.includes(s))) throw new SpotifyError(E.ScopeRequired, 403);
    return link;
  }
  unlink(id: string) {
    return this.store.unlink(id);
  }
  async markReauth(id: string) {
    const l = await this.store.get(id);
    if (l) await this.store.save({ ...l, reauth: true, version: l.version + 1 }, l.version);
  }
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new SpotifyError(E.Unavailable));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', stop))
      .catch(() => {});
  });
}
export function classify(
  status: number,
  body: unknown,
  retry: string | null,
  now = Date.now(),
): SpotifyError {
  const reason = JSON.stringify(body ?? {});
  if (reason.includes('invalid_grant')) return new SpotifyError(E.ReauthRequired, 409);
  if (reason.includes('QUOTA_EXCEEDED')) return new SpotifyError(E.QuotaExceeded, 429);
  if (status === 401) return new SpotifyError(E.ReauthRequired, 409);
  if (status === 429) {
    const seconds = Number(retry);
    return new SpotifyError(
      E.RateLimited,
      429,
      Number.isFinite(seconds) && seconds > 0
        ? seconds
        : Math.max(1, Math.ceil((Date.parse(retry ?? '') - now) / 1000)) || 30,
    );
  }
  if (status === 403)
    return new SpotifyError(
      reason.includes('PREMIUM_REQUIRED')
        ? E.PremiumRequired
        : reason.includes('scope')
          ? E.ScopeRequired
          : E.AccessRestricted,
      403,
    );
  if (status === 404)
    return new SpotifyError(/device/i.test(reason) ? E.DeviceUnavailable : E.Unsupported, 409);
  return new SpotifyError(E.Unavailable, 502);
}
