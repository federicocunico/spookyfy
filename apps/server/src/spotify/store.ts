import { type OAuthAttempt, type SpotifyLink, type SpotifyStore, circuitTransition } from '@spookyfy/spotify';
import type { Database } from 'better-sqlite3';
export class SqliteSpotifyStore implements SpotifyStore {
  constructor(private readonly db: Database) {}
  async circuit(now: number, result?: 'success' | 'failure') {
    return this.db.transaction(() => {
      const get = (key: string) =>
        (
          this.db.prepare('SELECT value FROM spotify_runtime WHERE key=?').get(key) as
            | { value: number }
            | undefined
        )?.value ?? 0;
      const state = {
        failures: get('failures'),
        until: get('circuit_until'),
        probeUntil: get('probe_until'),
      };
      const allow = circuitTransition(state, now, result);
      const put = this.db.prepare(
        'INSERT INTO spotify_runtime(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      );
      put.run('failures', state.failures);
      put.run('circuit_until', state.until);
      put.run('probe_until', state.probeUntil);
      return allow;
    })();
  }
  async get(id: string): Promise<SpotifyLink | null> {
    const r = this.db.prepare('SELECT * FROM spotify_links WHERE user_id=?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      userId: String(r.user_id),
      accountId: String(r.account_id),
      envelope: String(r.envelope),
      scopes: JSON.parse(String(r.scopes)),
      expiresAt: Number(r.expires_at),
      authorizedAt: Number(r.authorized_at),
      version: Number(r.version),
      generation: Number(r.generation),
      displayName: r.display_name === null ? null : String(r.display_name),
      entitlement: r.entitlement as SpotifyLink['entitlement'],
      reauth: !!r.reauth,
    };
  }
  async generation(id: string) {
    const r = this.db.prepare('SELECT generation FROM spotify_generations WHERE user_id=?').get(id) as
      | { generation: number }
      | undefined;
    return r?.generation ?? 0;
  }
  async save(l: SpotifyLink, version: number | null, fence?: { owner: string; now: number }) {
    return this.db.transaction(() => {
      if (fence) {
        const lease = this.db
          .prepare('SELECT owner,expires_at FROM spotify_leases WHERE user_id=?')
          .get(l.userId) as { owner: string; expires_at: number } | undefined;
        if (!lease || lease.owner !== fence.owner || lease.expires_at <= fence.now) return false;
      }
      const gen = this.db
        .prepare('SELECT generation FROM spotify_generations WHERE user_id=?')
        .get(l.userId) as { generation: number } | undefined;
      const old = this.db.prepare('SELECT version FROM spotify_links WHERE user_id=?').get(l.userId) as
        | { version: number }
        | undefined;
      if ((gen?.generation ?? 0) !== l.generation || (old?.version ?? null) !== version) return false;
      try {
        this.db
          .prepare(
            'INSERT INTO spotify_links (user_id,account_id,envelope,scopes,expires_at,authorized_at,version,generation,display_name,entitlement,reauth) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET account_id=excluded.account_id,envelope=excluded.envelope,scopes=excluded.scopes,expires_at=excluded.expires_at,authorized_at=excluded.authorized_at,version=excluded.version,generation=excluded.generation,display_name=excluded.display_name,entitlement=excluded.entitlement,reauth=excluded.reauth',
          )
          .run(
            l.userId,
            l.accountId,
            l.envelope,
            JSON.stringify(l.scopes),
            l.expiresAt,
            l.authorizedAt,
            l.version,
            l.generation,
            l.displayName,
            l.entitlement,
            Number(l.reauth),
          );
        return true;
      } catch (e) {
        if (String(e).includes('UNIQUE')) return false;
        throw e;
      }
    })();
  }
  async unlink(id: string) {
    this.db.transaction(() => {
      const old = this.db.prepare('SELECT account_id FROM spotify_links WHERE user_id=?').get(id) as
        | { account_id: string }
        | undefined;
      this.db
        .prepare(
          'INSERT INTO spotify_generations(user_id,generation) VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET generation=generation+1',
        )
        .run(id);
      this.db.prepare('DELETE FROM spotify_links WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM spotify_oauth_attempts WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM spotify_leases WHERE user_id=?').run(id);
      if (old)
        this.db
          .prepare(
            'DELETE FROM hybrid_playlist_items WHERE playlist_id IN (SELECT id FROM hybrid_playlists WHERE owner_id=?) AND spotify_account_id=?',
          )
          .run(id, old.account_id);
    })();
  }
  async putAttempt(k: string, a: OAuthAttempt) {
    this.db.prepare('DELETE FROM spotify_oauth_attempts WHERE expires_at<=?').run(a.expiresAt - 600000);
    this.db
      .prepare(
        'INSERT INTO spotify_oauth_attempts(state_hash,user_id,session_hash,protected_verifier,redirect_uri,scopes,generation,expires_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        k,
        a.userId,
        a.sessionHash,
        a.protectedVerifier,
        a.redirectUri,
        JSON.stringify(a.scopes),
        a.generation,
        a.expiresAt,
      );
  }
  async consumeAttempt(k: string, u: string, s: string, now: number): Promise<OAuthAttempt | null> {
    return this.db.transaction(() => {
      const a = this.db
        .prepare(
          'SELECT * FROM spotify_oauth_attempts WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>?',
        )
        .get(k, u, s, now) as Record<string, unknown> | undefined;
      if (!a) return null;
      this.db.prepare('DELETE FROM spotify_oauth_attempts WHERE state_hash=?').run(k);
      return {
        userId: u,
        sessionHash: s,
        protectedVerifier: String(a.protected_verifier),
        redirectUri: String(a.redirect_uri),
        scopes: JSON.parse(String(a.scopes)),
        generation: Number(a.generation),
        expiresAt: Number(a.expires_at),
      };
    })();
  }
  async acquire(id: string, owner: string, now: number, ttl: number) {
    return (
      this.db
        .prepare(
          'INSERT INTO spotify_leases(user_id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE spotify_leases.expires_at<=?',
        )
        .run(id, owner, now + ttl, now).changes > 0
    );
  }
  async release(id: string, owner: string) {
    this.db.prepare('DELETE FROM spotify_leases WHERE user_id=? AND owner=?').run(id, owner);
  }
  async cooldown() {
    return (
      (
        this.db.prepare("SELECT value FROM spotify_runtime WHERE key='cooldown'").get() as
          | { value: number }
          | undefined
      )?.value ?? 0
    );
  }
  async setCooldown(until: number) {
    this.db
      .prepare(
        "INSERT INTO spotify_runtime(key,value) VALUES ('cooldown',?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)",
      )
      .run(until);
  }
}
