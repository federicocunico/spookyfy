import { Redis } from '@upstash/redis';
import { type RedisClientType, createClient } from 'redis';
import type { KvConfig } from './config.js';

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

/**
 * Archivio chiave-valore minimo del gateway: contiene solo account, revoche di
 * sessione e contatori anti-brute-force. Nessun dato musicale.
 */
export interface Kv {
  /** Compare exact JSON value and replace/delete atomically across instances. */
  compareAndSet(key: string, expected: unknown | null, value: unknown | null): Promise<boolean>;
  /** Atomically free an exact account record and its username listing. */
  compareAndDeleteMember(key: string, expected: unknown, setKey: string, member: string): Promise<boolean>;
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
  async compareAndSet(key: string, expected: unknown | null, value: unknown | null) {
    return (
      Number(
        await this.redis.eval(
          CAS_SCRIPT,
          [key],
          [expected === null ? '' : JSON.stringify(expected), value === null ? '' : JSON.stringify(value)],
        ),
      ) === 1
    );
  }
  async compareAndDeleteMember(key: string, expected: unknown, setKey: string, member: string) {
    return (
      Number(
        await this.redis.eval(DELETE_MEMBER_SCRIPT, [key, setKey], [JSON.stringify(expected), member]),
      ) === 1
    );
  }
  get<T>(key: string) {
    return this.redis.get<T>(key);
  }
  mget<T extends unknown[]>(...keys: string[]) {
    return this.redis.mget(...keys) as Promise<{ [K in keyof T]: T[K] | null }>;
  }
  async set(key: string, value: unknown, opts: { nx?: boolean; exSeconds?: number } = {}) {
    // Opzioni esplicite: i tipi di SetCommandOptions non accettano `ex: undefined`.
    const ex = opts.exSeconds ? Math.max(1, Math.ceil(opts.exSeconds)) : 0;
    let res: unknown;
    if (opts.nx)
      res = await (ex
        ? this.redis.set(key, value, { nx: true, ex })
        : this.redis.set(key, value, { nx: true }));
    else res = await (ex ? this.redis.set(key, value, { ex }) : this.redis.set(key, value));
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

/**
 * Redis via TCP (Redis Cloud dal Marketplace Vercel, piano Free). Una connessione per
 * istanza della funzione, aperta alla prima richiesta; valori serializzati in JSON.
 */
export class RedisKv implements Kv {
  private readonly client: RedisClientType;
  private connecting: Promise<unknown> | null = null;
  constructor(url: string) {
    this.client = createClient({ url, socket: { connectTimeout: 5000 } });
    this.client.on('error', (e: Error) => console.error('Redis:', e.message));
  }
  private async c(): Promise<RedisClientType> {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().catch((e) => {
        this.connecting = null;
        throw e;
      });
      await this.connecting;
    }
    return this.client;
  }
  async compareAndSet(key: string, expected: unknown | null, value: unknown | null) {
    return (
      Number(
        await (await this.c()).eval(CAS_SCRIPT, {
          keys: [key],
          arguments: [
            expected === null ? '' : JSON.stringify(expected),
            value === null ? '' : JSON.stringify(value),
          ],
        }),
      ) === 1
    );
  }
  async compareAndDeleteMember(key: string, expected: unknown, setKey: string, member: string) {
    return (
      Number(
        await (await this.c()).eval(DELETE_MEMBER_SCRIPT, {
          keys: [key, setKey],
          arguments: [JSON.stringify(expected), member],
        }),
      ) === 1
    );
  }
  async get<T>(key: string) {
    return parse<T>(await (await this.c()).get(key));
  }
  async mget<T extends unknown[]>(...keys: string[]) {
    const values = await (await this.c()).mGet(keys);
    return values.map((v) => parse(v)) as { [K in keyof T]: T[K] | null };
  }
  async set(key: string, value: unknown, opts: { nx?: boolean; exSeconds?: number } = {}) {
    const res = await (await this.c()).set(key, JSON.stringify(value), {
      ...(opts.nx ? { NX: true as const } : {}),
      ...(opts.exSeconds ? { EX: Math.max(1, Math.ceil(opts.exSeconds)) } : {}),
    });
    return res === 'OK';
  }
  async del(...keys: string[]) {
    return keys.length ? (await this.c()).del(keys) : 0;
  }
  async incrWindow(key: string, windowSeconds: number) {
    const c = await this.c();
    const n = await c.incr(key);
    if (n === 1) await c.expire(key, windowSeconds);
    return n;
  }
  async pttl(key: string) {
    return (await this.c()).pTTL(key);
  }
  async sadd(key: string, member: string) {
    await (await this.c()).sAdd(key, member);
  }
  async srem(key: string, member: string) {
    await (await this.c()).sRem(key, member);
  }
  async smembers(key: string) {
    return (await this.c()).sMembers(key);
  }
  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}

function parse<T>(v: string | null | undefined): T | null {
  return v === null || v === undefined ? null : (JSON.parse(v) as T);
}

export function createKv(config: KvConfig): Kv {
  return config.kind === 'redis' ? new RedisKv(config.url) : new UpstashKv(config.url, config.token);
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/** Implementazione in memoria (sviluppo e test), con scadenze sull'orologio iniettato. */
export class MemoryKv implements Kv {
  private readonly data = new Map<string, Entry>();
  constructor(private readonly clock: Clock = systemClock) {}
  async compareAndSet(key: string, expected: unknown | null, value: unknown | null) {
    const old = this.live(key)?.value ?? null;
    if (JSON.stringify(old) !== JSON.stringify(expected)) return false;
    if (value === null) this.data.delete(key);
    else this.data.set(key, { value: structuredClone(value), expiresAt: null });
    return true;
  }
  async compareAndDeleteMember(key: string, expected: unknown, setKey: string, member: string) {
    if (JSON.stringify(this.live(key)?.value ?? null) !== JSON.stringify(expected)) return false;
    this.data.delete(key);
    const entry = this.live(setKey);
    if (entry)
      this.data.set(setKey, {
        ...entry,
        value: (entry.value as string[]).filter((value) => value !== member),
      });
    return true;
  }

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
const CAS_SCRIPT = `local old=redis.call('GET',KEYS[1]); if (not old and ARGV[1]~='') or (old and old~=ARGV[1]) then return 0 end; if ARGV[2]=='' then redis.call('DEL',KEYS[1]) else redis.call('SET',KEYS[1],ARGV[2]) end; return 1`;
const DELETE_MEMBER_SCRIPT = `local old=redis.call('GET',KEYS[1]); if not old or old~=ARGV[1] then return 0 end; redis.call('DEL',KEYS[1]); redis.call('SREM',KEYS[2],ARGV[2]); return 1`;
