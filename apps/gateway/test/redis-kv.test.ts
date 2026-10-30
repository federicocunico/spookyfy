import { describe, expect, test } from 'vitest';
import { RedisKv } from '../lib/kv.js';

/**
 * Contratto del KV su un Redis vero (es. quello di produzione, con chiavi temporanee):
 * REDIS_TEST_URL=redis://… pnpm --filter @spookyfy/gateway exec vitest run test/redis-kv.test.ts
 */
const url = process.env.REDIS_TEST_URL;

describe.skipIf(!url)('RedisKv su Redis reale', () => {
  test('get/set con NX e scadenza, mget, contatori a finestra, insiemi, del', async () => {
    const kv = new RedisKv(url!);
    const p = `spk:test:${Date.now().toString(36)}`;
    try {
      expect(await kv.get(`${p}:a`)).toBeNull();
      expect(await kv.set(`${p}:a`, { n: 1, s: 'x' }, { nx: true })).toBe(true);
      expect(await kv.set(`${p}:a`, { n: 2 }, { nx: true })).toBe(false);
      expect(await kv.get(`${p}:a`)).toEqual({ n: 1, s: 'x' });
      // Fencing is an EVAL CAS, shared by independent serverless instances.
      expect(await kv.compareAndSet(`${p}:a`, { n: 9 }, { n: 2 })).toBe(false);
      const claims = await Promise.all([
        kv.compareAndSet(`${p}:claim`, null, { owner: 'one' }),
        kv.compareAndSet(`${p}:claim`, null, { owner: 'two' }),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const winner = await kv.get(`${p}:claim`);
      expect(await kv.compareAndSet(`${p}:claim`, winner, null)).toBe(true);
      expect(await kv.get(`${p}:claim`)).toBeNull();

      expect(await kv.set(`${p}:b`, 1, { exSeconds: 30 })).toBe(true);
      expect(await kv.mget(`${p}:a`, `${p}:b`, `${p}:none`)).toEqual([{ n: 1, s: 'x' }, 1, null]);
      expect(await kv.pttl(`${p}:b`)).toBeGreaterThan(20_000);
      expect(await kv.pttl(`${p}:a`)).toBe(-1);
      expect(await kv.pttl(`${p}:none`)).toBe(-2);

      expect(await kv.incrWindow(`${p}:c`, 60)).toBe(1);
      expect(await kv.incrWindow(`${p}:c`, 60)).toBe(2);
      expect(await kv.mget(`${p}:c`)).toEqual([2]);
      expect(await kv.pttl(`${p}:c`)).toBeGreaterThan(50_000);

      await kv.sadd(`${p}:s`, 'fede');
      await kv.sadd(`${p}:s`, 'anna');
      await kv.srem(`${p}:s`, 'anna');
      expect(await kv.smembers(`${p}:s`)).toEqual(['fede']);
    } finally {
      expect(await kv.del(`${p}:a`, `${p}:b`, `${p}:c`, `${p}:s`)).toBe(4);
      await kv.close();
    }
  });
});
