import { SpotifyErrorCode } from '@spookyfy/shared';
import {
  type CircuitState,
  type OAuthAttempt,
  SpotifyError,
  type SpotifyLink,
  type SpotifyStore,
  circuitTransition,
} from '@spookyfy/spotify';
import type { Kv } from './kv.js';
interface State {
  links: Record<string, SpotifyLink>;
  generations: Record<string, number>;
  attempts: Record<string, OAuthAttempt>;
  leases: Record<string, { owner: string; until: number }>;
  cooldown: number;
  circuit?: CircuitState;
  deletedUsers?: Record<string, true>;
}
const empty = (): State => ({ links: {}, generations: {}, attempts: {}, leases: {}, cooldown: 0 });
/** One CAS document keeps account uniqueness, inverse ownership and fencing atomic even on Upstash.
 * No separately claimed index can be orphaned by a worker crash. Tokens remain encrypted.
 */
export class KvSpotifyStore implements SpotifyStore {
  private readonly key = 'spk:spotify:v1';
  constructor(private readonly kv: Kv) {}
  private async read() {
    return (await this.kv.get<State>(this.key)) ?? empty();
  }
  private async change<T>(fn: (state: State) => T): Promise<T> {
    for (let i = 0; i < 30; i++) {
      const previous = await this.kv.get<State>(this.key);
      const next = structuredClone(previous ?? empty());
      const result = fn(next);
      if (await this.kv.compareAndSet(this.key, previous, next)) return result;
    }
    throw new Error('Spotify store contention');
  }
  async get(id: string) {
    return (await this.read()).links[id] ?? null;
  }
  async generation(id: string) {
    return (await this.read()).generations[id] ?? 0;
  }
  save(link: SpotifyLink, version: number | null, fence?: { owner: string; now: number }) {
    return this.change((s) => {
      if (s.deletedUsers?.[link.userId]) return false;
      if (
        fence &&
        (s.leases[link.userId]?.owner !== fence.owner || (s.leases[link.userId]?.until ?? 0) <= fence.now)
      )
        return false;
      if (
        (s.generations[link.userId] ?? 0) !== link.generation ||
        (s.links[link.userId]?.version ?? null) !== version ||
        Object.values(s.links).some((l) => l.accountId === link.accountId && l.userId !== link.userId)
      )
        return false;
      s.links[link.userId] = link;
      return true;
    });
  }
  async unlink(id: string) {
    await this.change((s) => {
      s.generations[id] = (s.generations[id] ?? 0) + 1;
      delete s.links[id];
      delete s.leases[id];
      for (const [k, a] of Object.entries(s.attempts)) if (a.userId === id) delete s.attempts[k];
    });
  }
  async deleteUser(id: string) {
    await this.change((s) => {
      s.deletedUsers ??= {};
      s.deletedUsers[id] = true;
      s.generations[id] = (s.generations[id] ?? 0) + 1;
      delete s.links[id];
      delete s.leases[id];
      for (const [k, attempt] of Object.entries(s.attempts)) if (attempt.userId === id) delete s.attempts[k];
    });
  }
  async putAttempt(k: string, a: OAuthAttempt) {
    await this.change((s) => {
      if (s.deletedUsers?.[a.userId]) throw new SpotifyError(SpotifyErrorCode.ReauthRequired, 409);
      for (const [key, old] of Object.entries(s.attempts))
        if (old.expiresAt <= a.expiresAt - 600000) delete s.attempts[key];
      s.attempts[k] = a;
    });
  }
  consumeAttempt(k: string, u: string, h: string, now: number) {
    return this.change((s) => {
      if (s.deletedUsers?.[u]) return null;
      const a = s.attempts[k];
      if (!a || a.userId !== u || a.sessionHash !== h || a.expiresAt <= now) return null;
      delete s.attempts[k];
      return a;
    });
  }
  acquire(id: string, owner: string, now: number, ttl: number) {
    return this.change((s) => {
      if (s.deletedUsers?.[id]) return false;
      if (s.leases[id] && s.leases[id]!.until > now) return false;
      s.leases[id] = { owner, until: now + ttl };
      return true;
    });
  }
  async release(id: string, owner: string) {
    await this.change((s) => {
      if (s.leases[id]?.owner === owner) delete s.leases[id];
    });
  }
  async cooldown() {
    return (await this.read()).cooldown;
  }
  async setCooldown(until: number) {
    await this.change((s) => {
      s.cooldown = Math.max(s.cooldown, until);
    });
  }
  circuit(now: number, result?: 'success' | 'failure') {
    return this.change((s) => {
      s.circuit ??= { failures: 0, until: 0, probeUntil: 0 };
      return circuitTransition(s.circuit, now, result);
    });
  }
}
