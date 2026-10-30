import { describe, expect, test, vi } from 'vitest';
import { type Kv, RedisKv, UpstashKv } from '../lib/kv.js';

/** Wire contract without contacting an account or service. The fake command
 * executor accepts EVAL only; a GET followed by SET would fail this contract.
 * The optional Redis test separately executes the Lua on a real Redis server.
 */
describe.each(['redis', 'upstash'] as const)('%s atomic CAS transport', (kind) => {
  test('account removal compares exact user and deletes its listing in the same two-key EVAL', async () => {
    const tombstone = { id: 'immutable-old', username: 'tester', epoch: 1, deleting: true };
    let stored = JSON.stringify(tombstone);
    const members = new Set(['tester']);
    const run = vi.fn((script: string, keys: string[], args: string[]) => {
      expect(script).toContain("redis.call('GET'");
      expect(script).toContain("redis.call('DEL'");
      expect(script).toContain("redis.call('SREM'");
      expect(keys).toEqual(['spk:user:tester', 'spk:users']);
      if (stored !== args[0]) return 0;
      stored = '';
      members.delete(args[1]!);
      return 1;
    });
    let kv: Kv;
    if (kind === 'upstash') {
      const instance = new UpstashKv('https://unit.test', 'not-a-secret');
      Object.defineProperty(instance, 'redis', {
        value: { eval: async (script: string, keys: string[], args: string[]) => run(script, keys, args) },
      });
      kv = instance;
    } else {
      const instance = new RedisKv('redis://127.0.0.1:1');
      Object.defineProperty(instance, 'client', {
        value: {
          isOpen: true,
          eval: async (script: string, options: { keys: string[]; arguments: string[] }) =>
            run(script, options.keys, options.arguments),
        },
      });
      kv = instance;
    }
    expect(
      await kv.compareAndDeleteMember('spk:user:tester', { ...tombstone, epoch: 0 }, 'spk:users', 'tester'),
    ).toBe(false);
    expect(members.has('tester')).toBe(true);
    expect(await kv.compareAndDeleteMember('spk:user:tester', tombstone, 'spk:users', 'tester')).toBe(true);
    expect(members.size).toBe(0);
    stored = JSON.stringify({ ...tombstone, id: 'new-immutable', deleting: undefined });
    members.add('tester');
    expect(await kv.compareAndDeleteMember('spk:user:tester', tombstone, 'spk:users', 'tester')).toBe(false);
    expect(members.has('tester')).toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[1]?.[2]).toEqual([JSON.stringify(tombstone), 'tester']);
  });
  test('one server-side command claims, replaces, compares owner and deletes exact JSON', async () => {
    const data = new Map<string, string>();
    const run = vi.fn((script: string, keys: string[], args: string[]) => {
      expect(script).toContain("redis.call('GET'");
      expect(script).toContain("redis.call('SET'");
      expect(script).toContain("redis.call('DEL'");
      expect(keys).toHaveLength(1);
      const key = keys[0]!;
      const old = data.get(key);
      if ((old === undefined && args[0] !== '') || (old !== undefined && old !== args[0])) return 0;
      if (args[1] === '') data.delete(key);
      else data.set(key, args[1]!);
      return 1;
    });
    let kv: Kv;
    if (kind === 'upstash') {
      const instance = new UpstashKv('https://unit.test', 'not-a-secret');
      Object.defineProperty(instance, 'redis', {
        value: { eval: async (script: string, keys: string[], args: string[]) => run(script, keys, args) },
      });
      kv = instance;
    } else {
      const instance = new RedisKv('redis://127.0.0.1:1');
      Object.defineProperty(instance, 'client', {
        value: {
          isOpen: true,
          eval: async (script: string, options: { keys: string[]; arguments: string[] }) =>
            run(script, options.keys, options.arguments),
        },
      });
      kv = instance;
    }
    const first = { owner: 'one', nested: { cipher: 'encrypted' }, version: 1 };
    const results = await Promise.all([
      kv.compareAndSet('claim', null, first),
      kv.compareAndSet('claim', null, { owner: 'two' }),
    ]);
    expect(results).toEqual([true, false]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(await kv.compareAndSet('claim', { owner: 'wrong' }, null)).toBe(false);
    const next = { ...first, version: 2 };
    expect(await kv.compareAndSet('claim', first, next)).toBe(true);
    expect(await kv.compareAndSet('claim', first, null)).toBe(false);
    expect(await kv.compareAndSet('claim', next, null)).toBe(true);
    expect(data.size).toBe(0);
  });
});
