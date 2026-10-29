import type { WsServerEvent } from '@spookyfy/shared';
import { audioBytes, fakeCover, setupClientServices } from '../../test/client-fixtures';
import { flush } from '../../test/fixtures';
import { MODE_STORAGE_KEY, detectMode } from '../mode';
import { DEVICE_AUDIO_CACHE, localAudioUrl } from './library';

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('rilevamento della modalità', () => {
  const health = (mode: string) =>
    vi.fn(async () => new Response(JSON.stringify({ status: 'ok', mode, version: '1', features: [] })));

  test('online: modalità dalla health check, salvata per l’avvio offline', async () => {
    localStorage.clear();
    expect((await detectMode(health('client') as unknown as typeof fetch)).mode).toBe('client');
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('client');
    expect((await detectMode(health('onpremise') as unknown as typeof fetch)).mode).toBe('onpremise');
  });

  test('offline: ultima modalità nota (client), altrimenti on-premise', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    localStorage.setItem(MODE_STORAGE_KEY, 'client');
    expect(await detectMode(offline)).toEqual({ mode: 'client', health: null });
    localStorage.clear();
    expect((await detectMode(offline)).mode).toBe('onpremise');
  });

  test('i servizi della modalità client usano la libreria del dispositivo', async () => {
    const s = await setupClientServices();
    expect(s.mode).toBe('client');
    expect(s.device).not.toBeNull();
    expect((await s.api.tracks.list({})).items).toEqual([]);
    s.device!.importer.stop();
  });
});

describe('importazione da YouTube tramite gateway', () => {
  test('metadati, copertina, audio con avanzamento; poi brano in libreria e riproducibile offline', async () => {
    const s = await setupClientServices({ audioSize: 5000 });
    const events: WsServerEvent[] = [];
    const orig = s.jobs.handleEvent.bind(s.jobs);
    s.jobs.handleEvent = (e) => {
      events.push(e);
      orig(e);
    };
    const res = await s.api.remote.ingest('abcdefghijk');
    expect(res.kind).toBe('job');
    await s.device!.importer.idle();
    const completed = events.find((e) => e.type === 'job.completed') as Extract<
      WsServerEvent,
      { type: 'job.completed' }
    >;
    expect(completed.track).toMatchObject({
      title: 'Canzone abcdefghijk',
      sourceId: 'abcdefghijk',
      sizeBytes: 5000,
    });
    expect(events.map((e) => e.type)).toContain('job.progress');
    expect(s.isLocal(completed.track.id)).toBe(true);
    const cached = await (await caches.open(DEVICE_AUDIO_CACHE)).match(
      new URL(localAudioUrl(completed.track.id), location.href).href,
    );
    expect((await cached!.arrayBuffer()).byteLength).toBe(5000);
    expect(s.gw.calls).toEqual(
      expect.arrayContaining(['/api/meta/abcdefghijk', '/api/cover/abcdefghijk', '/api/audio/abcdefghijk']),
    );
    s.device!.importer.stop();
  });

  test('video già presente: nessun nuovo download', async () => {
    const s = await setupClientServices();
    await s.api.remote.ingest('abcdefghijk');
    await s.device!.importer.idle();
    const before = s.gw.calls.length;
    const again = await s.api.remote.ingest('abcdefghijk');
    expect(again.kind).toBe('track');
    expect(s.gw.calls.length).toBe(before);
    s.device!.importer.stop();
  });

  test('connessione persa a metà: nessun brano e nessun file parziale', async () => {
    const s = await setupClientServices({ audioSize: 5000, breakAudioAt: 1000 });
    const audioKeys = async () =>
      (await (await caches.open(DEVICE_AUDIO_CACHE)).keys()).filter((k) => k.url.includes('/local/audio/'))
        .length;
    const before = await audioKeys();
    await s.api.remote.ingest('abcdefghijk');
    await s.device!.importer.idle();
    const [job] = (await s.api.remote.jobs()).items;
    expect(job).toMatchObject({ status: 'failed' });
    expect((await s.api.tracks.list({})).items).toEqual([]);
    expect(await audioKeys()).toBe(before);
    s.device!.importer.stop();
  });

  test.each([
    ['blocked0000', 'YOUTUBE_BLOCKED'],
    ['unavail0000', 'VIDEO_UNAVAILABLE'],
    ['toolong0000', 'VIDEO_TOO_LONG'],
  ])('errore specifico per %s e nuovo tentativo', async (id, code) => {
    const s = await setupClientServices();
    await s.api.remote.ingest(id);
    await s.device!.importer.idle();
    const [job] = (await s.api.remote.jobs()).items;
    expect(job).toMatchObject({ status: 'failed', errorCode: code });
    expect((await s.api.remote.retry(job!.id)).status).toBe('queued');
    await s.device!.importer.idle();
    s.device!.importer.stop();
  });

  test('spazio insufficiente: importazione non avviata con messaggio', async () => {
    const s = await setupClientServices({ audioSize: 5000, storageEstimate: { usage: 990, quota: 1000 } });
    await s.api.remote.ingest('abcdefghijk');
    await s.device!.importer.idle();
    const [job] = (await s.api.remote.jobs()).items;
    expect(job).toMatchObject({ status: 'failed', errorCode: 'INSUFFICIENT_STORAGE' });
    expect(s.gw.calls).not.toContain('/api/audio/abcdefghijk');
    s.device!.importer.stop();
  });

  test('coda: al massimo due alla volta, ripresa dopo il background senza duplicati', async () => {
    const s = await setupClientServices();
    let concurrent = 0;
    let max = 0;
    const origFetch = s.gw.fetch;
    vi.stubGlobal('fetch', origFetch);
    const slow = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/audio/')) {
        concurrent++;
        max = Math.max(max, concurrent);
        await new Promise((r) => setTimeout(r, 15));
        concurrent--;
      }
      return origFetch(input, init);
    });
    // Il gestore usa il fetch del gateway passato ai servizi: lo si sostituisce qui.
    (s.device!.gateway as unknown as { fetchImpl: typeof fetch }).fetchImpl = slow as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) await s.api.remote.ingest(`queue${String(i).padStart(6, '0')}`);
    await s.device!.importer.idle();
    expect(max).toBeLessThanOrEqual(2);
    expect((await s.api.tracks.list({})).items).toHaveLength(5);

    // App in background: le nuove importazioni aspettano il ritorno in primo piano.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await s.api.remote.ingest('later000000');
    await flush();
    expect((await s.api.remote.jobs()).items.find((j) => j.sourceId === 'later000000')?.status).toBe(
      'queued',
    );
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await s.device!.importer.idle();
    expect((await s.api.tracks.list({})).items).toHaveLength(6);
    s.device!.importer.stop();
  });

  test('importazioni rimaste "in corso" dopo una chiusura dell’app riprendono all’avvio', async () => {
    const s = await setupClientServices();
    const db = await s.db();
    await db.put('imports', {
      id: 'interrotta',
      kind: 'youtube',
      sourceId: 'resume00000',
      status: 'running',
      progress: 0.4,
      error: null,
      errorCode: null,
      trackId: null,
      replaceTrackId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    s.device!.importer.stop();
    await s.device!.importer.init();
    await s.device!.importer.idle();
    expect((await s.api.tracks.list({})).items.map((t) => t.sourceId)).toEqual(['resume00000']);
    s.device!.importer.stop();
  });
});

describe('riproduzione durante l’importazione', () => {
  test('il brano provvisorio suona dal gateway e viene sostituito senza interruzioni', async () => {
    const s = await setupClientServices();
    const audio = document.createElement('audio');
    s.player.attach(audio);
    const pending = {
      id: 'pending:abcdefghijk',
      sourceId: 'abcdefghijk',
      title: 'In arrivo',
      artist: 'Band',
      album: null,
      durationMs: 3000,
      sizeBytes: 0,
      dominantColor: '#3a3a3a',
      addedAt: 1,
      audioUrl: '/api/audio/abcdefghijk',
      coverUrl: '/api/cover/abcdefghijk',
      coverThumbUrl: '/api/cover/abcdefghijk',
      isFavorite: false,
      playCount: 0,
      lastPlayedAt: null,
    };
    s.player.playTracks([pending], 0);
    expect(audio.getAttribute('src')).toBe('/api/audio/abcdefghijk');
    expect(s.player.playing).toBe(true);

    const job = await s.api.remote.ingest('abcdefghijk');
    if (job.kind === 'job') s.jobs.adopt(job.job);
    await s.device!.importer.idle();
    await flush();
    const local = (await s.api.tracks.list({})).items[0]!;
    expect(s.player.current?.id).toBe(local.id);
    expect(audio.getAttribute('src')).toBe('/api/audio/abcdefghijk'); // nessuna interruzione
    expect(s.player.playing).toBe(true);
    // Riproduzioni successive dalla copia locale.
    s.player.playTracks([s.player.current!], 0);
    expect(audio.getAttribute('src')).toBe(local.audioUrl);
    s.player.detach();
    s.device!.importer.stop();
  });

  test('senza Service Worker (ricarica forzata) il brano sul dispositivo suona dalla Cache Storage', async () => {
    const s = await setupClientServices();
    const job = await s.api.remote.ingest('abcdefghijk');
    if (job.kind === 'job') s.jobs.adopt(job.job);
    await s.device!.importer.idle();
    const local = (await s.api.tracks.list({})).items[0]!;

    const sw = navigator.serviceWorker;
    Object.defineProperty(navigator, 'serviceWorker', { value: { controller: null }, configurable: true });
    const created: Blob[] = [];
    URL.createObjectURL = (b: Blob) => {
      created.push(b);
      return `blob:test/${created.length}`;
    };
    URL.revokeObjectURL = () => {};
    try {
      const audio = document.createElement('audio');
      s.player.attach(audio);
      s.player.playTracks([local], 0);
      await expect.poll(() => audio.getAttribute('src')).toBe('blob:test/1');
      expect(created[0]!.size).toBe(local.sizeBytes);
      expect(s.player.playing).toBe(true);
      s.player.detach();
    } finally {
      Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
      s.device!.importer.stop();
    }
  });

  test('offline il brano provvisorio non è riproducibile', async () => {
    const s = await setupClientServices();
    s.connection.set({ online: false });
    const audio = document.createElement('audio');
    s.player.attach(audio);
    s.player.playTracks(
      [
        {
          ...(await (async () => ({
            id: 'pending:x',
            sourceId: 'x',
            title: 'X',
            artist: 'Y',
            album: null,
            durationMs: 1,
            sizeBytes: 0,
            dominantColor: '#000000',
            addedAt: 1,
            audioUrl: '/api/audio/x',
            coverUrl: '',
            coverThumbUrl: '',
            isFavorite: false,
            playCount: 0,
            lastPlayedAt: null,
          }))()),
        },
      ],
      0,
    );
    expect(audio.getAttribute('src')).toBeNull();
    s.player.detach();
    s.device!.importer.stop();
  });
});

test('copertina finta coerente', async () => {
  expect((await fakeCover(null)).dominantColor).toBe('#3a3a3a');
  expect(audioBytes(4)[0]).toBe(0xff);
});
