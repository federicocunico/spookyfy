import http from 'node:http';
import os from 'node:os';
import { describe, expect, test, vi } from 'vitest';
import { startDevServer } from '../dev-server.js';
import { handleAuth } from '../lib/auth.js';
import { handleHealth } from '../lib/handlers.js';
import { handle } from '../lib/http.js';
import { handleLookup } from '../lib/lookup.js';
import { PASSWORD, TOKEN, makeDeps, req, sessionCookie } from './helpers.js';

type Deps = ReturnType<typeof makeDeps>;

const MB = {
  'release-groups': [
    {
      id: '1b022e01-4da6-387b-8658-8678046e4cef',
      score: 100,
      title: 'Nevermind',
      'first-release-date': '1991-09-24',
      'artist-credit': [{ name: 'Nirvana' }],
    },
  ],
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Deps con i servizi musicali simulati: nessuna richiesta reale. */
function depsWithServices(env: Record<string, string> = {}) {
  const d = makeDeps({ env });
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://musicbrainz.org/'))
      return new Response(JSON.stringify(MB), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://coverartarchive.org/'))
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    throw new TypeError(`fetch failed: ${url}`);
  });
  d.fetch = fetch as unknown as typeof globalThis.fetch;
  return { d, fetch };
}

async function session(d: Deps): Promise<string> {
  const res = await handle(() =>
    handleAuth(
      req('POST', '/api/auth/register', { body: { username: 'fede', password: PASSWORD, token: TOKEN } }),
      'register',
      d,
    ),
  );
  return sessionCookie(res)!;
}

const lookup = (d: Deps, path: string, cookie?: string) =>
  handle(() =>
    handleLookup(req('GET', path, { cookie, origin: null }), path.split('/')[3]!.split('?')[0]!, d),
  );

describe('ricerca di album e copertine dal gateway', () => {
  test('utente non autenticato: 401', async () => {
    const { d, fetch } = depsWithServices();
    expect((await lookup(d, '/api/lookup/albums?album=Nevermind')).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('candidati dai database musicali', async () => {
    const { d } = depsWithServices();
    const res = await lookup(d, '/api/lookup/albums?album=Nevermind&artist=Nirvana', await session(d));
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items[0]).toMatchObject({ source: 'musicbrainz', title: 'Nevermind', year: 1991 });
  });

  test('immagine di un candidato dalla stessa origine', async () => {
    const { d } = depsWithServices();
    const url = encodeURIComponent('https://coverartarchive.org/release-group/x/front-250');
    const res = await lookup(d, `/api/lookup/image?url=${url}`, await session(d));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('host non consentito: rifiutato senza richieste in uscita', async () => {
    const { d, fetch } = depsWithServices();
    const cookie = await session(d);
    const res = await lookup(
      d,
      `/api/lookup/image?url=${encodeURIComponent('https://10.0.0.1/admin')}`,
      cookie,
    );
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('servizi irraggiungibili: 503', async () => {
    const d = makeDeps();
    d.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const res = await lookup(d, '/api/lookup/albums?album=Nevermind', await session(d));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('LOOKUP_UNAVAILABLE');
  });

  test('COVER_LOOKUP=off: 409 e funzionalità assente dalla health', async () => {
    const { d, fetch } = depsWithServices({ COVER_LOOKUP: 'off' });
    const res = await lookup(d, '/api/lookup/albums?album=Nevermind', await session(d));
    expect(res.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect((await handleHealth(d).json()).features).not.toContain('cover-lookup');
    expect((await handleHealth(makeDeps()).json()).features).toContain('cover-lookup');
  });
});

test('dev server con un MusicBrainz finto configurato dagli URL di base', async () => {
  const fake = http.createServer((r, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.url?.startsWith('/mb/ws/2/release-group/') ? MB : { results: [] }));
  });
  await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
  const port = (fake.address() as { port: number }).port;
  const s = await startDevServer({
    port: 4392,
    webDist: os.tmpdir(),
    env: {
      LOOKUP_MUSICBRAINZ_URL: `http://127.0.0.1:${port}/mb`,
      LOOKUP_COVERART_URL: `http://127.0.0.1:${port}/caa`,
      LOOKUP_ITUNES_URL: `http://127.0.0.1:${port}/itunes`,
    },
  });
  try {
    const reg = await fetch(`${s.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: s.url },
      body: JSON.stringify({ username: 'fede', password: PASSWORD, token: TOKEN }),
    });
    const cookie = reg.headers.getSetCookie()[0]!.split(';')[0]!;
    const res = await fetch(`${s.url}/api/lookup/albums?album=Nevermind&artist=Nirvana`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items[0].coverUrl).toBe(
      `http://127.0.0.1:${port}/caa/release-group/${MB['release-groups'][0]!.id}/front-500`,
    );
  } finally {
    await s.close();
    await new Promise<void>((ok) => fake.close(() => ok()));
  }
});
