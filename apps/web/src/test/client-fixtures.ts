import type { RemoteSearchResultDto } from '@spookyfy/shared';
import { vi } from 'vitest';
import type { CoverProcessor } from '../lib/device/cover';
import { openSpookyfyDb } from '../lib/offline/db';
import { createServices, setServices } from '../lib/services.svelte';
import { ME, fakeMediaSession } from './fixtures';

/** Copertine finte: jsdom non ha canvas. */
export const fakeCover: CoverProcessor = async (source) => ({
  large: new Blob([new Uint8Array(512)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(128)], { type: 'image/jpeg' }),
  dominantColor: source ? '#c02020' : '#3a3a3a',
});

export const audioBytes = (n: number) => {
  const b = new Uint8Array(n);
  b.set([0xff, 0xfb, 0x90, 0xc0]);
  return b;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface FakeGatewayOptions {
  audioSize?: number;
  /** Interrompe lo stream audio dopo questi byte (connessione persa). */
  breakAudioAt?: number;
  searchBlocked?: boolean;
}

/**
 * Gateway finto per i test: risponde come le funzioni Vercel a /api/search,
 * /api/meta/:id, /api/audio/:id, /api/cover/:id e /api/auth/*. Gli id che
 * iniziano con `blocked`, `unavail`, `toolong` simulano gli errori.
 */
export function fakeGateway(o: FakeGatewayOptions = {}) {
  const size = o.audioSize ?? 2000;
  const calls: string[] = [];
  const handler = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'http://localhost',
    );
    calls.push(url.pathname);
    const p = url.pathname;
    if (p === '/api/auth/me') return json(200, ME);
    if (p === '/api/search') {
      if (o.searchBlocked)
        return json(503, {
          error: {
            code: 'YOUTUBE_BLOCKED',
            message: 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)',
          },
        });
      const q = url.searchParams.get('q') ?? '';
      const items: RemoteSearchResultDto[] = Array.from({ length: 3 }, (_, i) => ({
        sourceId: `vid${String(i).padStart(8, '0')}`,
        title: `${q} ${i}`,
        artist: `Canale ${i}`,
        durationMs: 180_000,
        thumbnailUrl: '/api/cover/x',
        trackId: null,
      }));
      return json(200, { items });
    }
    const m = /^\/api\/(meta|audio|cover)\/([^/]+)$/.exec(p);
    if (m) {
      const [, kind, id] = m;
      if (id!.startsWith('blocked'))
        return json(503, {
          error: {
            code: 'YOUTUBE_BLOCKED',
            message: 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)',
          },
        });
      if (id!.startsWith('unavail'))
        return json(404, { error: { code: 'VIDEO_UNAVAILABLE', message: 'Il video non è disponibile' } });
      if (id!.startsWith('toolong'))
        return json(422, {
          error: {
            code: 'VIDEO_TOO_LONG',
            message: 'Il video supera la durata massima di 20 minuti (o è una diretta)',
          },
        });
      if (kind === 'meta') {
        return json(200, {
          sourceId: id,
          title: `Canzone ${id}`,
          artist: 'Band',
          album: null,
          durationMs: 3000,
          sizeBytes: size,
          mimeType: 'audio/mp4',
          thumbnailUrl: `/api/cover/${id}`,
        });
      }
      if (kind === 'cover')
        return new Response(new Uint8Array(64), { headers: { 'content-type': 'image/jpeg' } });
      const bytes = audioBytes(size);
      if (o.breakAudioAt !== undefined) {
        const cut = o.breakAudioAt;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes.slice(0, cut));
            c.error(new TypeError('network error'));
          },
        });
        return new Response(body, {
          headers: { 'content-type': 'audio/mp4', 'content-length': String(size) },
        });
      }
      return new Response(bytes, {
        headers: { 'content-type': 'audio/mp4', 'content-length': String(size) },
      });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: 'non trovato' } });
  });
  return { fetch: handler as unknown as typeof fetch, calls };
}

let n = 0;

/** Servizi in modalità client con IndexedDB nuovo e gateway finto (anche come fetch globale). */
export async function setupClientServices(
  o: FakeGatewayOptions & { storageEstimate?: { usage: number; quota: number } } = {},
) {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  const gw = fakeGateway(o);
  vi.stubGlobal('fetch', gw.fetch);
  {
    // Sempre ridefinito: un test con spazio quasi esaurito non deve influenzare i successivi.
    const estimate = o.storageEstimate ?? { usage: 0, quota: 10 * 1024 ** 3 };
    Object.defineProperty(window.navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => estimate,
        persist: async () => true,
        persisted: async () => true,
      },
    });
  }
  const db = await openSpookyfyDb(`spk-client-${Date.now()}-${++n}`);
  const media = fakeMediaSession();
  const s = createServices({
    mode: 'client',
    db: async () => db,
    fetch: gw.fetch,
    processCover: fakeCover,
    mediaSession: media.bridge,
    bridgePollMs: 5,
  });
  s.session.user = ME;
  s.session.status = 'authenticated';
  setServices(s);
  await s.device!.library.ready();
  await s.device!.importer.init();
  return Object.assign(s, { gw, media: media.state });
}
