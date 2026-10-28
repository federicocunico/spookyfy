import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ErrorCode,
  type MeDto,
  loginBodySchema,
  normalizeUsername,
  registerBodySchema,
} from '@spookyfy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import { HttpError, parseOrThrow } from '../http-errors.js';
import { bearerToken, isBridgeRoute } from './bridge.js';
import { FailureRateLimiter } from './rate-limit.js';
import { SESSION_TTL_MS, type SessionService } from './sessions.js';
import type { AccessTokenService } from './tokens.js';
import type { UserService } from './users.js';

export const SESSION_COOKIE = 'spk_session';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** Tentativi con token di accesso non valido tollerati per IP nella finestra. */
const TOKEN_RATE_LIMIT_MAX = 20;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Rotta API accessibile senza sessione. */
    public?: boolean;
  }
  interface FastifyRequest {
    user?: MeDto;
    /** Come è stata autenticata la richiesta. */
    authKind?: 'session' | 'token';
  }
}

/** L'utente autenticato: da usare solo nelle rotte non pubbliche. */
export function currentUser(request: FastifyRequest): MeDto {
  if (!request.user) throw new HttpError(401, ErrorCode.Unauthenticated, 'Sessione non valida');
  return request.user;
}

export function clientIp(request: FastifyRequest, trustCfHeaders: boolean): string {
  const cf = request.headers['cf-connecting-ip'];
  if (trustCfHeaders && typeof cf === 'string' && cf.trim()) return cf.trim();
  return request.ip;
}

/** Confronto in tempo costante, indipendente anche dalla lunghezza dei due valori. */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function tooManyRequests(retryAfterMs: number): HttpError {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new HttpError(
    429,
    ErrorCode.TooManyRequests,
    `Troppi tentativi. Riprova tra ${Math.ceil(seconds / 60)} minuti.`,
    undefined,
    { 'retry-after': String(seconds) },
  );
}

export interface AuthServices {
  users: UserService;
  sessions: SessionService;
  tokens: AccessTokenService;
}

export function isApiUrl(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

/**
 * Hook globali (origine e sessione) e rotte di autenticazione. Registrato
 * direttamente sull'istanza radice, così gli hook valgono per tutte le rotte.
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext, services: AuthServices): void {
  const { config, clock } = ctx;
  const { users, sessions, tokens } = services;
  const bridgeEnabled = config.bridgeAllowedOrigins.length > 0;
  const tokenLimiter = new FailureRateLimiter(TOKEN_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, clock);
  const loginLimiter = new FailureRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, clock);
  const registerLimiter = new FailureRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, clock);

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: number) => {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.max(0, Math.floor((expiresAt - clock.now()) / 1000)),
    });
  };

  app.addHook('onRequest', async (request, reply) => {
    if (!isApiUrl(request.url) || request.method === 'OPTIONS') return;

    // Ponte: token di accesso personale, solo sulle rotte del ponte. Il browser non
    // allega il token da solo e un sito terzo non lo conosce: niente rischio CSRF, quindi
    // niente controllo Origin. Vale anche se la richiesta porta un cookie (alcuni browser
    // lo inviano nonostante credentials: "omit"): il token valido ha la precedenza.
    const bearer = bearerToken(request);
    if (bearer && bridgeEnabled && isBridgeRoute(request.method, request.url)) {
      const ip = clientIp(request, config.trustCfHeaders);
      const wait = tokenLimiter.retryAfterMs(ip);
      if (wait > 0) throw tooManyRequests(wait);
      const user = tokens.validate(bearer);
      if (!user) {
        tokenLimiter.recordFailure(ip);
        throw new HttpError(401, ErrorCode.Unauthenticated, 'Token di accesso non valido o revocato');
      }
      request.user = user;
      request.authKind = 'token';
      return;
    }

    if (UNSAFE_METHODS.has(request.method) && request.headers.origin !== config.publicOrigin) {
      throw new HttpError(403, ErrorCode.ForbiddenOrigin, 'Origine della richiesta non consentita');
    }
    if (request.routeOptions.config?.public) return;

    const token = request.cookies[SESSION_COOKIE];
    const session = sessions.validate(token);
    if (!session || !token) {
      throw new HttpError(401, ErrorCode.Unauthenticated, 'Sessione non valida o scaduta');
    }
    request.user = session.user;
    request.authKind = 'session';
    if (session.renewed) setSessionCookie(reply, token, session.expiresAt);
  });

  app.post('/api/auth/login', { config: { public: true } }, async (request, reply) => {
    const body = parseOrThrow(loginBodySchema, request.body);
    const key = `${clientIp(request, config.trustCfHeaders)}|${normalizeUsername(body.username)}`;
    const wait = loginLimiter.retryAfterMs(key);
    if (wait > 0) throw tooManyRequests(wait);

    const user = await users.verifyCredentials(body.username, body.password);
    if (!user) {
      loginLimiter.recordFailure(key);
      throw new HttpError(401, ErrorCode.InvalidCredentials, 'Username o password non validi');
    }
    loginLimiter.reset(key);
    const { token, expiresAt } = sessions.create(user.id);
    setSessionCookie(reply, token, expiresAt);
    return user satisfies MeDto;
  });

  app.post('/api/auth/register', { config: { public: true } }, async (request, reply) => {
    const ip = clientIp(request, config.trustCfHeaders);
    const wait = registerLimiter.retryAfterMs(ip);
    if (wait > 0) throw tooManyRequests(wait);
    if (config.registrationToken === '') {
      throw new HttpError(
        403,
        ErrorCode.RegistrationDisabled,
        'La registrazione è disabilitata su questo server',
      );
    }
    // Ordine: formato → token → unicità. Senza token valido non si scopre se uno username esiste.
    const body = parseOrThrow(registerBodySchema, request.body);
    if (!tokenMatches(body.token, config.registrationToken)) {
      registerLimiter.recordFailure(ip);
      throw new HttpError(403, ErrorCode.InvalidRegistrationToken, 'Token di invito non valido', {
        token: ['Token di invito non valido'],
      });
    }
    const user = await users.create(body.username, body.password);
    const { token, expiresAt } = sessions.create(user.id);
    setSessionCookie(reply, token, expiresAt);
    reply.status(201);
    return user satisfies MeDto;
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) sessions.revoke(token);
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
    });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (request) => currentUser(request));
}

export { SESSION_TTL_MS };
