import { type SpotifyLink, SpotifyService, spotifyConfig } from '@spookyfy/spotify';
import { describe, expect, test, vi } from 'vitest';
import { GatewaySessions, GatewayUsers } from '../lib/auth.js';
import { handle } from '../lib/http.js';
import { KvSpotifyStore } from '../lib/spotify-store.js';
import { handleSpotify } from '../lib/spotify.js';
import { HOUR, PASSWORD, makeDeps, req, sessionCookie } from './helpers.js';
async function setup() {
  const d = makeDeps({ env: { SPOTIFY_FAKE: 'true' } });
  const users = new GatewayUsers(d.kv, d.clock);
  const user = await users.create('tester', PASSWORD);
  const sessions = new GatewaySessions(d.kv, d.clock, d.config);
  const issued = await sessions.issue(user);
  return { d, user, sessions, cookie: issued.cookie.split(';')[0]! };
}
describe('gateway Spotify cookie isolation', () => {
  test('account deletion tombstones fence preauthorized callback and new-generation link attempts', async () => {
    const { d, user, sessions, cookie } = await setup();
    const users = new GatewayUsers(d.kv, d.clock);
    const store = new KvSpotifyStore(d.kv);
    const service = new SpotifyService(spotifyConfig({ NODE_ENV: 'test', SPOTIFY_FAKE: 'true' }), store, {
      now: () => d.clock.now(),
    });
    const session = (await sessions.validate(req('GET', '/api/auth/me', { cookie })))!;
    const pending = await service.link(user.id, session.sessionId, 'library');
    let allowSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      allowSave = resolve;
    });
    let saveReady!: () => void;
    const saveReached = new Promise<void>((resolve) => {
      saveReady = resolve;
    });
    const save = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementation(async (...args) => {
      saveReady();
      await saveGate;
      return save(...args);
    });
    const callback = service.callback(
      user.id,
      session.sessionId,
      new URL(pending.url, 'https://app.test').searchParams,
    );
    await saveReached;
    let allowDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      allowDelete = resolve;
    });
    let deleteReady!: () => void;
    const deleteReached = new Promise<void>((resolve) => {
      deleteReady = resolve;
    });
    const remove = d.kv.compareAndDeleteMember.bind(d.kv);
    vi.spyOn(d.kv, 'compareAndDeleteMember').mockImplementation(async (...args) => {
      deleteReady();
      await deleteGate;
      return remove(...args);
    });
    const deletion = users.delete(user.username);
    await deleteReached;
    expect((await users.get(user.username))?.deleting).toBe(true);
    expect(await sessions.validate(req('GET', '/api/auth/me', { cookie }))).toBeNull();
    expect(await users.verify(user.username, PASSWORD)).toBeNull();
    await expect(sessions.issue(user)).rejects.toMatchObject({ status: 401 });
    await expect(users.setPassword(user.username, PASSWORD)).rejects.toMatchObject({ status: 404 });
    // This request was authorized before deletion and sees the bumped generation.
    expect(await store.generation(user.id)).toBe(1);
    await expect(service.link(user.id, session.sessionId, 'library')).rejects.toMatchObject({
      code: 'SPOTIFY_REAUTH_REQUIRED',
    });
    allowDelete();
    await deletion;
    allowSave();
    expect(await callback).toBe('failed');
    expect(await store.get(user.id)).toBeNull();
    expect(await users.get(user.username)).toBeNull();
    const state = await d.kv.get<{ attempts: Record<string, { userId: string }> }>('spk:spotify:v1');
    expect(Object.values(state?.attempts ?? {}).some((attempt) => attempt.userId === user.id)).toBe(false);
    const replacement = await users.create(user.username, PASSWORD);
    expect(replacement.id).not.toBe(user.id);
    await expect(sessions.issue(replacement)).resolves.toHaveProperty('cookie');
    await expect(service.link(replacement.id, 'new-session', 'library')).resolves.toHaveProperty('url');
  });
  test('failed provider cleanup retains a retryable disabled account until cleanup succeeds', async () => {
    const { d, user, sessions, cookie } = await setup();
    const users = new GatewayUsers(d.kv, d.clock);
    const begin = await handleSpotify(req('POST', '/api/spotify/link', { cookie, body: {} }), 'link', d);
    const { url } = (await begin.json()) as { url: string };
    await handleSpotify(req('GET', url, { cookie, origin: null }), 'callback', d);
    const cleanup = vi
      .spyOn(KvSpotifyStore.prototype, 'deleteUser')
      .mockRejectedValueOnce(new Error('temporary cleanup failure'));
    await expect(users.delete(user.username)).rejects.toThrow('temporary cleanup failure');
    expect((await users.get(user.username))?.deleting).toBe(true);
    expect(await sessions.validate(req('GET', '/api/auth/me', { cookie }))).toBeNull();
    await users.delete(user.username);
    expect(await users.get(user.username)).toBeNull();
    expect(await new KvSpotifyStore(d.kv).get(user.id)).toBeNull();
    cleanup.mockRestore();
  });
  test('password change authorized before deletion cannot overwrite its tombstone or recreate user', async () => {
    const { d, user } = await setup();
    const users = new GatewayUsers(d.kv, d.clock);
    let allowPassword!: () => void;
    const gate = new Promise<void>((resolve) => {
      allowPassword = resolve;
    });
    let passwordReady!: () => void;
    const reached = new Promise<void>((resolve) => {
      passwordReady = resolve;
    });
    const cas = d.kv.compareAndSet.bind(d.kv);
    vi.spyOn(d.kv, 'compareAndSet').mockImplementation(async (key, expected, value) => {
      if (key === `spk:user:${user.username}` && value && !(value as { deleting?: boolean }).deleting) {
        passwordReady();
        await gate;
      }
      return cas(key, expected, value);
    });
    const password = users.setPassword(user.username, 'Changed#2026');
    const result = password.catch((error) => error);
    await reached;
    await users.delete(user.username);
    allowPassword();
    expect(await result).toMatchObject({ status: 404 });
    expect(await users.get(user.username)).toBeNull();
  });
  test('status is authenticated, origin exact and disabled module does not fetch', async () => {
    const d = makeDeps();
    const f = vi.fn();
    d.fetch = f;
    expect((await handle(() => handleSpotify(req('GET', '/api/spotify/status'), 'status', d))).status).toBe(
      401,
    );
    const { d: fake, cookie } = await setup();
    expect(
      (
        await handle(() =>
          handleSpotify(
            req('POST', '/api/spotify/link', { cookie, origin: 'https://foreign.test', body: {} }),
            'link',
            fake,
          ),
        )
      ).status,
    ).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
  test('link initiated on JWT renewal preserves session family and access token stays no-store', async () => {
    const { d, cookie } = await setup();
    d.clock.advance(HOUR + 1);
    const begin = await handleSpotify(
      req('POST', '/api/spotify/link', { cookie, body: { capability: 'playback' } }),
      'link',
      d,
    );
    const renewed = sessionCookie(begin)!;
    expect(renewed).toBeTruthy();
    expect(renewed).not.toBe(cookie);
    const { url } = (await begin.json()) as { url: string };
    const callback = await handleSpotify(req('GET', url, { cookie: renewed, origin: null }), 'callback', d);
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe('/settings?spotify=linked');
    const token = await handleSpotify(req('POST', '/api/spotify/token', { cookie: renewed }), 'token', d);
    expect(token.status).toBe(200);
    expect(token.headers.get('cache-control')).toBe('no-store');
    expect(token.headers.get('vary')).toBe('Cookie');
    expect(await token.json()).toMatchObject({ accessToken: 'fake-access' });
    const status = await handleSpotify(req('GET', '/api/spotify/status', { cookie: renewed }), 'status', d);
    expect(await status.text()).not.toContain('fake-access');
  });
  test('same local user different login cannot complete initiating session callback', async () => {
    const { d, user, sessions, cookie } = await setup();
    const link = await handleSpotify(req('POST', '/api/spotify/link', { cookie, body: {} }), 'link', d);
    const { url } = (await link.json()) as { url: string };
    const other = (await sessions.issue(user)).cookie.split(';')[0]!;
    const callback = await handleSpotify(req('GET', url, { cookie: other, origin: null }), 'callback', d);
    expect(callback.headers.get('location')).toContain('failed');
    expect(await new KvSpotifyStore(d.kv).get(user.id)).toBeNull();
  });
  test('user deletion fences pending and cleans encrypted link across service instances', async () => {
    const { d, user, cookie } = await setup();
    const a = new KvSpotifyStore(d.kv);
    const b = new KvSpotifyStore(d.kv);
    const begin = await handleSpotify(req('POST', '/api/spotify/link', { cookie, body: {} }), 'link', d);
    const { url } = (await begin.json()) as { url: string };
    await handleSpotify(req('GET', url, { cookie, origin: null }), 'callback', d);
    expect(await b.get(user.id)).not.toBeNull();
    await new GatewayUsers(d.kv, d.clock).delete('tester');
    expect(await a.get(user.id)).toBeNull();
    expect(await b.generation(user.id)).toBe(1);
  });
});
describe('distributed persistence contract on shared KV', () => {
  test('two store instances atomically claim account, consume once, lease ownership and fence unlink', async () => {
    const d = makeDeps();
    const a = new KvSpotifyStore(d.kv);
    const b = new KvSpotifyStore(d.kv);
    const link: SpotifyLink = {
      userId: 'u',
      accountId: 'spotify-account',
      envelope: 'ciphertext',
      scopes: [],
      expiresAt: 100000,
      authorizedAt: 0,
      version: 1,
      generation: 0,
      displayName: null,
      entitlement: 'unknown',
      reauth: false,
    };
    const results = await Promise.all([a.save(link, null), b.save({ ...link, userId: 'v' }, null)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await a.putAttempt('state', {
      userId: 'u',
      sessionHash: 'session',
      protectedVerifier: 'encrypted',
      redirectUri: 'https://app.test',
      scopes: [],
      generation: 0,
      expiresAt: 1000,
    });
    const attempts = await Promise.all([
      a.consumeAttempt('state', 'u', 'session', 1),
      b.consumeAttempt('state', 'u', 'session', 1),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(await a.acquire('u', 'old', 0, 10)).toBe(true);
    expect(await b.acquire('u', 'new', 11, 10)).toBe(true);
    await a.release('u', 'old');
    expect(await a.acquire('u', 'third', 12, 10)).toBe(false);
    expect(await a.save({ ...link, version: 2 }, 1, { owner: 'old', now: 12 })).toBe(false);
    await b.unlink('u');
    expect(await a.save({ ...link, version: 2 }, 1)).toBe(false);
    expect(await b.get('u')).toBeNull();
  });
  test('independent token managers use one refresh across two instances', async () => {
    const d = makeDeps();
    const a = new KvSpotifyStore(d.kv);
    const b = new KvSpotifyStore(d.kv);
    const c = {
      ...spotifyConfig({ NODE_ENV: 'test', SPOTIFY_FAKE: 'true' }),
      mode: 'live' as const,
      policyResolved: true,
    };
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })));
    const first = new SpotifyService(c, a, { now: () => d.clock.now(), fetch: f });
    const second = new SpotifyService(c, b, { now: () => d.clock.now(), fetch: f });
    await a.save(
      {
        userId: 'u',
        accountId: 'account',
        envelope: first.cipher.seal('u', { accessToken: 'old', refreshToken: 'refresh' }),
        scopes: [],
        expiresAt: 0,
        authorizedAt: d.clock.now(),
        version: 1,
        generation: 0,
        displayName: null,
        entitlement: 'unknown',
        reauth: false,
      },
      null,
    );
    const results = await Promise.all([first.token('u'), second.token('u')]);
    expect(results[0]).toEqual(results[1]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
