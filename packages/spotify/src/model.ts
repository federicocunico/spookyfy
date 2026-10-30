import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { SpotifyErrorCode as E, type SpotifyEntitlement } from '@spookyfy/shared';

export class SpotifyError extends Error {
  constructor(
    public readonly code: E,
    public readonly status = 502,
    public readonly retryAfter?: number,
  ) {
    super(code);
    this.name = 'SpotifyError';
  }
}
export const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
export const random = () => randomBytes(32).toString('base64url');
export interface SpotifyConfig {
  mode: 'disabled' | 'misconfigured' | 'fake' | 'live';
  clientId: string;
  redirectUri: string;
  keys: Record<string, string>;
  keyId: string;
  policyResolved: boolean;
  hybridPlayback: boolean;
}
export function spotifyConfig(env: Record<string, string | undefined> = process.env): SpotifyConfig {
  const c: SpotifyConfig = {
    mode: 'disabled',
    clientId: env.SPOTIFY_CLIENT_ID ?? '',
    redirectUri: env.SPOTIFY_REDIRECT_URI ?? '',
    keys: {},
    keyId: env.SPOTIFY_KEY_ID ?? '',
    policyResolved: env.SPOTIFY_POLICY_RESOLVED === 'true',
    hybridPlayback: env.SPOTIFY_HYBRID_PLAYBACK_ENABLED === 'true',
  };
  if (env.SPOTIFY_FAKE === 'true' && ['test', 'development'].includes(env.NODE_ENV ?? '')) {
    c.mode = 'fake';
    c.keyId = 'fake';
    c.keys = { fake: Buffer.alloc(32, 7).toString('base64') };
    return c;
  }
  if (env.SPOTIFY_ENABLED !== 'true') return c;
  c.mode = 'misconfigured';
  try {
    c.keys = JSON.parse(env.SPOTIFY_ENCRYPTION_KEYS ?? '{}') as Record<string, string>;
    const u = new URL(c.redirectUri);
    if (
      u.username ||
      u.password ||
      u.hash ||
      u.search ||
      (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname))) ||
      u.hostname === 'localhost'
    )
      return c;
    if (
      !/^[a-zA-Z0-9]{16,64}$/.test(c.clientId) ||
      !c.keyId ||
      !c.keys[c.keyId] ||
      Object.values(c.keys).some((k) => Buffer.from(k, 'base64').length !== 32)
    )
      return c;
    c.mode = 'live';
  } catch {
    /* Optional module cannot prevent base app boot. */
  }
  return c;
}
/** Authenticated encryption with user, provider and schema version bound as AAD. */
export class TokenCipher {
  constructor(private readonly config: Pick<SpotifyConfig, 'keyId' | 'keys'>) {}
  seal(userId: string, value: unknown): string {
    const nonce = randomBytes(12);
    const key = Buffer.from(this.config.keys[this.config.keyId] ?? '', 'base64');
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`spotify:1:${userId}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify({
      v: 1,
      kid: this.config.keyId,
      n: nonce.toString('base64url'),
      c: ciphertext.toString('base64url'),
      t: cipher.getAuthTag().toString('base64url'),
    });
  }
  open<T>(userId: string, envelope: string): T {
    try {
      const e = JSON.parse(envelope);
      if (e.v !== 1 || !this.config.keys[e.kid]) throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.config.keys[e.kid]!, 'base64'),
        Buffer.from(e.n, 'base64url'),
      );
      decipher.setAAD(Buffer.from(`spotify:1:${userId}`));
      decipher.setAuthTag(Buffer.from(e.t, 'base64url'));
      return JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(e.c, 'base64url')), decipher.final()]).toString(),
      ) as T;
    } catch {
      throw new SpotifyError(E.ReauthRequired, 409);
    }
  }
}
export interface SpotifyLink {
  userId: string;
  accountId: string;
  envelope: string;
  scopes: string[];
  expiresAt: number;
  authorizedAt: number;
  version: number;
  generation: number;
  displayName: string | null;
  entitlement: SpotifyEntitlement;
  reauth: boolean;
}
export interface OAuthAttempt {
  userId: string;
  sessionHash: string;
  protectedVerifier: string;
  redirectUri: string;
  scopes: string[];
  generation: number;
  expiresAt: number;
}
export interface SpotifyStore {
  get(userId: string): Promise<SpotifyLink | null>;
  generation(userId: string): Promise<number>;
  /** Atomically checks generation, version and unique account owner. null means no existing link. */
  save(
    link: SpotifyLink,
    expectedVersion: number | null,
    fence?: { owner: string; now: number },
  ): Promise<boolean>;
  unlink(userId: string): Promise<void>;
  putAttempt(stateHash: string, attempt: OAuthAttempt): Promise<void>;
  /** Consume only if owner/session match; a foreign callback cannot burn another session's pending. */
  consumeAttempt(
    stateHash: string,
    userId: string,
    sessionHash: string,
    now: number,
  ): Promise<OAuthAttempt | null>;
  acquire(userId: string, owner: string, now: number, ttl: number): Promise<boolean>;
  release(userId: string, owner: string): Promise<void>;
  cooldown(): Promise<number>;
  setCooldown(until: number): Promise<void>;
  circuit(now: number, result?: 'success' | 'failure'): Promise<boolean>;
}
export interface CircuitState {
  failures: number;
  until: number;
  probeUntil: number;
}
export function circuitTransition(state: CircuitState, now: number, result?: 'success' | 'failure'): boolean {
  if (result === 'success') {
    state.failures = 0;
    state.until = 0;
    state.probeUntil = 0;
    return true;
  }
  if (result === 'failure') {
    state.failures++;
    state.probeUntil = 0;
    if (state.failures >= 3) state.until = now + 30000;
    return false;
  }
  if (state.until > now || state.probeUntil > now) return false;
  if (state.until > 0) state.probeUntil = now + 12000;
  return true;
}
export class MemorySpotifyStore implements SpotifyStore {
  readonly links = new Map<string, SpotifyLink>();
  readonly attempts = new Map<string, OAuthAttempt>();
  private generations = new Map<string, number>();
  private leases = new Map<string, { owner: string; until: number }>();
  private until = 0;
  private circuitState: CircuitState = { failures: 0, until: 0, probeUntil: 0 };
  async circuit(now: number, result?: 'success' | 'failure') {
    return circuitTransition(this.circuitState, now, result);
  }
  async get(id: string) {
    return structuredClone(this.links.get(id) ?? null);
  }
  async generation(id: string) {
    return this.generations.get(id) ?? 0;
  }
  async save(link: SpotifyLink, version: number | null, fence?: { owner: string; now: number }) {
    if (
      fence &&
      (this.leases.get(link.userId)?.owner !== fence.owner ||
        (this.leases.get(link.userId)?.until ?? 0) <= fence.now)
    )
      return false;
    if (
      (this.generations.get(link.userId) ?? 0) !== link.generation ||
      (this.links.get(link.userId)?.version ?? null) !== version ||
      [...this.links.values()].some((l) => l.accountId === link.accountId && l.userId !== link.userId)
    )
      return false;
    this.links.set(link.userId, structuredClone(link));
    return true;
  }
  async unlink(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.links.delete(id);
    this.leases.delete(id);
    for (const [k, a] of this.attempts) if (a.userId === id) this.attempts.delete(k);
  }
  async putAttempt(k: string, a: OAuthAttempt) {
    this.attempts.set(k, structuredClone(a));
  }
  async consumeAttempt(k: string, u: string, s: string, now: number) {
    const a = this.attempts.get(k);
    if (!a || a.userId !== u || a.sessionHash !== s || a.expiresAt <= now) return null;
    this.attempts.delete(k);
    return structuredClone(a);
  }
  async acquire(id: string, owner: string, now: number, ttl: number) {
    const l = this.leases.get(id);
    if (l && l.until > now) return false;
    this.leases.set(id, { owner, until: now + ttl });
    return true;
  }
  async release(id: string, owner: string) {
    if (this.leases.get(id)?.owner === owner) this.leases.delete(id);
  }
  async cooldown() {
    return this.until;
  }
  async setCooldown(until: number) {
    this.until = Math.max(this.until, until);
  }
}
