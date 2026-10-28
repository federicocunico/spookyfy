import { afterEach, describe, expect, test } from 'vitest';
import {
  DAY,
  MINUTE,
  STRONG_PASSWORD,
  TEST_ORIGIN,
  type TestContext,
  type TestContextOptions,
  apiClient,
  createTestContext,
  createUser,
  login,
  sessionCookieFrom,
} from './helpers.js';

let ctx: TestContext;
afterEach(() => ctx?.cleanup());

const setup = async (opts?: TestContextOptions) => {
  ctx = await createTestContext(opts);
  return ctx;
};

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url,
    payload: payload as never,
    headers: { origin: TEST_ORIGIN, ...headers },
  });

const register = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  post(
    '/api/auth/register',
    { username: 'fede', password: STRONG_PASSWORD, token: 'spotifymerdacostosa2026', ...body },
    headers,
  );

describe('login, me e logout', () => {
  test('login riuscito imposta un cookie di sessione sicuro', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const res = await post('/api/auth/login', { username: 'FEDE', password: STRONG_PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: 'fede' });
    const c = res.cookies.find((c) => c.name === 'spk_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.path).toBe('/');
    expect(c.maxAge).toBe(30 * 24 * 3600);

    const me = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie: sessionCookieFrom(res)! } });
    expect(me.json()).toMatchObject({ username: 'fede' });
  });

  test('credenziali errate e utente inesistente danno lo stesso messaggio', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const wrong = await post('/api/auth/login', { username: 'fede', password: 'Sbagliata#1' });
    const missing = await post('/api/auth/login', { username: 'nessuno', password: 'Sbagliata#1' });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  test('dopo il logout il cookie non è più valido', async () => {
    await setup();
    const cookie = await (async () => {
      await createUser(ctx, 'fede');
      return login(ctx, 'fede');
    })();
    const out = await post('/api/auth/logout', {}, { cookie });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'spk_session')?.value).toBe('');
    const me = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe('registrazione con token di invito', () => {
  test('registrazione riuscita con il token predefinito avvia la sessione', async () => {
    await setup();
    const res = await register({});
    expect(res.statusCode).toBe(201);
    const cookie = sessionCookieFrom(res)!;
    const me = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ username: 'fede' });
  });

  test('token errato: nessun account creato', async () => {
    await setup();
    const res = await register({ token: 'abc123' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('INVALID_REGISTRATION_TOKEN');
    expect((await post('/api/auth/login', { username: 'fede', password: STRONG_PASSWORD })).statusCode).toBe(
      401,
    );
  });

  test('token personalizzato: quello predefinito non vale più', async () => {
    await setup({ env: { REGISTRATION_TOKEN: 'segreto-di-casa' } });
    expect((await register({})).statusCode).toBe(403);
    expect((await register({ token: 'segreto-di-casa' })).statusCode).toBe(201);
  });

  test('token vuoto: registrazione disabilitata', async () => {
    await setup({ env: { REGISTRATION_TOKEN: '' } });
    const res = await register({ token: '' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('REGISTRATION_DISABLED');
  });

  test('username esistente con token errato: solo errore di token', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const res = await register({ token: 'sbagliato' });
    expect(res.json().error.code).toBe('INVALID_REGISTRATION_TOKEN');
    expect(JSON.stringify(res.json())).not.toMatch(/username/i);
  });

  test('username già in uso (maiuscole ignorate)', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const res = await register({ username: 'Fede' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'USERNAME_TAKEN',
      fields: { username: ['Username non disponibile'] },
    });
  });

  test('validazione di username e password', async () => {
    await setup();
    const badUser = await register({ username: 'fede!' });
    expect(badUser.statusCode).toBe(400);
    expect(badUser.json().error.fields.username).toBeDefined();
    const badPw = await register({ password: 'notte2026' });
    expect(badPw.statusCode).toBe(400);
    expect(badPw.json().error.fields.password.join()).toContain('carattere speciale');
  });

  test('due registrazioni concorrenti con lo stesso username creano un solo account', async () => {
    await setup();
    const [a, b] = await Promise.all([register({}), register({ username: 'FEDE' })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });
});

describe('sessione', () => {
  test('rinnovata dall’uso: valida a 20 e poi a 45 giorni dal login', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const cookie = await login(ctx, 'fede');
    ctx.clock.advance(20 * DAY);
    const first = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    // Il rinnovo reimposta anche la durata del cookie.
    expect(first.cookies.find((c) => c.name === 'spk_session')?.maxAge).toBe(30 * 24 * 3600);
    ctx.clock.advance(25 * DAY);
    expect((await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });

  test('scaduta dopo 30 giorni di inattività', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const cookie = await login(ctx, 'fede');
    ctx.clock.advance(30 * DAY + 1);
    const res = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  test('il DB viene aggiornato al massimo una volta all’ora', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const cookie = await login(ctx, 'fede');
    ctx.clock.advance(30 * MINUTE);
    const res = await ctx.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(res.cookies.find((c) => c.name === 'spk_session')).toBeUndefined();
  });

  test('l’app shell e la health sono pubbliche, il resto dell’API no', async () => {
    await setup({ withWebDist: true });
    expect((await ctx.app.inject('/')).statusCode).toBe(200);
    expect((await ctx.app.inject('/api/health')).statusCode).toBe(200);
    expect((await ctx.app.inject('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('rate limit', () => {
  test('sesto login rifiutato anche con password corretta, poi la finestra si libera', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const ip = { 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 0; i < 5; i++) {
      ctx.clock.advance(2 * MINUTE);
      expect(
        (await post('/api/auth/login', { username: 'fede', password: 'Sbagliata#1' }, ip)).statusCode,
      ).toBe(401);
    }
    const sixth = await post('/api/auth/login', { username: 'fede', password: STRONG_PASSWORD }, ip);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);

    // Un altro IP non è bloccato.
    const other = await post(
      '/api/auth/login',
      { username: 'fede', password: STRONG_PASSWORD },
      { 'cf-connecting-ip': '198.51.100.1' },
    );
    expect(other.statusCode).toBe(200);

    // 15 minuti dopo il primo tentativo fallito.
    ctx.clock.advance(15 * MINUTE - 10 * MINUTE + 2 * MINUTE);
    expect(
      (await post('/api/auth/login', { username: 'fede', password: STRONG_PASSWORD }, ip)).statusCode,
    ).toBe(200);
  });

  test('registrazione: sesto tentativo bloccato anche con token corretto', async () => {
    await setup();
    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    for (let i = 0; i < 5; i++) expect((await register({ token: `x${i}` }, ip)).statusCode).toBe(403);
    const sixth = await register({}, ip);
    expect(sixth.statusCode).toBe(429);
    ctx.clock.advance(15 * MINUTE);
    expect((await register({}, ip)).statusCode).toBe(201);
  });
});

describe('controllo Origin', () => {
  test('richiesta con Origin estraneo rifiutata, con PUBLIC_ORIGIN accettata', async () => {
    await setup();
    await createUser(ctx, 'fede');
    const evil = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'fede', password: STRONG_PASSWORD },
    });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('FORBIDDEN_ORIGIN');
    const noOrigin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'anna', password: STRONG_PASSWORD, token: 'spotifymerdacostosa2026' },
    });
    expect(noOrigin.statusCode).toBe(403);
    const cookie = await login(ctx, 'fede');
    expect((await apiClient(ctx, cookie).get('/api/auth/me')).statusCode).toBe(200);
  });
});
