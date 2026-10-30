import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import {
  ErrorCode,
  type MeDto,
  loginBodySchema,
  normalizeUsername,
  passwordSchema,
  registerBodySchema,
  usernameSchema,
} from '@spookyfy/shared';
import { SignJWT, jwtVerify } from 'jose';
import type { GatewayConfig } from './config.js';
import {
  HttpError,
  assertOrigin,
  clientIp,
  cookies,
  json,
  parseOrThrow,
  readJson,
  serializeCookie,
} from './http.js';
import type { Clock, Kv } from './kv.js';

export const SESSION_COOKIE = 'spk_session';
const SESSION_TTL_S = 30 * 24 * 60 * 60;
const RENEW_AFTER_S = 60 * 60;
const RATE_MAX = 5;
const RATE_WINDOW_S = 15 * 60;
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
  /** Incrementato a ogni cambio password: invalida tutte le sessioni. */
  epoch: number;
  /** Retryable account deletion; never authenticates while cleanup is pending. */
  deleting?: true;
}

const userKey = (username: string) => `spk:user:${normalizeUsername(username)}`;
const USERS_SET = 'spk:users';
const revokedKey = (jti: string) => `spk:revoked:${jti}`;

export const toMe = (u: UserRecord): MeDto => ({ id: u.id, username: u.username, createdAt: u.createdAt });

function validation(field: string, messages: string[]): HttpError {
  return new HttpError(400, ErrorCode.ValidationFailed, messages[0] ?? 'Valore non valido', {
    [field]: messages,
  });
}

function usernameTaken(): HttpError {
  return new HttpError(409, ErrorCode.UsernameTaken, 'Username non disponibile', {
    username: ['Username non disponibile'],
  });
}

export function tokenMatches(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

let dummyHash: Promise<string> | undefined;

/** Account del gateway sul KV, con le stesse regole dell'on-premise. */
export class GatewayUsers {
  constructor(
    private readonly kv: Kv,
    private readonly clock: Clock,
  ) {}

  get(username: string): Promise<UserRecord | null> {
    return this.kv.get<UserRecord>(userKey(username));
  }

  async create(username: string, password: string): Promise<UserRecord> {
    const u = usernameSchema.safeParse(username);
    if (!u.success)
      throw validation(
        'username',
        u.error.issues.map((i) => i.message),
      );
    const p = passwordSchema.safeParse(password);
    if (!p.success)
      throw validation(
        'password',
        p.error.issues.map((i) => i.message),
      );
    if (await this.get(username)) throw usernameTaken();
    const record: UserRecord = {
      id: randomBytes(12).toString('base64url'),
      username,
      passwordHash: await hash(password, ARGON),
      createdAt: this.clock.now(),
      epoch: 0,
    };
    // SET NX: garanzia di unicità anche con registrazioni concorrenti su istanze diverse.
    if (!(await this.kv.set(userKey(username), record, { nx: true }))) throw usernameTaken();
    await this.kv.sadd(USERS_SET, normalizeUsername(username));
    return record;
  }

  async verify(username: string, password: string): Promise<UserRecord | null> {
    const user = await this.get(username);
    if (!user || user.deleting) {
      dummyHash ??= hash('spookyfy-dummy-password#1', ARGON);
      await verify(await dummyHash, password).catch(() => false);
      return null;
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    return ok ? user : null;
  }

  async setPassword(username: string, password: string): Promise<void> {
    const p = passwordSchema.safeParse(password);
    if (!p.success)
      throw validation(
        'password',
        p.error.issues.map((i) => i.message),
      );
    const passwordHash = await hash(password, ARGON);
    for (let attempt = 0; attempt < 20; attempt++) {
      const user = await this.get(username);
      if (!user || user.deleting)
        throw new HttpError(404, ErrorCode.NotFound, `Utente ${username} non trovato`);
      if (
        await this.kv.compareAndSet(userKey(username), user, { ...user, passwordHash, epoch: user.epoch + 1 })
      )
        return;
    }
    throw new HttpError(503, ErrorCode.Internal, 'Account temporaneamente non disponibile');
  }

  async list(): Promise<UserRecord[]> {
    const names = (await this.kv.smembers(USERS_SET)).sort();
    const users = await Promise.all(names.map((n) => this.get(n)));
    return users.filter((u): u is UserRecord => u !== null);
  }

  async delete(username: string): Promise<void> {
    let deleting: UserRecord | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const user = await this.get(username);
      if (!user) throw new HttpError(404, ErrorCode.NotFound, `Utente ${username} non trovato`);
      if (user.deleting) {
        deleting = user;
        break;
      }
      const tombstone: UserRecord = { ...user, deleting: true, epoch: user.epoch + 1 };
      if (await this.kv.compareAndSet(userKey(username), user, tombstone)) {
        deleting = tombstone;
        break;
      }
    }
    if (!deleting) throw new HttpError(503, ErrorCode.Internal, 'Account temporaneamente non disponibile');
    const { KvSpotifyStore } = await import('./spotify-store.js');
    // This second, provider-level tombstone fences requests authorized before
    // the user tombstone, including attempts created after the generation bump.
    await new KvSpotifyStore(this.kv).deleteUser(deleting.id);
    // Exact record and listing are removed together: concurrent cleanup cannot
    // remove the listing of a later registration reusing this username.
    await this.kv.compareAndDeleteMember(userKey(username), deleting, USERS_SET, normalizeUsername(username));
  }
}

interface Claims {
  sub: string;
  usr: string;
  ep: number;
  jti: string;
  iat: number;
  exp: number;
}

/** Sessioni firmate (JWT HS256) senza stato; il KV serve solo per revoche e invalidazioni. */
export class GatewaySessions {
  private readonly key: Uint8Array;

  constructor(
    private readonly kv: Kv,
    private readonly clock: Clock,
    private readonly config: Pick<GatewayConfig, 'sessionSecret' | 'cookieSecure'>,
  ) {
    this.key = new TextEncoder().encode(config.sessionSecret);
  }

  private nowS() {
    return Math.floor(this.clock.now() / 1000);
  }

  async issue(user: UserRecord, sessionId?: string): Promise<{ token: string; cookie: string }> {
    const current = await this.kv.get<UserRecord>(userKey(user.username));
    if (
      !current ||
      current.deleting ||
      user.deleting ||
      current.id !== user.id ||
      current.epoch !== user.epoch
    )
      throw new HttpError(401, ErrorCode.Unauthenticated, 'Sessione non valida o scaduta');
    const iat = this.nowS();
    const token = await new SignJWT({ usr: normalizeUsername(user.username), ep: user.epoch })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setJti(sessionId ?? randomBytes(12).toString('base64url'))
      .setIssuedAt(iat)
      .setExpirationTime(iat + SESSION_TTL_S)
      .sign(this.key);
    return {
      token,
      cookie: serializeCookie(SESSION_COOKIE, token, {
        maxAgeSeconds: SESSION_TTL_S,
        secure: this.config.cookieSecure,
      }),
    };
  }

  clearCookie(): string {
    return serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: this.config.cookieSecure });
  }

  private async claims(token: string | undefined): Promise<Claims | null> {
    if (!token || token.length > 2048) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        currentDate: new Date(this.clock.now()),
      });
      return payload as unknown as Claims;
    } catch {
      return null;
    }
  }

  /** Utente della sessione; `renewCookie` se il token va rinnovato. */
  async validate(
    req: Request,
  ): Promise<{ user: UserRecord; sessionId: string; renewCookie?: string } | null> {
    const c = await this.claims(cookies(req)[SESSION_COOKIE]);
    if (!c) return null;
    const [user, revoked] = await this.kv.mget<[UserRecord, number]>(`spk:user:${c.usr}`, revokedKey(c.jti));
    if (!user || user.deleting || revoked || user.id !== c.sub || user.epoch !== c.ep) return null;
    if (this.nowS() - c.iat >= RENEW_AFTER_S) {
      const { cookie } = await this.issue(user, c.jti);
      return { user, sessionId: c.jti, renewCookie: cookie };
    }
    return { user, sessionId: c.jti };
  }

  async revoke(req: Request): Promise<void> {
    const c = await this.claims(cookies(req)[SESSION_COOKIE]);
    // A renewed JWT keeps its session family ID. A previous token can revoke that
    // family too, so retain revocation for the longest possible renewed lifetime.
    if (c) await this.kv.set(revokedKey(c.jti), 1, { exSeconds: SESSION_TTL_S });
  }
}

/** Limite ai tentativi falliti condiviso fra le istanze (contatori sul KV). */
export class KvRateLimiter {
  constructor(
    private readonly kv: Kv,
    private readonly prefix: string,
    private readonly max = RATE_MAX,
    private readonly windowS = RATE_WINDOW_S,
  ) {}

  async assertAllowed(key: string): Promise<void> {
    const k = `spk:rl:${this.prefix}:${key}`;
    const [count] = await this.kv.mget<[number]>(k);
    if ((count ?? 0) >= this.max) {
      const ms = await this.kv.pttl(k);
      const seconds = Math.max(1, Math.ceil(ms / 1000));
      throw new HttpError(
        429,
        ErrorCode.TooManyRequests,
        `Troppi tentativi. Riprova tra ${Math.ceil(seconds / 60)} minuti.`,
        undefined,
        { 'retry-after': String(seconds) },
      );
    }
  }

  recordFailure(key: string): Promise<number> {
    return this.kv.incrWindow(`spk:rl:${this.prefix}:${key}`, this.windowS);
  }

  reset(key: string): Promise<number> {
    return this.kv.del(`spk:rl:${this.prefix}:${key}`);
  }
}

export interface AuthDeps {
  config: GatewayConfig;
  kv: Kv;
  clock: Clock;
}

export function authServices(d: AuthDeps) {
  return {
    users: new GatewayUsers(d.kv, d.clock),
    sessions: new GatewaySessions(d.kv, d.clock, d.config),
    loginLimiter: new KvRateLimiter(d.kv, 'login'),
    registerLimiter: new KvRateLimiter(d.kv, 'reg'),
  };
}

/** Utente autenticato o 401; aggiunge alla risposta l'eventuale cookie rinnovato. */
export async function requireUser(
  req: Request,
  d: AuthDeps,
): Promise<{ user: UserRecord; sessionId: string; headers: Headers }> {
  const s = await authServices(d).sessions.validate(req);
  if (!s) throw new HttpError(401, ErrorCode.Unauthenticated, 'Sessione non valida o scaduta');
  const headers = new Headers();
  if (s.renewCookie) headers.append('set-cookie', s.renewCookie);
  return { user: s.user, sessionId: s.sessionId, headers };
}

/** `api/auth/[action]`: login, logout, me, register. */
export async function handleAuth(req: Request, action: string, d: AuthDeps): Promise<Response> {
  const { users, sessions, loginLimiter, registerLimiter } = authServices(d);
  assertOrigin(req, d.config.publicOrigin);
  const ip = clientIp(req);

  if (action === 'me' && req.method === 'GET') {
    const { user, headers } = await requireUser(req, d);
    return json(200, toMe(user), headers);
  }

  if (action === 'login' && req.method === 'POST') {
    const body = parseOrThrow(loginBodySchema, await readJson(req));
    const key = `${ip}|${normalizeUsername(body.username)}`;
    await loginLimiter.assertAllowed(key);
    const user = await users.verify(body.username, body.password);
    if (!user) {
      await loginLimiter.recordFailure(key);
      throw new HttpError(401, ErrorCode.InvalidCredentials, 'Username o password non validi');
    }
    await loginLimiter.reset(key);
    const { cookie } = await sessions.issue(user);
    return json(200, toMe(user), { 'set-cookie': cookie });
  }

  if (action === 'register' && req.method === 'POST') {
    await registerLimiter.assertAllowed(ip);
    if (d.config.registrationToken === '') {
      throw new HttpError(
        403,
        ErrorCode.RegistrationDisabled,
        'La registrazione è disabilitata su questo server',
      );
    }
    // Ordine: formato → token → unicità, come sull'on-premise.
    const body = parseOrThrow(registerBodySchema, await readJson(req));
    if (!tokenMatches(body.token, d.config.registrationToken)) {
      await registerLimiter.recordFailure(ip);
      throw new HttpError(403, ErrorCode.InvalidRegistrationToken, 'Token di invito non valido', {
        token: ['Token di invito non valido'],
      });
    }
    const user = await users.create(body.username, body.password);
    const { cookie } = await sessions.issue(user);
    return json(201, toMe(user), { 'set-cookie': cookie });
  }

  if (action === 'logout' && req.method === 'POST') {
    await sessions.revoke(req);
    return json(204, null, { 'set-cookie': sessions.clearCookie() });
  }

  throw new HttpError(404, ErrorCode.NotFound, 'Endpoint non trovato');
}
