import { fakeCover } from '../../test/client-fixtures';
import { openSpookyfyDb } from '../offline/db';
import { UNKNOWN_ARTIST, fileKey, importFiles } from './files';
import { DEVICE_COVER_CACHE, DeviceLibrary, localCoverUrl } from './library';

/** Frame MPEG-1 Layer III silenziosi, come nei test del server. */
function silentFrames(count: number): Uint8Array {
  const out = new Uint8Array(417 * count);
  for (let i = 0; i < count; i++) out.set([0xff, 0xfb, 0x90, 0xc0], i * 417);
  return out;
}

const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const be32 = (n: number) => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const syncsafe = (n: number) => Uint8Array.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
const frame = (id: string, data: Uint8Array) =>
  concat(latin1(id), be32(data.length), new Uint8Array(2), data);
const text = (id: string, value: string) => frame(id, concat(Uint8Array.of(0), latin1(value)));

/** MP3 con tag ID3v2.3: titolo, artista, album e copertina (APIC). */
function mp3WithTags() {
  const cover = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const frames = concat(
    text('TIT2', 'Albachiara'),
    text('TPE1', 'Vasco Rossi'),
    text('TALB', 'Non siamo mica gli americani'),
    frame('APIC', concat(Uint8Array.of(0), latin1('image/jpeg'), Uint8Array.of(0, 3, 0), cover)),
  );
  const header = concat(latin1('ID3'), Uint8Array.of(3, 0, 0), syncsafe(frames.length));
  return concat(header, frames, silentFrames(115));
}

let n = 0;
async function setup() {
  const db = await openSpookyfyDb(`spk-files-${Date.now()}-${++n}`);
  const library = new DeviceLibrary({ db: async () => db });
  await library.ready();
  const covers: (Blob | null)[] = [];
  const processCover = async (b: Blob | null) => {
    covers.push(b);
    return fakeCover(b);
  };
  return { library, covers, deps: { library, processCover, canPlay: () => true } };
}

test('MP3 con tag ID3: titolo, artista, album e copertina dal file', async () => {
  const { deps, covers } = await setup();
  const [r0] = await importFiles([new File([mp3WithTags()], 'albachiara.mp3', { type: 'audio/mpeg' })], deps);
  const r = r0!;
  expect(r).toMatchObject({
    status: 'imported',
    track: { title: 'Albachiara', artist: 'Vasco Rossi', album: 'Non siamo mica gli americani' },
  });
  expect(covers[0]).not.toBeNull(); // la copertina del file è stata usata
  expect(r!.status === 'imported' && r.track.durationMs).toBeGreaterThan(2500);
  const cover = await (await caches.open(DEVICE_COVER_CACHE)).match(
    new URL(localCoverUrl(r!.status === 'imported' ? r.track.id : '', 512), location.href).href,
  );
  expect(cover).toBeDefined();
});

test('M4A senza tag: titolo dal nome del file, artista sconosciuto, copertina predefinita', async () => {
  const { deps, covers } = await setup();
  const [r0] = await importFiles(
    [new File([new Uint8Array(2048)], 'Canzone di prova.m4a', { type: 'audio/mp4' })],
    deps,
  );
  const r = r0!;
  expect(r).toMatchObject({
    status: 'imported',
    track: { title: 'Canzone di prova', artist: UNKNOWN_ARTIST, album: null },
  });
  expect(covers[0]).toBeNull();
  expect(r!.status === 'imported' && r.track.dominantColor).toBe('#3a3a3a');
});

test('FLAC e formati non riproducibili rifiutati con un messaggio', async () => {
  const { deps, library } = await setup();
  const results = await importFiles(
    [
      new File([new Uint8Array(10)], 'brano.flac', { type: 'audio/flac' }),
      new File([new Uint8Array(10)], 'brano.mp3', { type: 'audio/mpeg' }),
    ],
    { ...deps, canPlay: (m) => m !== 'audio/mpeg' },
  );
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  expect(results[0]).toMatchObject({ reason: expect.stringContaining('MP3 o M4A') });
  expect(library.usage().count).toBe(0);
});

test('lo stesso file importato due volte non si duplica (hash del contenuto)', async () => {
  const { deps, library } = await setup();
  const bytes = mp3WithTags();
  await importFiles([new File([bytes], 'a.mp3')], deps);
  const [again] = await importFiles([new File([bytes], 'copia.mp3')], deps);
  expect(again!.status).toBe('duplicate');
  expect(library.usage().count).toBe(1);
  expect(await fileKey(new File([bytes], 'x'))).toMatch(/^file:[0-9a-f]{64}:\d+$/);
});

/** MP3 con album, numero di traccia e genere nei tag (TALB, TRCK, TCON, TPE2). */
function mp3WithAlbum(title: string, track: string, genre: string) {
  const frames = concat(
    text('TIT2', title),
    text('TPE1', 'Nirvana'),
    text('TPE2', 'Nirvana'),
    text('TALB', 'In Utero'),
    text('TRCK', track),
    text('TCON', genre),
  );
  const header = concat(latin1('ID3'), Uint8Array.of(3, 0, 0), syncsafe(frames.length));
  return concat(header, frames, silentFrames(115));
}

test('genere, numero di traccia e album dai tag: un solo album nell’ordine delle tracce', async () => {
  const { library, deps } = await setup();
  const files = [
    new File([mp3WithAlbum('Heart-Shaped Box', '2/12', 'Alternative; Indie')], 'b.mp3', {
      type: 'audio/mpeg',
    }),
    new File([mp3WithAlbum('Serve the Servants', '1/12', 'Alternative; Indie')], 'a.mp3', {
      type: 'audio/mpeg',
    }),
  ];
  const [first] = await importFiles(files, deps);
  expect(first).toMatchObject({ status: 'imported', track: { genres: ['Alternative', 'Indie'] } });
  const albums = await library.listAlbums();
  expect(albums).toEqual([expect.objectContaining({ title: 'In Utero', artist: 'Nirvana', trackCount: 2 })]);
  const album = await library.getAlbum(albums[0]!.id);
  expect(album.tracks.map((t) => t.title)).toEqual(['Serve the Servants', 'Heart-Shaped Box']);
  expect(album.genres).toEqual(['Alternative', 'Indie']);
});
