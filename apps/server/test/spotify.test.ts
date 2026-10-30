import { type SpotifyLink, SpotifyService, spotifyConfig } from '@spookyfy/spotify';
import { describe, expect, test, vi } from 'vitest';
import { AccessTokenService } from '../src/auth/tokens.js';
import { UserService } from '../src/auth/users.js';
import { SqliteSpotifyStore } from '../src/spotify/store.js';
import { TEST_ORIGIN, createTestContext, createUser, login, userSession } from './helpers.js';
describe('server Spotify', () => {
  test('bridge bearer alone cannot authorize Spotify and callback secrets are absent in logs', async () => {
    const logs: string[] = [];
    const ctx = await createTestContext({
      env: { BRIDGE_ALLOWED_ORIGINS: 'https://client.test' },
      buildOptions: {
        logger: {
          level: 'info',
          stream: {
            write: (chunk: string) => {
              logs.push(chunk);
            },
          },
        },
      },
    });
    try {
      const user = await createUser(ctx, 'tester');
      const { token } = new AccessTokenService(ctx.database.db, ctx.clock).create(user.id, 'bridge');
      const res = await ctx.app.inject({
        url: '/api/spotify/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
      const cookie = await login(ctx, 'tester');
      await ctx.app.inject({
        url: '/api/spotify/callback?code=CODE_LOG_SECRET&state=STATE_LOG_SECRET',
        headers: { cookie },
      });
      expect(logs.length).toBeGreaterThan(0);
      const all = logs.join('');
      for (const secret of ['CODE_LOG_SECRET', 'STATE_LOG_SECRET', token, cookie.split('=')[1]!])
        expect(all).not.toContain(secret);
    } finally {
      await ctx.cleanup();
    }
  });
  test('disabled module remains authenticated and never contacts Spotify', async () => {
    const f = vi.fn();
    const ctx = await createTestContext({ buildOptions: { spotifyFetch: f } });
    try {
      expect((await ctx.app.inject('/api/spotify/status')).statusCode).toBe(401);
      const cookie = await userSession(ctx);
      const status = await ctx.app.inject({ url: '/api/spotify/status', headers: { cookie } });
      expect(status.json()).toMatchObject({ mode: 'disabled', linkState: 'unlinked' });
      const noOrigin = await ctx.app.inject({
        method: 'POST',
        url: '/api/spotify/link',
        headers: { cookie },
        payload: {},
      });
      expect(noOrigin.statusCode).toBe(403);
      expect(f).not.toHaveBeenCalled();
    } finally {
      await ctx.cleanup();
    }
  });
  test('fake link routes, SDK token memory boundary, unlink and session mismatch', async () => {
    const ctx = await createTestContext({ env: { SPOTIFY_FAKE: 'true' } });
    try {
      const cookie = await userSession(ctx);
      const link = await ctx.app.inject({
        method: 'POST',
        url: '/api/spotify/link',
        headers: { cookie, origin: TEST_ORIGIN },
        payload: { capability: 'playback' },
      });
      const url = link.json().url as string;
      const other = await login(ctx, 'fede');
      expect((await ctx.app.inject({ url, headers: { cookie: other } })).headers.location).toContain(
        'failed',
      );
      expect((await ctx.app.inject({ url, headers: { cookie } })).headers.location).toBe(
        '/settings?spotify=linked',
      );
      const token = await ctx.app.inject({
        method: 'POST',
        url: '/api/spotify/token',
        headers: { cookie, origin: TEST_ORIGIN },
      });
      expect(token.statusCode).toBe(200);
      expect(token.headers['cache-control']).toBe('no-store');
      expect(token.headers.vary).toBe('Cookie');
      expect(token.json()).toMatchObject({ accessToken: 'fake-access' });
      const status = await ctx.app.inject({ url: '/api/spotify/status', headers: { cookie } });
      expect(status.body).not.toContain('fake-access');
      const unlink = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/spotify/link',
        headers: { cookie, origin: TEST_ORIGIN },
      });
      expect(unlink.statusCode).toBe(204);
      expect(
        (await ctx.app.inject({ url: '/api/spotify/status', headers: { cookie } })).json(),
      ).toMatchObject({ linkState: 'unlinked', generation: 1 });
    } finally {
      await ctx.cleanup();
    }
  });
  test('SQLite transaction enforces account uniqueness and generation/lease fencing', async () => {
    const ctx = await createTestContext();
    try {
      const u = await createUser(ctx, 'first');
      const v = await createUser(ctx, 'second');
      const a = new SqliteSpotifyStore(ctx.database.sqlite);
      const b = new SqliteSpotifyStore(ctx.database.sqlite);
      const link: SpotifyLink = {
        userId: u.id,
        accountId: 'unique-account',
        envelope: 'encrypted',
        scopes: [],
        expiresAt: 0,
        authorizedAt: 0,
        version: 1,
        generation: 0,
        displayName: null,
        entitlement: 'unknown',
        reauth: false,
      };
      expect(await a.save(link, null)).toBe(true);
      expect(await b.save({ ...link, userId: v.id }, null)).toBe(false);
      expect(await a.acquire(u.id, 'first', 0, 10)).toBe(true);
      expect(await b.acquire(u.id, 'second', 11, 10)).toBe(true);
      await a.release(u.id, 'first');
      expect(await a.save({ ...link, version: 2 }, 1, { owner: 'first', now: 12 })).toBe(false);
      await a.unlink(u.id);
      expect(await b.save({ ...link, version: 2 }, 1)).toBe(false);
      expect(await a.generation(u.id)).toBe(1);
      new UserService(ctx.database.db, ctx.clock).delete('first');
      expect(await a.get(u.id)).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
  test('SQLite refresh completing after account deletion cannot resurrect link', async () => {
    const ctx = await createTestContext();
    try {
      const u = await createUser(ctx, 'first');
      const store = new SqliteSpotifyStore(ctx.database.sqlite);
      let finish!: (r: Response) => void;
      const c = {
        ...spotifyConfig({ NODE_ENV: 'test', SPOTIFY_FAKE: 'true' }),
        mode: 'live' as const,
        policyResolved: true,
      };
      const service = new SpotifyService(c, store, {
        now: () => ctx.clock.now(),
        fetch: vi.fn(
          () =>
            new Promise<Response>((r) => {
              finish = r;
            }),
        ),
      });
      await store.save(
        {
          userId: u.id,
          accountId: 'account',
          envelope: service.cipher.seal(u.id, { accessToken: 'old', refreshToken: 'refresh' }),
          scopes: [],
          expiresAt: 0,
          authorizedAt: ctx.clock.now(),
          version: 1,
          generation: 0,
          displayName: null,
          entitlement: 'unknown',
          reauth: false,
        },
        null,
      );
      const flight = service.token(u.id);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      new UserService(ctx.database.db, ctx.clock).delete('first');
      finish(new Response(JSON.stringify({ access_token: 'late', expires_in: 3600 })));
      await expect(flight).rejects.toMatchObject({ code: 'SPOTIFY_REAUTH_REQUIRED' });
      expect(await store.get(u.id)).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
