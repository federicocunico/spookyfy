import { Redis } from '@upstash/redis';

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

/**
 * Archivio chiave-valore minimo del gateway: contiene solo account, revoche di
 * sessione e contatori anti-brute-force. Nessun dato musicale.
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  mget<T extends unknown[]>(...keys: string[]): Promise<{ [K in keyof T]: T[K] | null }>;
  /** true se il valore è stato scritto (con `nx`: solo se la chiave non esisteva). */
  set(key: string, value: unknown, opts?: { nx?: boolean; exSeconds?: number }): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  /** Incrementa e, al primo incremento, imposta la scadenza della finestra. */
  incrWindow(key: string, windowSeconds: number): Promise<number>;
  /** Millisecondi alla scadenza (-2 se non esiste, -1 senza scadenza). */
  pttl(key: string): Promise<number>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

export class UpstashKv implements Kv {
  private readonly redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  get<T>(key: string) {
    return this.redis.get<T>(key);
  }
  mget<T extends unknown[]>(...keys: string[]) {
    return this.redis.mget(...keys) as Promise<{ [K in keyof T]: T[K] | null }>;
  }
  async set(key: string, value: unknown, opts: { nx?: boolean; exSeconds?: number } = {}) {
    const ex = opts.exSeconds ? { ex: Math.max(1, Math.ceil(opts.exSeconds)) } : {};
    const res = opts.nx
      ? await this.redis.set(key, value, { nx: true, ...ex })
      : await this.redis.set(key, value, { ...ex });
    return res === 'OK';
  }
  del(...keys: string[]) {
    return this.redis.del(...keys);
  }
  async incrWindow(key: string, windowSeconds: number) {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, windowSeconds);
    return n;
  }
  pttl(key: string) {
    return this.redis.pttl(key);
  }
  async sadd(key: string, member: string) {
    await this.redis.sadd(key, member);
  }
  async srem(key: string, member: string) {
    await this.redis.srem(key, member);
  }
  smembers(key: string) {
    return this.redis.smembers(key);
  }
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/** Implementazione in memoria (sviluppo e test), con scadenze sull'orologio iniettato. */
export class MemoryKv implements Kv {
  private readonly data = new Map<string, Entry>();
  constructor(private readonly clock: Clock = systemClock) {}

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= this.clock.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T>(key: string) {
    const e = this.live(key);
    return e ? (structuredClone(e.value) as T) : null;
  }
  async mget<T extends unknown[]>(...keys: string[]) {
    return Promise.all(keys.map((k) => this.get(k))) as Promise<{ [K in keyof T]: T[K] | null }>;
  }
  async set(key: string, value: unknown, opts: { nx?: boolean; exSeconds?: number } = {}) {
    if (opts.nx && this.live(key)) return false;
    this.data.set(key, {
      value: structuredClone(value),
      expiresAt: opts.exSeconds ? this.clock.now() + opts.exSeconds * 1000 : null,
    });
    return true;
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.live(k) && this.data.delete(k)) n++;
    return n;
  }
  async incrWindow(key: string, windowSeconds: number) {
    const e = this.live(key);
    const n = ((e?.value as number | undefined) ?? 0) + 1;
    this.data.set(key, {
      value: n,
      expiresAt: e?.expiresAt ?? this.clock.now() + windowSeconds * 1000,
    });
    return n;
  }
  async pttl(key: string) {
    const e = this.live(key);
    if (!e) return -2;
    return e.expiresAt === null ? -1 : e.expiresAt - this.clock.now();
  }
  async sadd(key: string, member: string) {
    const set = new Set((this.live(key)?.value as string[] | undefined) ?? []);
    set.add(member);
    this.data.set(key, { value: [...set], expiresAt: null });
  }
  async srem(key: string, member: string) {
    const set = new Set((this.live(key)?.value as string[] | undefined) ?? []);
    set.delete(member);
    this.data.set(key, { value: [...set], expiresAt: null });
  }
  async smembers(key: string) {
    return [...((this.live(key)?.value as string[] | undefined) ?? [])];
  }
}
