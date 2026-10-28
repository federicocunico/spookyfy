import { describe, expect, test } from 'vitest';
import { GatewayUsers, handleAuth } from '../lib/auth.js';
import { runGatewayCli } from '../lib/cli.js';
import { handleSearch } from '../lib/handlers.js';
import { handle } from '../lib/http.js';
import { DAY, MINUTE, PASSWORD, TOKEN, makeDeps, req, sessionCookie } from './helpers.js';

type Deps = ReturnType<typeof makeDeps>;
const call = (d: Deps, action: string, r: Request) => handle(() => handleAuth(r, action, d));
const register = (d: Deps, body: Record<string, unknown> = {}, ip?: string) =>
  call(
    d,
    'register',
    req('POST', '/api/auth/register', {
      body: { username: 'fede', password: PASSWORD, token: TOKEN, ...body },
      ip,
    }),
  );
const login = (d: Deps, username = 'fede', password = PASSWORD, ip?: string) =>
  call(d, 'login', req('POST', '/api/auth/login', { body: { username, password }, ip }));
const me = (d: Deps, cookie?: string) => call(d, 'me', req('GET', '/api/auth/me', { cookie, origin: null }));

describe('registrazione', () => {
  test('riuscita con il token: account creato e sessione avviata', async () => {
    const d = makeDeps();
    const res = await register(d);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ username: 'fede' });
    const cookie = res.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect((await me(d, sessionCookie(res))).status).toBe(200);
  });

  test('token errato, token vuoto (registrazione disabilitata)', async () => {
    const d = makeDeps();
    const wrong = await register(d, { token: 'abc' });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error.code).toBe('INVALID_REGISTRATION_TOKEN');
    const disabled = makeDeps({ env: { REGISTRATION_TOKEN: '' } });
    expect((await (await register(disabled, { token: '' })).json()).error.code).toBe('REGISTRATION_DISABLED');
  });

  test('FEDE dopo fede: username non disponibile; con token errato solo errore di token', async () => {
    const d = makeDeps();
    await register(d);
    const taken = await register(d, { username: 'FEDE' });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe('USERNAME_TAKEN');
    const wrongToken = await register(d, { username: 'FEDE', token: 'x' });
    expect((await wrongToken.json()).error.code).toBe('INVALID_REGISTRATION_TOKEN');
  });

  test('registrazioni concorrenti: un solo account', async () => {
    const d = makeDeps();
    const [a, b] = await Promise.all([register(d), register(d, { username: 'Fede' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await new GatewayUsers(d.kv, d.clock).list()).length).toBe(1);
  });

  test('regole di username e password condivise con l’on-premise', async () => {
    const d = makeDeps();
    expect((await register(d, { username: 'fe' })).status).toBe(400);
    const pw = await (await register(d, { password: 'notte2026' })).json();
    expect(pw.error.fields.password.join()).toContain('carattere speciale');
  });

  test('origine estranea rifiutata', async () => {
    const d = makeDeps();
    const res = await call(
      d,
      'register',
      req('POST', '/api/auth/register', {
        body: { username: 'fede', password: PASSWORD, token: TOKEN },
        origin: 'https://evil.example',
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN_ORIGIN');
  });
});

describe('login, sessione e logout', () => {
  test('credenziali errate e utente inesistente: stesso messaggio', async () => {
    const d = makeDeps();
    await register(d);
    const a = await (await login(d, 'fede', 'Sbagliata#1')).json();
    const b = await (await login(d, 'nessuno', 'Sbagliata#1')).json();
    expect(a).toEqual(b);
    expect(a.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('rinnovo dopo un’ora e validità a 20 e 45 giorni con l’uso', async () => {
    const d = makeDeps();
    await register(d);
    let cookie = sessionCookie(await login(d, 'FEDE'))!;
    d.clock.advance(30 * MINUTE);
    expect((await me(d, cookie)).headers.getSetCookie()).toEqual([]);
    d.clock.advance(20 * DAY);
    const renewed = await me(d, cookie);
    expect(renewed.status).toBe(200);
    cookie = sessionCookie(renewed)!;
    d.clock.advance(25 * DAY);
    expect((await me(d, cookie)).status).toBe(200);
  });

  test('scadenza dopo 30 giorni di inattività', async () => {
    const d = makeDeps();
    await register(d);
    const cookie = sessionCookie(await login(d))!;
    d.clock.advance(30 * DAY + 1000);
    expect((await me(d, cookie)).status).toBe(401);
  });

  test('riuso del cookie dopo il logout: rifiutato', async () => {
    const d = makeDeps();
    await register(d);
    const cookie = sessionCookie(await login(d))!;
    const out = await call(d, 'logout', req('POST', '/api/auth/logout', { cookie }));
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
    expect((await me(d, cookie)).status).toBe(401);
  });

  test('cambio password: tutte le sessioni invalidate', async () => {
    const d = makeDeps();
    await register(d);
    const a = sessionCookie(await login(d))!;
    const b = sessionCookie(await login(d))!;
    await new GatewayUsers(d.kv, d.clock).setPassword('fede', 'Nuova_2026');
    expect((await me(d, a)).status).toBe(401);
    expect((await me(d, b)).status).toBe(401);
    expect((await login(d, 'fede', 'Nuova_2026')).status).toBe(200);
  });

  test('cookie manomesso rifiutato', async () => {
    const d = makeDeps();
    await register(d);
    const cookie = sessionCookie(await login(d))!;
    expect((await me(d, `${cookie.slice(0, -3)}abc`)).status).toBe(401);
  });

  test('ricerca e proxy rifiutati senza sessione, senza contattare YouTube', async () => {
    const d = makeDeps();
    let called = false;
    d.youtube.search = async () => {
      called = true;
      return [];
    };
    const res = await handle(() => handleSearch(req('GET', '/api/search?q=prova', { origin: null }), d));
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });
});

describe('limite ai tentativi su KV', () => {
  test('sesto login rifiutato anche se arriva a un’altra istanza, poi la finestra si libera', async () => {
    const d = makeDeps();
    await register(d);
    // Due "istanze" condividono il KV e l'orologio, non la memoria.
    const other = { ...makeDeps(), kv: d.kv, clock: d.clock };
    for (let i = 0; i < 5; i++) {
      expect((await login(i % 2 ? other : d, 'fede', 'Sbagliata#1', '198.51.100.9')).status).toBe(401);
    }
    const sixth = await login(other, 'fede', PASSWORD, '198.51.100.9');
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login(d, 'fede', PASSWORD, '198.51.100.10')).status).toBe(200);
    d.clock.advance(15 * MINUTE);
    expect((await login(d, 'fede', PASSWORD, '198.51.100.9')).status).toBe(200);
  });

  test('registrazione: sesto tentativo bloccato anche con token corretto', async () => {
    const d = makeDeps();
    for (let i = 0; i < 5; i++)
      expect((await register(d, { token: `x${i}` }, '198.51.100.20')).status).toBe(403);
    expect((await register(d, {}, '198.51.100.20')).status).toBe(429);
  });
});

describe('CLI degli account', () => {
  const io = (d: Deps, passwords: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        kv: d.kv,
        clock: d.clock,
        interactive: false,
        readPassword: async () => passwords.shift() ?? '',
        out: (l: string) => out.push(l),
        err: (l: string) => err.push(l),
      },
    };
  };

  test('creazione, elenco, cambio password ed eliminazione', async () => {
    const d = makeDeps();
    const c = io(d, ['Luna_2026']);
    expect(await runGatewayCli(['user:create', 'anna'], c.io)).toBe(0);
    expect((await login(d, 'anna', 'Luna_2026')).status).toBe(200);
    const l = io(d, []);
    await runGatewayCli(['user:list'], l.io);
    expect(l.out.join()).toContain('anna');
    expect(await runGatewayCli(['user:passwd', 'anna'], io(d, ['Sole_2027']).io)).toBe(0);
    expect((await login(d, 'anna', 'Sole_2027')).status).toBe(200);
    expect(await runGatewayCli(['user:delete', 'anna'], io(d, []).io)).toBe(0);
    expect((await login(d, 'anna', 'Sole_2027')).status).toBe(401);
  });

  test('password non conforme', async () => {
    const d = makeDeps();
    const c = io(d, ['luna']);
    expect(await runGatewayCli(['user:create', 'anna'], c.io)).toBe(1);
    expect(c.err.join()).toContain('carattere speciale');
  });
});
