import type { TrackDto } from '@spookyfy/shared';
import { type TestServices, audioResponse, flush, makeTrack, setupServices } from '../../test/fixtures';
import { AUDIO_CACHE, Downloads } from './downloads.svelte';
import { StorageStatus } from './storage.svelte';
import { WakeLockController } from './wakelock';

let s: TestServices;
beforeEach(async () => {
  s = await setupServices();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

function fakeWakeLock(supported = true) {
  const released: number[] = [];
  let active = 0;
  const nav = {
    wakeLock: supported
      ? {
          request: vi.fn(async () => {
            active++;
            const listeners: (() => void)[] = [];
            return {
              released: false,
              addEventListener: (_: string, fn: () => void) => listeners.push(fn),
              release: vi.fn(async function (this: { released: boolean }) {
                this.released = true;
                active--;
                released.push(1);
                for (const l of listeners) l();
              }),
            };
          }),
        }
      : undefined,
  } as unknown as Navigator;
  // biome-ignore lint/performance/noDelete: "wakeLock" in navigator deve risultare falso
  if (!supported) delete (nav as { wakeLock?: unknown }).wakeLock;
  return {
    nav,
    released,
    get active() {
      return active;
    },
  };
}

/** fetch finto: audio completo per ogni brano, copertine piccole. */
function fetchOk(sizeOf: (url: string) => number = () => 1000) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/cover')) return new Response(new Uint8Array(10), { status: 200 });
    return audioResponse(sizeOf(u));
  });
}

function makeDownloads(fetchImpl: typeof fetch, wake = fakeWakeLock()) {
  const d = new Downloads({
    db: s.db,
    toasts: s.toasts,
    wakeLock: new WakeLockController(wake.nav, document),
    fetch: fetchImpl,
  });
  return { d, wake };
}

const cached = async (t: TrackDto) =>
  Boolean(await (await caches.open(AUDIO_CACHE)).match(new URL(t.audioUrl, location.href).href));

async function waitBulkDone(d: Downloads) {
  await vi.waitFor(() => expect(d.bulk).toBeNull(), { timeout: 3000 });
}

describe('download di un brano', () => {
  test('salvato in cache solo a download completo, con stato e avanzamento', async () => {
    const t = makeTrack({ sizeBytes: 1000 });
    const { d } = makeDownloads(fetchOk());
    const p = d.download(t);
    expect(d.status(t.id)).toBe('downloading');
    await p;
    expect(d.status(t.id)).toBe('downloaded');
    expect(await cached(t)).toBe(true);
    expect(await (await s.db()).get('downloads', t.id)).toMatchObject({ trackId: t.id, sizeBytes: 1000 });
    expect(await (await s.db()).get('tracks', t.id)).toMatchObject({ id: t.id });
  });

  test('connessione interrotta a metà: nessuna copia parziale ed errore mostrato', async () => {
    const t = makeTrack();
    const broken = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(400));
          c.error(new TypeError('network error'));
        },
      });
      return new Response(body, { headers: { 'content-length': '1000' } });
    });
    const { d } = makeDownloads(broken as unknown as typeof fetch);
    const error = vi.spyOn(s.toasts, 'error');
    await expect(d.download(t)).rejects.toThrow();
    expect(d.status(t.id)).toBe('none');
    expect(await cached(t)).toBe(false);
    expect(await (await s.db()).get('downloads', t.id)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('non riuscito'));
  });

  test('risposta troncata (meno byte del previsto): scartata', async () => {
    const t = makeTrack();
    const short = vi.fn(
      async () => new Response(new Uint8Array(10), { headers: { 'content-length': '1000' } }),
    );
    const { d } = makeDownloads(short as unknown as typeof fetch);
    await expect(d.download(t)).rejects.toThrow(/incompleto/);
    expect(await cached(t)).toBe(false);
  });

  test('rimozione: il brano torna "non scaricato"', async () => {
    const t = makeTrack();
    const { d } = makeDownloads(fetchOk());
    await d.download(t);
    await d.remove(t.id);
    expect(d.status(t.id)).toBe('none');
    expect(await cached(t)).toBe(false);
  });
});

describe('riconciliazione con la cache', () => {
  test('cache eliminata dal sistema: i brani tornano "non scaricati"', async () => {
    const [a, b] = [makeTrack(), makeTrack()];
    const { d } = makeDownloads(fetchOk());
    await d.download(a);
    await d.download(b);
    // Simula l'eviction di iOS.
    await (await caches.open(AUDIO_CACHE)).delete(new URL(a.audioUrl, location.href).href);
    expect(await d.reconcile()).toEqual([a.id]);
    expect(d.status(a.id)).toBe('none');
    expect(d.status(b.id)).toBe('downloaded');
    expect(await d.isAvailableOffline(a.id)).toBe(false);
  });

  test('init: ricostruisce lo stato dal database e riconcilia', async () => {
    const t = makeTrack();
    const first = makeDownloads(fetchOk()).d;
    await first.download(t);
    const { d } = makeDownloads(fetchOk());
    await d.init();
    expect(d.isDownloaded(t.id)).toBe(true);
    d.destroy();
  });
});

describe('download di playlist', () => {
  test('20 brani di cui 5 già scaricati: si scaricano solo i 15 mancanti', async () => {
    const tracks = Array.from({ length: 20 }, () => makeTrack());
    const fetchImpl = fetchOk();
    const { d, wake } = makeDownloads(fetchImpl);
    for (const t of tracks.slice(0, 5)) await d.download(t);
    fetchImpl.mockClear();

    await d.downloadAll(tracks);
    expect(d.bulk).toMatchObject({ total: 20, done: 5 });
    await waitBulkDone(d);
    const audioCalls = fetchImpl.mock.calls.filter(([u]) => String(u).endsWith('/audio'));
    expect(audioCalls).toHaveLength(15);
    expect(tracks.every((t) => d.isDownloaded(t.id))).toBe(true);
    expect(wake.released.length).toBeGreaterThan(0);
    expect(wake.active).toBe(0);
  });

  test('annullamento dopo 8 brani: restano gli 8, gli altri no', async () => {
    const tracks = Array.from({ length: 12 }, () => makeTrack());
    let audioCount = 0;
    // biome-ignore lint/style/useConst: assegnata dopo la creazione del fetch che la usa
    let d!: Downloads;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/cover')) return new Response(new Uint8Array(10));
      audioCount++;
      if (audioCount === 9) {
        void d.cancelBulk();
        await new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      }
      return audioResponse(1000);
    });
    d = makeDownloads(fetchImpl as unknown as typeof fetch).d;
    await d.downloadAll(tracks);
    await waitBulkDone(d);
    await flush();
    expect(tracks.filter((t) => d.isDownloaded(t.id))).toHaveLength(8);
    expect(tracks.slice(8).every((t) => d.status(t.id) === 'none')).toBe(true);
    expect(await (await s.db()).count('downloadQueue')).toBe(0);
  });

  test('app in background a metà: riprende al ritorno in primo piano senza riscaricare', async () => {
    const tracks = Array.from({ length: 6 }, () => makeTrack());
    let audioCount = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/cover')) return new Response(new Uint8Array(10));
      audioCount++;
      if (audioCount === 3) Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      return audioResponse(1000);
    });
    const { d } = makeDownloads(fetchImpl as unknown as typeof fetch);
    await d.init();
    await d.downloadAll(tracks);
    await vi.waitFor(async () => expect(await (await s.db()).count('downloadQueue')).toBe(3));
    expect(tracks.filter((t) => d.isDownloaded(t.id))).toHaveLength(3);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitBulkDone(d);
    expect(tracks.every((t) => d.isDownloaded(t.id))).toBe(true);
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).endsWith('/audio'))).toHaveLength(6);
    d.destroy();
  });

  test('WakeLock non supportato: avviso all’utente e il download procede', async () => {
    const tracks = [makeTrack(), makeTrack()];
    const show = vi.spyOn(s.toasts, 'show');
    const { d } = makeDownloads(fetchOk(), fakeWakeLock(false));
    await d.downloadAll(tracks);
    await waitBulkDone(d);
    expect(d.wakeLockUnsupported).toBe(true);
    expect(show).toHaveBeenCalledWith(expect.stringContaining('schermo acceso'), expect.anything());
    expect(tracks.every((t) => d.isDownloaded(t.id))).toBe(true);
  });
});

describe('WakeLock', () => {
  test('acquisizione, riacquisizione al ritorno in primo piano e rilascio', async () => {
    const wake = fakeWakeLock();
    const c = new WakeLockController(wake.nav, document);
    expect(await c.acquire()).toBe(true);
    expect(c.active).toBe(true);

    // Il sistema rilascia il blocco quando la pagina va in background.
    const sentinel = await (wake.nav.wakeLock.request as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    await sentinel.release();
    expect(c.active).toBe(false);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(wake.nav.wakeLock.request).toHaveBeenCalledTimes(2);
    expect(c.active).toBe(true);

    await c.release();
    expect(c.active).toBe(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(wake.nav.wakeLock.request).toHaveBeenCalledTimes(2);
    c.destroy();
  });

  test('non supportato', async () => {
    const c = new WakeLockController(fakeWakeLock(false).nav, document);
    expect(c.supported).toBe(false);
    expect(await c.acquire()).toBe(false);
  });
});

describe('storage persistente', () => {
  test('concesso', async () => {
    const st = new StorageStatus({
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(false),
      estimate: vi.fn().mockResolvedValue({ usage: 5e6, quota: 1e9 }),
    } as unknown as StorageManager);
    expect(await st.requestPersistence()).toBe(true);
    await st.refresh();
    expect(st.persisted).toBe(true);
    expect(st.usage).toBe(5e6);
    expect(st.quota).toBe(1e9);
  });

  test('negato o non supportato: l’app continua', async () => {
    const denied = new StorageStatus({
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(false),
    } as unknown as StorageManager);
    expect(await denied.requestPersistence()).toBe(false);
    const missing = new StorageStatus(undefined);
    expect(await missing.requestPersistence()).toBe(false);
    expect(missing.persisted).toBe(false);
  });
});

describe('salvataggio offline automatico dopo l’importazione', () => {
  test('il brano importato da questo dispositivo viene scaricato senza interrompere la musica', async () => {
    vi.stubGlobal('fetch', fetchOk());
    s = await setupServices(); // i servizi usano il fetch appena sostituito
    const audio = document.createElement('audio');
    s.player.attach(audio);
    const playing = makeTrack();
    s.player.playTracks([playing], 0);

    const imported = makeTrack({ sourceId: 'abcdefghijk' });
    s.fake.remote.ingest.mockResolvedValue({
      kind: 'job',
      job: {
        id: 'j1',
        sourceId: 'abcdefghijk',
        status: 'queued',
        progress: 0,
        error: null,
        trackId: null,
        requestedBy: 'u1',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    await s.jobs.request({ sourceId: 'abcdefghijk', title: 'x' });
    s.jobs.handleEvent({
      type: 'job.completed',
      job: {
        id: 'j1',
        sourceId: 'abcdefghijk',
        status: 'completed',
        progress: 1,
        error: null,
        trackId: imported.id,
        requestedBy: 'u1',
        createdAt: 1,
        updatedAt: 2,
      },
      track: imported,
    });
    await vi.waitFor(() => expect(s.downloads.isDownloaded(imported.id)).toBe(true));
    expect(s.player.current?.id).toBe(playing.id);
    expect(s.player.playing).toBe(true);
    expect(audio.getAttribute('src')).toBe(playing.audioUrl);
    s.player.detach();
  });

  test('i brani importati da altri dispositivi non vengono scaricati', async () => {
    const download = vi.spyOn(s.downloads, 'download');
    const t = makeTrack();
    s.jobs.handleEvent({
      type: 'job.completed',
      job: {
        id: 'altro',
        sourceId: 'zzzzzzzzzzz',
        status: 'completed',
        progress: 1,
        error: null,
        trackId: t.id,
        requestedBy: 'u2',
        createdAt: 1,
        updatedAt: 2,
      },
      track: t,
    });
    expect(download).not.toHaveBeenCalled();
  });
});
