import type { LookupCandidateDto } from '@spookyfy/shared';
import { type Api, ApiError } from '../api';
import { openSpookyfyDb } from '../offline/db';
import { createDeviceBackend } from './backend';
import { scheduleCoverLookup, updateCatalogSettings } from './catalog';
import type { CoverProcessor } from './cover';
import type { DeviceImporter } from './importer';
import { DeviceLibrary } from './library';
import type { GatewayClient } from './remote';

let n = 0;
const processCover: CoverProcessor = async () => ({
  large: new Blob([new Uint8Array(4)], { type: 'image/jpeg' }),
  thumb: new Blob([new Uint8Array(2)], { type: 'image/jpeg' }),
  dominantColor: '#10a040',
});

const candidate = (title: string, artist: string): LookupCandidateDto => ({
  id: `mb:${title}`,
  source: 'musicbrainz',
  title,
  artist,
  year: 1997,
  genres: ['art rock'],
  coverUrl: `https://coverartarchive.org/release-group/${encodeURIComponent(title)}/front-500`,
  thumbUrl: `https://coverartarchive.org/release-group/${encodeURIComponent(title)}/front-250`,
  score: 100,
});

function fakeGateway(o: { candidates?: LookupCandidateDto[]; fail?: boolean } = {}) {
  return {
    lookupAlbums: vi.fn(async () => {
      if (o.fail) throw new ApiError(0, 'NETWORK', 'offline');
      return { items: o.candidates ?? [] };
    }),
    lookupImage: vi.fn(async () => new Blob([new Uint8Array(8)], { type: 'image/jpeg' })),
  };
}

async function setup(gw = fakeGateway()) {
  const db = await openSpookyfyDb(`spk-lookup-${Date.now()}-${++n}`);
  let t = 1_000;
  const library = new DeviceLibrary({ db: async () => db, now: () => ++t, processCover });
  await library.ready();
  const gateway = gw as unknown as GatewayClient;
  const api: Api = createDeviceBackend({
    library,
    importer: {} as DeviceImporter,
    gateway,
    auth: {} as Api['auth'],
    db: async () => db,
  });
  return { db, library, gateway: gw, api };
}

describe('ricerca online sul dispositivo', () => {
  test('con l’interruttore spento non parte alcuna richiesta al gateway', async () => {
    const { db, api, gateway } = await setup(
      fakeGateway({ candidates: [candidate('OK Computer', 'Radiohead')] }),
    );
    expect(await api.settings.get()).toEqual({ coverLookup: true, coverLookupLocked: false });
    await updateCatalogSettings(db, { coverLookup: false });
    await expect(api.lookup.search({ album: 'OK Computer' })).rejects.toMatchObject({
      code: 'LOOKUP_DISABLED',
    });
    const album = await api.albums.create({ title: 'OK Computer', artist: 'Radiohead' });
    await expect(
      api.albums.applyCandidate(album.id, { candidate: candidate('OK Computer', 'Radiohead'), fields: {} }),
    ).rejects.toMatchObject({ code: 'LOOKUP_DISABLED' });
    expect(gateway.lookupAlbums).not.toHaveBeenCalled();
    expect(gateway.lookupImage).not.toHaveBeenCalled();
  });

  test('applicazione di un candidato: copertina e, a scelta, anno e generi', async () => {
    const { api, gateway } = await setup();
    const album = await api.albums.create({ title: 'Ok computer', artist: 'Radiohead' });
    const c = candidate('OK Computer', 'Radiohead');
    const onlyCover = await api.albums.applyCandidate(album.id, { candidate: c, fields: {} });
    expect(onlyCover).toMatchObject({ hasCustomCover: true, title: 'Ok computer', year: null });
    expect(gateway.lookupImage).toHaveBeenCalledWith(c.coverUrl);
    const all = await api.albums.applyCandidate(album.id, {
      candidate: c,
      fields: { title: true, year: true },
    });
    expect(all).toMatchObject({ title: 'OK Computer', year: 1997 });
  });
});

describe('ricerca automatica sul dispositivo', () => {
  afterEach(() => vi.useRealTimers());

  test('parte dopo il ritardo, applica solo con corrispondenza sicura, una volta per album', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gw = fakeGateway({ candidates: [candidate('OK Computer', 'Radiohead')] });
    const { library } = await setup(gw);
    const ok = await library.createAlbum({ title: 'OK Computer', artist: 'Radiohead' });
    const demo = await library.createAlbum({ title: 'Demo 2026', artist: 'Band del garage' });
    const applied = vi.fn();
    const stop = scheduleCoverLookup(library, gw as unknown as GatewayClient, {
      enabled: async () => true,
      onApplied: applied,
      delayMs: 8000,
    });
    await vi.advanceTimersByTimeAsync(7000);
    expect(gw.lookupAlbums).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(applied).toHaveBeenCalledWith(1));
    expect((await library.getAlbum(ok.id)).hasCustomCover).toBe(true);
    // Solo la copertina: anno e generi restano quelli dell'utente.
    expect(await library.getAlbum(ok.id)).toMatchObject({ year: null, genres: [] });
    expect((await library.getAlbum(demo.id)).hasCustomCover).toBe(false);
    expect(library.nextPendingLookup([])).toBeUndefined();
    stop();
  });

  test('un album nuovo viene cercato poco dopo la creazione', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gw = fakeGateway({ candidates: [candidate('Kid A', 'Radiohead')] });
    const { library } = await setup(gw);
    const stop = scheduleCoverLookup(library, gw as unknown as GatewayClient, { enabled: async () => true });
    await vi.advanceTimersByTimeAsync(8000);
    const album = await library.createAlbum({ title: 'Kid A', artist: 'Radiohead' });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(async () => expect((await library.getAlbum(album.id)).hasCustomCover).toBe(true));
    stop();
  });

  test('gateway irraggiungibile: si ferma dopo 3 errori, gli album restano da cercare', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gw = fakeGateway({ fail: true });
    const { library } = await setup(gw);
    for (const title of ['A', 'B', 'C', 'D']) await library.createAlbum({ title });
    const stop = scheduleCoverLookup(library, gw as unknown as GatewayClient, { enabled: async () => true });
    await vi.advanceTimersByTimeAsync(8000);
    await vi.waitFor(() => expect(gw.lookupAlbums).toHaveBeenCalledTimes(3));
    await library.createAlbum({ title: 'E' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(gw.lookupAlbums).toHaveBeenCalledTimes(3);
    expect(library.nextPendingLookup([])).toBeDefined();
    stop();
  });

  test('ricerca spenta o arrestata: nessuna richiesta', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gw = fakeGateway({ candidates: [candidate('A', 'Artisti vari')] });
    const { library } = await setup(gw);
    await library.createAlbum({ title: 'A' });
    const stop = scheduleCoverLookup(library, gw as unknown as GatewayClient, { enabled: async () => false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gw.lookupAlbums).not.toHaveBeenCalled();
    stop();
    const stopped = scheduleCoverLookup(library, gw as unknown as GatewayClient, {
      enabled: async () => true,
    });
    stopped();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gw.lookupAlbums).not.toHaveBeenCalled();
  });
});
