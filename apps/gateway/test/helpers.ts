import { loadGatewayConfig } from '../lib/config.js';
import type { GatewayDeps } from '../lib/handlers.js';
import { MemoryKv } from '../lib/kv.js';
import { FakeYoutube, fakeAudioOrigin } from '../lib/youtube-fake.js';
import type { YoutubeClient } from '../lib/youtube.js';

export const ORIGIN = 'https://spookyfy.vercel.test';
export const PASSWORD = 'Notte#2026';
export const TOKEN = 'spotifymerdacostosa2026';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export class FakeClock {
  constructor(public t = Date.UTC(2026, 0, 1)) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** Dipendenze isolate: KV in memoria, orologio finto, YouTube finto con origine audio locale. */
export function makeDeps(o: { env?: Record<string, string>; youtube?: YoutubeClient } = {}) {
  const clock = new FakeClock();
  const config = loadGatewayConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
    PUBLIC_ORIGIN: ORIGIN,
    ...o.env,
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('fake-audio://')) return fakeAudioOrigin(new Request('http://x/', init));
    return fetch(input, init);
  };
  const deps: GatewayDeps & { clock: FakeClock; kv: MemoryKv } = {
    config,
    clock,
    kv: new MemoryKv(clock),
    youtube: o.youtube ?? new FakeYoutube('fake-audio://origin'),
    fetch: fakeFetch,
  };
  return deps;
}

export function req(
  method: string,
  path: string,
  o: {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    ip?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers(o.headers);
  if (o.body !== undefined) headers.set('content-type', 'application/json');
  if (o.cookie) headers.set('cookie', o.cookie);
  if (o.origin !== null) headers.set('origin', o.origin ?? ORIGIN);
  headers.set('x-forwarded-for', o.ip ?? '203.0.113.1');
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}

/** Valore del cookie di sessione dalla risposta, pronto per l'header Cookie. */
export function sessionCookie(res: Response): string | undefined {
  const c = res.headers.getSetCookie().find((x) => x.startsWith('spk_session='));
  if (!c) return undefined;
  return c.split(';')[0];
}
