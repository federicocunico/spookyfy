import { afterEach, describe, expect, test, vi } from 'vitest';
import { CoverImageError, fetchCoverImage, isAllowedImageUrl } from './image.js';
import { isConfidentMatch, matchKey } from './match.js';
import { LookupError, createAlbumLookup } from './providers.js';
import { createRateLimiter } from './rate-limit.js';

/** Risposte registrate (ridotte) di MusicBrainz e iTunes Search. */
const MB_RELEASE_GROUPS = {
  'release-groups': [
    {
      id: '1b022e01-4da6-387b-8658-8678046e4cef',
      score: 100,
      title: 'Nevermind',
      'primary-type': 'Album',
      'first-release-date': '1991-09-24',
      'artist-credit': [{ name: 'Nirvana', artist: { name: 'Nirvana' } }],
      tags: [
        { count: 7, name: 'grunge' },
        { count: 3, name: 'alternative rock' },
        { count: 0, name: 'seen live' },
      ],
    },
    {
      id: 'a2b3c4d5-0000-0000-0000-000000000000',
      score: 92,
      title: 'Nevermind (Deluxe Edition)',
      'first-release-date': '2011',
      'artist-credit': [{ name: 'Nirvana' }],
    },
    {
      id: 'b2b3c4d5-0000-0000-0000-000000000000',
      score: 70,
      title: 'Nevermind It’s an Interview',
      'artist-credit': [{ name: 'Nirvana' }],
    },
  ],
};

const MB_RECORDINGS = {
  recordings: [
    {
      score: 100,
      'artist-credit': [{ name: 'Nirvana' }],
      tags: [{ count: 2, name: 'grunge' }],
      releases: [
        {
          date: '1991-09-24',
          'release-group': {
            id: '1b022e01-4da6-387b-8658-8678046e4cef',
            title: 'Nevermind',
            'primary-type': 'Album',
          },
        },
        {
          date: '1991-09-10',
          'release-group': {
            id: 'c0000000-0000-0000-0000-000000000000',
            title: 'Smells Like Teen Spirit',
            'primary-type': 'Single',
          },
        },
      ],
    },
  ],
};

const ITUNES_ALBUMS = {
  resultCount: 1,
  results: [
    {
      collectionId: 1440783617,
      collectionName: 'Nevermind (Remastered)',
      artistName: 'Nirvana',
      releaseDate: '1991-09-24T07:00:00Z',
      primaryGenreName: 'Alternative',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/source/100x100bb.jpg',
    },
  ],
};

type Route = (url: URL) => Response | Promise<Response>;
function fakeFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const route = Object.entries(routes).find(([prefix]) => url.href.startsWith(prefix));
    if (!route) throw new TypeError(`fetch failed: ${url.href}`);
    return route[1](url);
  });
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noLimit = { schedule: <T>(fn: () => Promise<T>) => fn() };

describe('ricerca su MusicBrainz e iTunes', () => {
  test('album: candidati ordinati, corrispondenza sicura in testa, copertine di Cover Art Archive', async () => {
    const fetch = fakeFetch({
      'https://musicbrainz.org/ws/2/release-group/': () => json(MB_RELEASE_GROUPS),
      'https://itunes.apple.com/search': () => json(ITUNES_ALBUMS),
    });
    const lookup = createAlbumLookup({ fetch, userAgent: 'Spookyfy/test', limiter: noLimit });
    const out = await lookup.search({ album: 'Nevermind', artist: 'Nirvana' });

    expect(out[0]).toMatchObject({
      source: 'musicbrainz',
      title: 'Nevermind',
      artist: 'Nirvana',
      year: 1991,
      genres: ['grunge', 'alternative rock'],
      coverUrl: 'https://coverartarchive.org/release-group/1b022e01-4da6-387b-8658-8678046e4cef/front-500',
    });
    // 3 risultati da MusicBrainz bastano: iTunes non viene interpellato.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('releasegroup:"Nevermind" AND artist:"Nirvana"');
    expect((init.headers as Record<string, string>)['user-agent']).toBe('Spookyfy/test');
  });

  test('brano senza album: album che contengono il brano, prima gli album veri', async () => {
    const fetch = fakeFetch({
      'https://musicbrainz.org/ws/2/recording/': () => json(MB_RECORDINGS),
      'https://itunes.apple.com/search': () => json({ results: [] }),
    });
    const lookup = createAlbumLookup({ fetch, userAgent: 'x', limiter: noLimit });
    const out = await lookup.search({ title: 'Smells Like Teen Spirit', artist: 'Nirvana' });
    expect(out.map((c) => c.title)).toEqual(['Nevermind', 'Smells Like Teen Spirit']);
    expect(decodeURIComponent(String(fetch.mock.calls[1]?.[0]))).toContain('entity=song');
  });

  test('MusicBrainz in errore (503): si ripiega su iTunes, con copertina 600×600', async () => {
    const fetch = fakeFetch({
      'https://musicbrainz.org/': () => json({ error: 'busy' }, 503),
      'https://itunes.apple.com/search': () => json(ITUNES_ALBUMS),
    });
    const out = await createAlbumLookup({ fetch, userAgent: 'x', limiter: noLimit }).search({
      album: 'Nevermind',
      artist: 'Nirvana',
    });
    expect(out).toEqual([
      expect.objectContaining({
        source: 'itunes',
        title: 'Nevermind (Remastered)',
        genres: ['Alternative'],
        coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/source/600x600bb.jpg',
      }),
    ]);
  });

  test('nessun risultato: elenco vuoto, senza errori', async () => {
    const fetch = fakeFetch({
      'https://musicbrainz.org/': () => json({ 'release-groups': [] }),
      'https://itunes.apple.com/': () => json({ results: [] }),
    });
    await expect(
      createAlbumLookup({ fetch, userAgent: 'x', limiter: noLimit }).search({ album: 'Zzzz' }),
    ).resolves.toEqual([]);
  });

  test('entrambi i servizi irraggiungibili: errore di ricerca', async () => {
    const fetch = fakeFetch({});
    await expect(
      createAlbumLookup({ fetch, userAgent: 'x', limiter: noLimit }).search({ album: 'Nevermind' }),
    ).rejects.toBeInstanceOf(LookupError);
  });

  test('URL di base configurabili (servizi finti negli e2e)', async () => {
    const fetch = fakeFetch({
      'http://127.0.0.1:4599/mb/ws/2/release-group/': () => json(MB_RELEASE_GROUPS),
    });
    const out = await createAlbumLookup({
      fetch,
      userAgent: 'x',
      limiter: noLimit,
      musicbrainzUrl: 'http://127.0.0.1:4599/mb/',
      coverArtUrl: 'http://127.0.0.1:4599/caa',
    }).search({ album: 'Nevermind', artist: 'Nirvana' });
    expect(out[0]?.thumbUrl).toBe(
      'http://127.0.0.1:4599/caa/release-group/1b022e01-4da6-387b-8658-8678046e4cef/front-250',
    );
  });
});

describe('coda di frequenza', () => {
  afterEach(() => vi.useRealTimers());

  test('5 richieste ravvicinate vengono distanziate di almeno 1,1 s', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1100);
    const starts: number[] = [];
    const t0 = Date.now();
    const all = Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.schedule(async () => {
          starts.push(Date.now() - t0);
        }),
      ),
    );
    await vi.runAllTimersAsync();
    await all;
    expect(starts).toEqual([0, 1100, 2200, 3300, 4400]);
  });

  test('un errore non blocca le richieste successive', async () => {
    const limiter = createRateLimiter(0);
    await expect(limiter.schedule(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limiter.schedule(async () => 42)).resolves.toBe(42);
  });
});

describe('corrispondenza sicura', () => {
  test.each([
    [{ title: 'OK Computer', artist: 'Radiohead' }, { title: 'OK Computer', artist: 'Radiohead' }, true],
    [
      { title: 'ok computer', artist: 'radiohead' },
      { title: 'OK Computer OKNOTOK 1997 2017', artist: 'Radiohead' },
      false,
    ],
    [{ title: 'Nevermind', artist: 'Nirvana' }, { title: 'Nevermind (Remastered)', artist: 'Nirvana' }, true],
    [
      { title: 'Nevermind', artist: 'Nirvana' },
      { title: 'Nevermind (30th Anniversary Super Deluxe)', artist: 'Nirvana' },
      true,
    ],
    [
      { title: 'Abbey Road', artist: 'The Beatles' },
      { title: 'Abbey Road - 2019 Mix', artist: 'Beatles' },
      true,
    ],
    [{ title: 'Homogenic', artist: 'Bjork' }, { title: 'Homogenic', artist: 'Björk' }, true],
    [
      { title: 'Hail to the Thief', artist: 'Radiohead' },
      { title: 'Hail to the Thief (Live)', artist: 'Radiohead' },
      false,
    ],
    [{ title: 'Demo 2026', artist: 'Band del garage' }, { title: 'Demo', artist: 'Band del garage' }, false],
    [
      { title: 'Nevermind', artist: 'Nirvana' },
      { title: 'Nevermind', artist: 'Nirvana Tribute Band' },
      false,
    ],
    [{ title: '', artist: '' }, { title: '', artist: '' }, false],
  ])('%o ~ %o → %s', (album, candidate, expected) => {
    expect(isConfidentMatch(album, candidate)).toBe(expected);
  });

  test('matchKey toglie punteggiatura, "the" e "&"', () => {
    expect(matchKey('The Rise & Fall of Ziggy Stardust')).toBe('rise and fall of ziggy stardust');
  });
});

describe('download delle immagini', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  test('solo host consentiti, https, senza credenziali', () => {
    expect(isAllowedImageUrl('https://coverartarchive.org/release-group/x/front-500')).toBe(true);
    expect(isAllowedImageUrl('https://ia800.us.archive.org/a.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://is1-ssl.mzstatic.com/a.jpg')).toBe(true);
    expect(isAllowedImageUrl('http://coverartarchive.org/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://evilarchive.org/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedImageUrl('https://user:pw@coverartarchive.org/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://coverartarchive.org:8443/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('non un url')).toBe(false);
    expect(isAllowedImageUrl('http://127.0.0.1:4599/caa/x', ['http://127.0.0.1:4599'])).toBe(true);
  });

  test('segue i redirect verso host consentiti', async () => {
    const fetch = fakeFetch({
      'https://coverartarchive.org/': () =>
        new Response(null, { status: 307, headers: { location: 'https://ia600.us.archive.org/x.png' } }),
      'https://ia600.us.archive.org/': () => new Response(png, { headers: { 'content-type': 'image/png' } }),
    });
    const img = await fetchCoverImage('https://coverartarchive.org/release-group/x/front-500', { fetch });
    expect(img).toEqual({ bytes: png, contentType: 'image/png' });
  });

  test('host non consentito: rifiutato senza alcuna richiesta', async () => {
    const fetch = fakeFetch({});
    await expect(fetchCoverImage('https://example.com/a.jpg', { fetch })).rejects.toMatchObject({
      reason: 'not_allowed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('redirect verso un host non consentito: interrotto prima di seguirlo', async () => {
    const fetch = fakeFetch({
      'https://coverartarchive.org/': () =>
        new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/admin' } }),
    });
    await expect(fetchCoverImage('https://coverartarchive.org/a', { fetch })).rejects.toMatchObject({
      reason: 'not_allowed',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('tipo non immagine e immagine troppo grande', async () => {
    const html = fakeFetch({
      'https://coverartarchive.org/': () =>
        new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    });
    await expect(fetchCoverImage('https://coverartarchive.org/a', { fetch: html })).rejects.toMatchObject({
      reason: 'not_image',
    });
    const big = fakeFetch({
      'https://coverartarchive.org/': () =>
        new Response(new Uint8Array(2000), { headers: { 'content-type': 'image/jpeg' } }),
    });
    const err = await fetchCoverImage('https://coverartarchive.org/a', { fetch: big, maxBytes: 1000 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CoverImageError);
    expect((err as CoverImageError).reason).toBe('too_large');
  });

  test('copertina assente (404)', async () => {
    const fetch = fakeFetch({ 'https://coverartarchive.org/': () => new Response(null, { status: 404 }) });
    await expect(fetchCoverImage('https://coverartarchive.org/a', { fetch })).rejects.toMatchObject({
      reason: 'not_found',
    });
  });
});
