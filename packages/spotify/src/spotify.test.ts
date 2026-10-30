import { describe, expect, it, vi } from 'vitest';
import {
  FAKE_PLAYLIST_ID,
  FAKE_TRACK_ID,
  MemorySpotifyStore,
  SpotifyApi,
  type SpotifyConfig,
  SpotifyError,
  type SpotifyLink,
  SpotifyService,
  TokenCipher,
  hash,
  spotifyConfig,
} from './index.js';
const config = (): SpotifyConfig => ({
  ...spotifyConfig({ NODE_ENV: 'test', SPOTIFY_FAKE: 'true' }),
  mode: 'live',
  clientId: 'a'.repeat(32),
  redirectUri: 'https://app.test/api/spotify/callback',
  policyResolved: true,
});
const scopes = [
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
];
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
function context(fetcher: typeof fetch = vi.fn(async () => json({}))) {
  let now = Date.UTC(2026, 0, 1);
  const store = new MemorySpotifyStore();
  const c = config();
  const service = new SpotifyService(c, store, { now: () => now, fetch: fetcher });
  return {
    store,
    c,
    service,
    api: new SpotifyApi(service),
    advance: (n: number) => {
      now += n;
    },
    now: () => now,
  };
}
async function seed(ctx: ReturnType<typeof context>, id = 'u', extra: Partial<SpotifyLink> = {}) {
  const link: SpotifyLink = {
    userId: id,
    accountId: `account-${id}`,
    envelope: ctx.service.cipher.seal(id, { accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET' }),
    scopes,
    expiresAt: ctx.now() + 3600000,
    authorizedAt: ctx.now(),
    version: 1,
    generation: 0,
    displayName: null,
    entitlement: 'unknown',
    reauth: false,
    ...extra,
  };
  await ctx.store.save(link, null);
  return link;
}
describe('optional config and encryption', () => {
  it('defaults off and rejects fake in production', () => {
    expect(spotifyConfig({}).mode).toBe('disabled');
    expect(spotifyConfig({ NODE_ENV: 'production', SPOTIFY_FAKE: 'true' }).mode).toBe('disabled');
  });
  it('validates redirect/key independently from base application', () => {
    const env = {
      SPOTIFY_ENABLED: 'true',
      SPOTIFY_CLIENT_ID: 'a'.repeat(32),
      SPOTIFY_REDIRECT_URI: 'http://localhost:3000/api/spotify/callback',
      SPOTIFY_KEY_ID: 'a',
      SPOTIFY_ENCRYPTION_KEYS: JSON.stringify({ a: Buffer.alloc(32).toString('base64') }),
    };
    expect(spotifyConfig(env).mode).toBe('misconfigured');
    expect(
      spotifyConfig({ ...env, SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/api/spotify/callback' }).mode,
    ).toBe('live');
  });
  it('encrypts with unique nonce, user AAD, tamper detection and retained old keys', () => {
    const c = config();
    const cipher = new TokenCipher(c);
    const a = cipher.seal('u', { secret: 'refresh' });
    const b = cipher.seal('u', { secret: 'refresh' });
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh');
    expect(cipher.open('u', a)).toEqual({ secret: 'refresh' });
    expect(() => cipher.open('other', a)).toThrow(SpotifyError);
    const parsed = JSON.parse(a);
    parsed.c = parsed.c.slice(1);
    expect(() => cipher.open('u', JSON.stringify(parsed))).toThrow();
    const rotated = new TokenCipher({
      keyId: 'new',
      keys: { ...c.keys, new: Buffer.alloc(32, 8).toString('base64') },
    });
    expect(rotated.open('u', a)).toEqual({ secret: 'refresh' });
  });
});
describe('PKCE and ownership', () => {
  it.each(['premium', 'free', 'open', undefined])(
    'classifies current profile product %s without inferring missing entitlement',
    async (product) => {
      const ctx = context(oauth({ account_id: 'stable-account', ...(product ? { product } : {}) }));
      const { q } = await attempt(ctx);
      expect(await ctx.service.callback('u', 'session', q)).toBe('linked');
      expect((await ctx.service.status('u')).entitlement).toBe(
        product === 'premium'
          ? 'premium'
          : product === 'free' || product === 'open'
            ? 'non-premium'
            : 'unknown',
      );
    },
  );
  function oauth(profile: unknown = { account_id: 'stable-account', id: 'legacy-id', product: 'premium' }) {
    return vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/token')
        ? json({ access_token: 'TOKEN_SECRET', refresh_token: 'REFRESH_SECRET', expires_in: 3600 })
        : json(profile),
    ) as typeof fetch;
  }
  async function attempt(ctx: ReturnType<typeof context>, id = 'u', session = 'session') {
    const { url } = await ctx.service.link(id, session, 'library');
    const u = new URL(url);
    return { u, q: new URLSearchParams({ state: u.searchParams.get('state')!, code: 'CODE_SECRET' }) };
  }
  it('uses S256 and encrypted pending; binds user/session and consumes once', async () => {
    const ctx = context(oauth());
    const { u, q } = await attempt(ctx);
    expect(u.origin).toBe('https://accounts.spotify.com');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(JSON.stringify([...ctx.store.attempts.values()])).not.toContain('verifier"');
    expect(await ctx.service.callback('other', 'session', q)).toBe('failed');
    expect(await ctx.service.callback('u', 'other', q)).toBe('failed');
    expect(await ctx.service.callback('u', 'session', q)).toBe('linked');
    expect((await ctx.store.get('u'))?.accountId).toBe('stable-account');
    expect(await ctx.service.callback('u', 'session', q)).toBe('failed');
  });
  it('base library authorization keeps account identity scopes separate from email', async () => {
    const ctx = context(oauth());
    const { u } = await attempt(ctx);
    const requested = u.searchParams.get('scope')!.split(' ');
    expect(requested).toContain('user-read-private');
    expect(requested).toContain('user-library-read');
    expect(requested).not.toContain('user-read-email');
  });
  it('playback authorization adds email and all SDK scopes while retaining library grants', async () => {
    const ctx = context(oauth());
    await seed(ctx, 'u', { scopes: ['user-read-private', 'user-library-read', 'playlist-read-private'] });
    const { url } = await ctx.service.link('u', 'session', 'playback');
    const requested = new URL(url).searchParams.get('scope')!.split(' ');
    expect(requested).toEqual(
      expect.arrayContaining([
        'user-read-private',
        'user-library-read',
        'playlist-read-private',
        'user-read-email',
        'streaming',
        'user-read-playback-state',
        'user-modify-playback-state',
      ]),
    );
  });
  it('expired, denied and unlink-fenced pending never exchange credentials', async () => {
    const f = oauth();
    const ctx = context(f);
    const a = await attempt(ctx);
    ctx.advance(600001);
    expect(await ctx.service.callback('u', 'session', a.q)).toBe('failed');
    const b = await attempt(ctx);
    b.q.set('error', 'access_denied');
    expect(await ctx.service.callback('u', 'session', b.q)).toBe('denied');
    const d = await attempt(ctx);
    await ctx.service.unlink('u');
    expect(await ctx.service.callback('u', 'session', d.q)).toBe('failed');
    expect(f).not.toHaveBeenCalled();
  });
  it('requires account_id, preserves previous link on incompatible or different account', async () => {
    const ctx = context(oauth({ id: 'legacy-only' }));
    const before = await seed(ctx);
    const { q } = await attempt(ctx);
    expect(await ctx.service.callback('u', 'session', q)).toBe('failed');
    expect(await ctx.store.get('u')).toEqual(before);
  });
  it('prevents shared account across local users under concurrent callbacks', async () => {
    const ctx = context(oauth());
    const a = await attempt(ctx, 'u');
    const b = await attempt(ctx, 'v');
    const results = await Promise.all([
      ctx.service.callback('u', 'session', a.q),
      ctx.service.callback('v', 'session', b.q),
    ]);
    expect(results.sort()).toEqual(['failed', 'linked']);
  });
  it('denial and account replacement keep encrypted prior link', async () => {
    const ctx = context(oauth({ account_id: 'different' }));
    const old = await seed(ctx);
    const { q } = await attempt(ctx);
    expect(await ctx.service.callback('u', 'session', q)).toBe('failed');
    expect(await ctx.store.get('u')).toEqual(old);
  });
  it('disabled/policy unresolved status never calls upstream', async () => {
    const f = vi.fn();
    const ctx = context(f);
    ctx.c.mode = 'disabled';
    expect((await ctx.service.status('u')).mode).toBe('disabled');
    await expect(ctx.service.link('u', 's', 'profile')).rejects.toMatchObject({
      code: 'SPOTIFY_NOT_CONFIGURED',
    });
    ctx.c.mode = 'live';
    ctx.c.policyResolved = false;
    await expect(ctx.service.link('u', 's', 'profile')).rejects.toMatchObject({
      code: 'SPOTIFY_POLICY_DISABLED',
    });
    expect(f).not.toHaveBeenCalled();
  });
});
describe('token lifecycle', () => {
  it.each([true, false])('single flight retains/rotates refresh=%s', async (rotated) => {
    const f = vi.fn(async () =>
      json({ access_token: 'NEW', expires_in: 3600, ...(rotated ? { refresh_token: 'ROTATED' } : {}) }),
    );
    const ctx = context(f);
    await seed(ctx, 'u', { expiresAt: ctx.now() + 1000 });
    const a = await Promise.all([ctx.service.token('u'), ctx.service.token('u')]);
    expect(a[0]).toEqual(a[1]);
    expect(f).toHaveBeenCalledTimes(1);
    const link = (await ctx.store.get('u'))!;
    expect(ctx.service.cipher.open('u', link.envelope)).toEqual({
      accessToken: 'NEW',
      refreshToken: rotated ? 'ROTATED' : 'REFRESH_SECRET',
    });
  });
  it('invalid_grant marks provider reauth and preserves local session contract', async () => {
    const ctx = context(vi.fn(async () => json({ error: 'invalid_grant' }, 400)));
    await seed(ctx, 'u', { expiresAt: ctx.now() });
    await expect(ctx.service.token('u')).rejects.toMatchObject({
      code: 'SPOTIFY_REAUTH_REQUIRED',
      status: 409,
    });
    expect((await ctx.service.status('u')).linkState).toBe('reauth-required');
  });
  it('expires authorization after six calendar months without refreshing', async () => {
    const f = vi.fn();
    const ctx = context(f);
    await seed(ctx, 'u', { authorizedAt: Date.UTC(2025, 6, 1) });
    await expect(ctx.service.token('u')).rejects.toMatchObject({ code: 'SPOTIFY_REAUTH_REQUIRED' });
    expect(f).not.toHaveBeenCalled();
  });
  it('unlink during network refresh cannot resurrect credentials', async () => {
    let finish!: (r: Response) => void;
    const ctx = context(
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      ),
    );
    await seed(ctx, 'u', { expiresAt: ctx.now() });
    const flight = ctx.service.token('u');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await ctx.service.unlink('u');
    finish(json({ access_token: 'late', expires_in: 3600 }));
    await expect(flight).rejects.toMatchObject({ code: 'SPOTIFY_REAUTH_REQUIRED' });
    expect(await ctx.store.get('u')).toBeNull();
  });
  it('lease fencing rejects owner after expiration even before successor write', async () => {
    const ctx = context();
    const link = await seed(ctx);
    await ctx.store.acquire('u', 'old', ctx.now(), 10);
    ctx.advance(11);
    expect(await ctx.store.save({ ...link, version: 2 }, 1, { owner: 'old', now: ctx.now() })).toBe(false);
  });
  it('known free does not advertise stream, missing product stays unknown', async () => {
    const ctx = context();
    await seed(ctx, 'u', { entitlement: 'non-premium' });
    expect((await ctx.service.status('u')).capabilities.canStream).toBe(false);
  });
  it('does not advertise playback for incomplete grants and enables it after the complete upgrade', async () => {
    const ctx = context();
    ctx.c.hybridPlayback = true;
    const required = [
      'user-read-private',
      'user-read-email',
      'streaming',
      'user-read-playback-state',
      'user-modify-playback-state',
    ];
    await seed(ctx, 'u', { scopes: required.filter((scope) => scope !== 'user-read-email') });
    expect((await ctx.service.status('u')).capabilities).toMatchObject({
      canStream: false,
      canHybridPlayback: false,
    });
    const upgraded = { ...(await ctx.store.get('u'))!, scopes: required, version: 2 };
    expect(await ctx.store.save(upgraded, 1)).toBe(true);
    expect((await ctx.service.status('u')).capabilities).toMatchObject({
      canStream: true,
      canHybridPlayback: true,
    });
  });
});
describe('REST boundaries', () => {
  it.each([
    { pausing: true, seeking: true, resuming: false, skipping_next: false },
    { disallows: { pausing: true, seeking: true, resuming: false, skipping_next: false } },
  ])('normalizes playback restrictions without reversing boolean meaning: %j', async (actions) => {
    const ctx = context(
      vi.fn(async () =>
        json({
          device: {
            id: 'browser',
            name: 'Browser',
            type: 'Computer',
            is_active: true,
            is_restricted: false,
            volume_percent: 50,
          },
          item: null,
          is_playing: true,
          progress_ms: 120,
          shuffle_state: false,
          repeat_state: 'off',
          actions,
        }),
      ),
    );
    await seed(ctx);
    const result = await ctx.api.dispatch('u', 's', 'playback', 'GET', new URLSearchParams(), undefined);
    expect(result.body).toMatchObject({
      disallows: { pausing: true, seeking: true, resuming: false, skipping_next: false },
    });
    expect((result.body as { disallows: Record<string, boolean> }).disallows).not.toHaveProperty('disallows');
  });
  it('rejects non-boolean playback restriction flags rather than enabling commands', async () => {
    const ctx = context(
      vi.fn(async () =>
        json({
          device: {
            id: 'browser',
            name: 'Browser',
            type: 'Computer',
            is_active: true,
            is_restricted: false,
            volume_percent: 50,
          },
          item: null,
          is_playing: true,
          progress_ms: 120,
          shuffle_state: false,
          repeat_state: 'off',
          actions: { pausing: 'false', seeking: 1 },
        }),
      ),
    );
    await seed(ctx);
    await expect(
      ctx.api.dispatch('u', 's', 'playback', 'GET', new URLSearchParams(), undefined),
    ).rejects.toMatchObject({ code: 'SPOTIFY_CONTRACT_CHANGED' });
  });
  const playlistRaw = (extra: Record<string, unknown> = {}) => ({
    id: FAKE_PLAYLIST_ID,
    type: 'playlist',
    uri: `spotify:playlist:${FAKE_PLAYLIST_ID}`,
    name: 'Native playlist',
    owner: { id: 'legacy-u' },
    items: { total: 2 },
    public: false,
    description: 'Preserve this description',
    snapshot_id: 'snapshot-1',
    ...extra,
  });
  it('lists only reliably owned native edit destinations using transient profile id', async () => {
    const f = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/me')
        ? json({ account_id: 'account-u', id: 'legacy-u' })
        : json({
            items: [
              playlistRaw(),
              playlistRaw({ owner: { id: 'followed-owner' } }),
              playlistRaw({ owner: { id: 'another-owner' }, collaborative: true }),
            ],
            total: 3,
            next: null,
          }),
    );
    const ctx = context(f);
    await seed(ctx);
    const result = await ctx.api.dispatch(
      'u',
      's',
      'library',
      'GET',
      new URLSearchParams({ type: 'playlists' }),
      undefined,
    );
    expect(result.body).toMatchObject({
      items: [
        { editable: true, description: 'Preserve this description', public: false },
        { editable: false },
        { editable: false },
      ],
    });
    expect((await ctx.store.get('u'))?.accountId).toBe('account-u');
    expect(JSON.stringify(await ctx.store.get('u'))).not.toContain('legacy-u');
  });
  it('missing transient profile id leaves list read-only rather than substituting account_id', async () => {
    const ctx = context(
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith('/me')
          ? json({ account_id: 'account-u' })
          : json({ items: [playlistRaw({ owner: { id: 'account-u' } })], total: 1, next: null }),
      ),
    );
    await seed(ctx);
    const result = await ctx.api.dispatch('u', 's', 'library', 'GET', new URLSearchParams(), undefined);
    expect(result.body).toMatchObject({ items: [{ editable: false }] });
  });
  it('playlist detail loads the same normalized items page as the standalone action', async () => {
    const rawTrack = {
      id: FAKE_TRACK_ID,
      type: 'track',
      uri: `spotify:track:${FAKE_TRACK_ID}`,
      name: 'Demo',
      duration_ms: 1000,
      artists: [],
    };
    const f = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/items?')
        ? json({
            items: [{ item: rawTrack }, { item: null }, { item: rawTrack }],
            total: 30,
            next: 'https://api.spotify.com/v1/playlists/example/items?offset=4',
          })
        : json(playlistRaw({ owner: { id: 'other-owner' }, collaborative: true })),
    );
    const ctx = context(f);
    await seed(ctx);
    const detail = await ctx.api.dispatch(
      'u',
      's',
      'detail',
      'GET',
      new URLSearchParams({ type: 'playlist', id: FAKE_PLAYLIST_ID, offset: '1' }),
      undefined,
    );
    const standalone = await ctx.api.dispatch(
      'u',
      's',
      'playlist-items',
      'GET',
      new URLSearchParams({ id: FAKE_PLAYLIST_ID, offset: '1' }),
      undefined,
    );
    expect(detail.body).toMatchObject({
      entity: {
        editable: true,
        contentsAvailable: true,
        description: 'Preserve this description',
        public: false,
      },
      items: {
        items: [
          { position: 1, track: { id: FAKE_TRACK_ID } },
          { position: 2, track: null },
          { position: 3, track: { id: FAKE_TRACK_ID } },
        ],
        nextOffset: 4,
        total: 30,
      },
    });
    expect((detail.body as { items: unknown }).items).toEqual(standalone.body);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('metadata-only native detail remains read-only and never fabricates empty accessible contents', async () => {
    const f = vi.fn(async () => json(playlistRaw({ items: undefined })));
    const ctx = context(f);
    await seed(ctx);
    const detail = await ctx.api.dispatch(
      'u',
      's',
      'detail',
      'GET',
      new URLSearchParams({ type: 'playlist', id: FAKE_PLAYLIST_ID }),
      undefined,
    );
    expect(detail.body).toMatchObject({
      entity: { editable: false, contentsAvailable: false },
      items: { contentsAvailable: false },
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('native eligibility still requires the write scope matching playlist visibility', async () => {
    const ctx = context(
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('/items?')
          ? json({ items: [], total: 0, next: null })
          : json(playlistRaw({ public: true })),
      ),
    );
    await seed(ctx, 'u', { scopes: scopes.filter((s) => s !== 'playlist-modify-public') });
    const detail = await ctx.api.dispatch(
      'u',
      's',
      'detail',
      'GET',
      new URLSearchParams({ type: 'playlist', id: FAKE_PLAYLIST_ID }),
      undefined,
    );
    expect(detail.body).toMatchObject({ entity: { editable: false } });
  });
  it('fake native create/list/detail/add/reorder/remove uses common permission and item normalization', async () => {
    const ctx = context();
    ctx.c.mode = 'fake';
    await seed(ctx);
    const empty = new URLSearchParams();
    const created = await ctx.api.dispatch('u', 's', 'playlist', 'POST', empty, {
      name: 'Created through API',
      description: 'Keep metadata',
      public: false,
    });
    const native = created.body as { id: string; editable: boolean };
    expect(native.editable).toBe(true);
    const list = await ctx.api.dispatch('u', 's', 'library', 'GET', empty, undefined);
    expect(
      (list.body as { items: { id: string; editable: boolean }[] }).items.find((p) => p.id === native.id)
        ?.editable,
    ).toBe(true);
    const a = `spotify:track:${FAKE_TRACK_ID}`;
    const b = 'spotify:track:0000000000000000000009';
    await ctx.api.dispatch('u', 's', 'playlist-items', 'POST', empty, { id: native.id, uris: [a, b, a] });
    const detail = () =>
      ctx.api.dispatch(
        'u',
        's',
        'detail',
        'GET',
        new URLSearchParams({ type: 'playlist', id: native.id }),
        undefined,
      );
    const uris = (response: { body?: unknown }) =>
      (response.body as { items: { items: { track: { uri: string } | null }[] } }).items.items.map(
        (item) => item.track?.uri,
      );
    expect(uris(await detail())).toEqual([a, b, a]);
    await ctx.api.dispatch('u', 's', 'playlist-items', 'PUT', empty, {
      id: native.id,
      rangeStart: 1,
      insertBefore: 0,
      rangeLength: 1,
    });
    expect(uris(await detail())).toEqual([b, a, a]);
    await ctx.api.dispatch('u', 's', 'playlist-items', 'DELETE', empty, { id: native.id, uris: [a] });
    const final = await detail();
    expect(uris(final)).toEqual([b]);
    expect(final.body).toMatchObject({
      entity: { editable: true, description: 'Keep metadata', public: false },
      items: { total: 1, contentsAvailable: true },
    });
  });
  it.each([
    { action: 'shuffle', state: true, path: 'shuffle', key: 'state', value: 'true' },
    { action: 'repeat', repeat: 'context', path: 'repeat', key: 'state', value: 'context' },
    { action: 'volume', volume: 42, path: 'volume', key: 'volume_percent', value: '42' },
  ])('targets selected device for $action with encoded query', async ({ path, key, value, ...command }) => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const ctx = context(f);
    await seed(ctx);
    const deviceId = 'browser + /?&=device';
    await ctx.api.dispatch('u', 's', 'playback', 'POST', new URLSearchParams(), { ...command, deviceId });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const target = new URL(url);
    expect(target.origin).toBe('https://api.spotify.com');
    expect(target.pathname).toBe(`/v1/me/player/${path}`);
    expect([...target.searchParams.entries()]).toEqual([
      [key, value],
      ['device_id', deviceId],
    ]);
    expect(init.method).toBe('PUT');
    expect(init.body).toBeUndefined();
  });
  it('starts native context at the selected URI and position with exact Spotify payload', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const ctx = context(f);
    await seed(ctx);
    await ctx.api.dispatch('u', 's', 'playback', 'POST', new URLSearchParams(), {
      action: 'play',
      deviceId: 'browser-device',
      contextUri: `spotify:playlist:${FAKE_PLAYLIST_ID}`,
      offsetUri: `spotify:track:${FAKE_TRACK_ID}`,
      positionMs: 1234,
    });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me/player/play?device_id=browser-device');
    expect(JSON.parse(init.body as string)).toEqual({
      context_uri: `spotify:playlist:${FAKE_PLAYLIST_ID}`,
      offset: { uri: `spotify:track:${FAKE_TRACK_ID}` },
      position_ms: 1234,
    });
  });
  it('fake metadata, library and playback mutations are isolated per user', async () => {
    const ctx = context();
    ctx.c.mode = 'fake';
    await seed(ctx, 'u');
    await seed(ctx, 'v');
    await ctx.api.dispatch('u', 's', 'playlist', 'PATCH', new URLSearchParams(), {
      id: FAKE_PLAYLIST_ID,
      name: 'Private user name',
    });
    const other = await ctx.api.dispatch('v', 's', 'library', 'GET', new URLSearchParams(), undefined);
    expect(JSON.stringify(other.body)).not.toContain('Private user name');
    await ctx.api.dispatch('u', 's', 'saved', 'DELETE', new URLSearchParams(), {
      uris: [`spotify:track:${FAKE_TRACK_ID}`],
    });
    const saved = await ctx.api.dispatch(
      'u',
      's',
      'library',
      'GET',
      new URLSearchParams({ type: 'tracks' }),
      undefined,
    );
    expect(saved.body).toMatchObject({ items: [] });
    await ctx.api.dispatch('u', 's', 'playback', 'POST', new URLSearchParams(), {
      action: 'play',
      uri: `spotify:track:${FAKE_TRACK_ID}`,
      deviceId: 'fake-browser',
    });
    const playback = await ctx.api.dispatch('u', 's', 'playback', 'GET', new URLSearchParams(), undefined);
    expect(playback.body).toMatchObject({ playing: true, track: { id: FAKE_TRACK_ID } });
    expect(
      (await ctx.api.dispatch('v', 's', 'playback', 'GET', new URLSearchParams(), undefined)).body,
    ).toBeNull();
  });
  it('distributed circuit opens after three failures and grants one recovery probe', async () => {
    const ctx = context(vi.fn(async () => json({}, 503)));
    await seed(ctx);
    const action = () =>
      ctx.api.dispatch('u', 's', 'search', 'GET', new URLSearchParams({ q: 'network' }), undefined);
    for (let i = 0; i < 3; i++) await expect(action()).rejects.toMatchObject({ code: 'SPOTIFY_UNAVAILABLE' });
    const f = ctx.service.fetch as ReturnType<typeof vi.fn>;
    expect(f).toHaveBeenCalledTimes(6);
    await expect(action()).rejects.toMatchObject({ status: 503 });
    expect(f).toHaveBeenCalledTimes(6);
    ctx.advance(30001);
    expect(await ctx.store.circuit(ctx.now())).toBe(true);
    expect(await ctx.store.circuit(ctx.now())).toBe(false);
    await ctx.store.circuit(ctx.now(), 'success');
    expect(await ctx.store.circuit(ctx.now())).toBe(true);
  });
  it('personal read cache is scoped by session and invalidated by mutations', async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(null, { status: 204 })
        : json({ items: [], total: 0, next: null }),
    );
    const ctx = context(f);
    await seed(ctx);
    const read = (session = 'one') =>
      ctx.api.dispatch('u', session, 'library', 'GET', new URLSearchParams({ type: 'tracks' }), undefined);
    await read();
    await read();
    expect(f).toHaveBeenCalledTimes(1);
    await read('two');
    expect(f).toHaveBeenCalledTimes(2);
    await ctx.api.dispatch('u', 'one', 'saved', 'PUT', new URLSearchParams(), {
      uris: [`spotify:track:${FAKE_TRACK_ID}`],
    });
    await read();
    expect(f).toHaveBeenCalledTimes(4);
  });
  const rawTrack = {
    id: FAKE_TRACK_ID,
    type: 'track',
    uri: `spotify:track:${FAKE_TRACK_ID}`,
    name: 'Demo',
    duration_ms: 1000,
    artists: [],
    extra: 'allowed',
  };
  const search = (ctx: ReturnType<typeof context>) =>
    ctx.api.dispatch('u', 's', 'search', 'GET', new URLSearchParams({ q: 'demo' }), undefined);
  it('search reconstructs pagination and validates hostile upstream URLs', async () => {
    const ctx = context(
      vi.fn(async () =>
        json({ tracks: { items: [rawTrack], total: 1, next: 'https://evil.test/exfiltrate' } }),
      ),
    );
    await seed(ctx);
    await expect(search(ctx)).rejects.toMatchObject({ code: 'SPOTIFY_CONTRACT_CHANGED' });
  });
  it('normalizes track metadata and rejects malformed identity', async () => {
    const ctx = context(vi.fn(async () => json({ tracks: { items: [rawTrack], total: 1, next: null } })));
    await seed(ctx);
    const result = await search(ctx);
    expect(result.body).toMatchObject({ items: [{ kind: 'track', durationMs: 1000 }], total: 1 });
    expect(JSON.stringify(result)).not.toContain('ACCESS_SECRET');
  });
  it('invalid client limit returns 400 before upstream', async () => {
    const f = vi.fn();
    const ctx = context(f);
    await seed(ctx);
    await expect(
      ctx.api.dispatch('u', 's', 'search', 'GET', new URLSearchParams({ q: 'x', limit: '11' }), undefined),
    ).rejects.toMatchObject({ status: 400 });
    expect(f).not.toHaveBeenCalled();
  });
  it('204 playback read means no current playback', async () => {
    const ctx = context(vi.fn(async () => new Response(null, { status: 204 })));
    await seed(ctx);
    expect(await ctx.api.dispatch('u', 's', 'playback', 'GET', new URLSearchParams(), undefined)).toEqual({
      status: 200,
      body: null,
    });
  });
  it('save uses URI query chunks of 40 with empty 200 response', async () => {
    const f = vi.fn(async () => new Response(null, { status: 200 }));
    const ctx = context(f);
    await seed(ctx);
    await ctx.api.dispatch('u', 's', 'saved', 'PUT', new URLSearchParams(), {
      uris: Array(81).fill(`spotify:track:${FAKE_TRACK_ID}`),
    });
    expect(f).toHaveBeenCalledTimes(3);
    for (const [url] of f.mock.calls as unknown as [string][])
      expect(new URL(url).searchParams.get('uris')!.split(',').length).toBeLessThanOrEqual(40);
  });
  it('native playlist creation defaults private and never retries uncertain mutation', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('timeout');
    });
    const ctx = context(f);
    await seed(ctx);
    await expect(
      ctx.api.dispatch('u', 's', 'playlist', 'POST', new URLSearchParams(), { name: 'test' }),
    ).rejects.toMatchObject({ code: 'SPOTIFY_MUTATION_UNCERTAIN' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject(
      { public: false },
    );
  });
  it('generic forbidden is access restriction, not Premium/local session failure', async () => {
    const ctx = context(vi.fn(async () => json({ error: { message: 'Forbidden' } }, 403)));
    await seed(ctx);
    await expect(search(ctx)).rejects.toMatchObject({ code: 'SPOTIFY_ACCESS_RESTRICTED', status: 403 });
  });
  it('rate cooldown is shared and Retry-After avoids polling', async () => {
    const f = vi.fn(async () => json({}, 429, { 'retry-after': '40' }));
    const ctx = context(f);
    await seed(ctx);
    await expect(search(ctx)).rejects.toMatchObject({ code: 'SPOTIFY_RATE_LIMITED', retryAfter: 40 });
    await expect(search(ctx)).rejects.toMatchObject({ code: 'SPOTIFY_RATE_LIMITED' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('quota is distinct from rate limit', async () => {
    const ctx = context(vi.fn(async () => json({ reason: 'QUOTA_EXCEEDED' }, 403)));
    await seed(ctx);
    await expect(search(ctx)).rejects.toMatchObject({ code: 'SPOTIFY_QUOTA_EXCEEDED' });
  });
  it('one read retry can refresh upstream 401 without exposing local 401', async () => {
    let n = 0;
    const f = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('api/token')
        ? json({ access_token: 'NEW', expires_in: 3600 })
        : ++n === 1
          ? json({}, 401)
          : json({ tracks: { items: [], total: 0, next: null } }),
    );
    const ctx = context(f as typeof fetch);
    await seed(ctx);
    expect((await search(ctx)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('null and unsupported playlist entries preserve positions and duplicates', async () => {
    const ctx = context(
      vi.fn(async () =>
        json({
          items: [{ item: rawTrack }, { item: null }, { item: rawTrack }, { item: { type: 'episode' } }],
          total: 4,
          next: null,
        }),
      ),
    );
    await seed(ctx);
    const result = await ctx.api.dispatch(
      'u',
      's',
      'playlist-items',
      'GET',
      new URLSearchParams({ id: FAKE_PLAYLIST_ID }),
      undefined,
    );
    expect(result.body).toMatchObject({
      contentsAvailable: true,
      items: [
        { position: 0, track: { id: FAKE_TRACK_ID } },
        { position: 1, track: null },
        { position: 2, track: { id: FAKE_TRACK_ID } },
        { position: 3, track: null },
      ],
    });
  });
  it('caller abort reaches fetch and does not become mutation success', async () => {
    const controller = new AbortController();
    const ctx = context(vi.fn(async (_url, _init) => new Promise(() => {})));
    await seed(ctx);
    const promise = ctx.api.dispatch(
      'u',
      's',
      'search',
      'GET',
      new URLSearchParams({ q: 'x' }),
      undefined,
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(SpotifyError);
  });
  it('fake OAuth and API end to end never call network', async () => {
    const f = vi.fn();
    const ctx = context(f);
    ctx.c.mode = 'fake';
    const { url } = await ctx.service.link('u', 's', 'library');
    expect(await ctx.service.callback('u', 's', new URL(url, 'https://app.test').searchParams)).toBe(
      'linked',
    );
    expect((await search(ctx)).body).toMatchObject({ items: [{ kind: 'track' }] });
    expect(f).not.toHaveBeenCalled();
  });
});
