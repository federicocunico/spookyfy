import { strFromU8, unzipSync } from 'fflate';
import { openSpookyfyDb } from '../offline/db';
import {
  BackupError,
  backupReminderDue,
  exportBackup,
  getSettings,
  importBackup,
  planBackup,
} from './backup';
import { DeviceLibrary } from './library';

let n = 0;
async function makeLibrary() {
  const db = await openSpookyfyDb(`spk-backup-${Date.now()}-${++n}`);
  const library = new DeviceLibrary({ db: async () => db });
  await library.ready();
  return {
    db,
    library,
    deps: { db: async () => db, library, now: () => Date.UTC(2026, 9, 28), partBytes: 250 },
  };
}

async function seed(library: DeviceLibrary) {
  const add = (title: string, key: string, size: number) =>
    library.addTrack({
      record: {
        sourceKey: key,
        title,
        artist: 'Band',
        album: null,
        durationMs: 1000,
        sizeBytes: size,
        mimeType: 'audio/mp4',
        dominantColor: '#123456',
      },
      audio: new Blob([new Uint8Array(size).fill(title.charCodeAt(0))], { type: 'audio/mp4' }),
      cover512: new Blob([new Uint8Array(20)], { type: 'image/jpeg' }),
      cover128: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
    });
  const a = await add('A', 'youtube:aaaaaaaaaaa', 100);
  const b = await add('B', 'youtube:bbbbbbbbbbb', 100);
  const c = await add('C', 'file:ccc', 100);
  const p = await library.createPlaylist('Notte');
  for (const t of [c, a, a]) await library.addItem(p.id, t.id);
  await library.setFavorite(b.id, true);
  await library.submitPlays([
    { id: 'p1', trackId: a.id, playedAt: 1 },
    { id: 'p2', trackId: b.id, playedAt: 2 },
  ]);
  return { a, b, c, p };
}

describe('esportazione', () => {
  test('backup leggero: un solo file con manifest, libreria e copertine', async () => {
    const { library, deps } = await makeLibrary();
    await seed(library);
    const files = await exportBackup(deps, false);
    expect(files.map((f) => f.name)).toEqual(['spookyfy-backup-2026-10-28.zip']);
    const zip = unzipSync(new Uint8Array(await files[0]!.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(zip['manifest.json']!));
    expect(manifest).toMatchObject({
      format: 'spookyfy-backup',
      version: 1,
      counts: { tracks: 3, playlists: 1, favorites: 1, plays: 2 },
      audioParts: [],
    });
    expect(manifest.librarySha256).toMatch(/^[0-9a-f]{64}$/);
    const lib = JSON.parse(strFromU8(zip['library.json']!));
    expect(lib.playlists[0].trackIds).toHaveLength(3);
    expect(Object.keys(zip).filter((k) => k.startsWith('covers/'))).toHaveLength(3);
  });

  test('backup completo: parti audio entro il limite, stima coerente', async () => {
    const { library, deps } = await makeLibrary();
    await seed(library);
    const snap = await library.snapshot();
    expect(planBackup(snap.tracks, true, 250)).toEqual({ tracks: 3, audioBytes: 300, parts: 2 });
    const files = await exportBackup(deps, true);
    expect(files.map((f) => f.name)).toEqual([
      'spookyfy-backup-2026-10-28.zip',
      'spookyfy-backup-2026-10-28-audio-1.zip',
      'spookyfy-backup-2026-10-28-audio-2.zip',
    ]);
    const manifest = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await files[0]!.arrayBuffer()))['manifest.json']!),
    );
    expect(manifest.audioParts.map((p: { bytes: number }) => p.bytes)).toEqual([200, 100]);
    const part1 = unzipSync(new Uint8Array(await files[1]!.arrayBuffer()));
    expect(Object.keys(part1)).toHaveLength(2);
  });

  test('l’esportazione registra la data e azzera il contatore del promemoria', async () => {
    const { library, deps, db } = await makeLibrary();
    await seed(library);
    expect((await getSettings(db)).addedSinceBackup).toBe(3);
    await exportBackup(deps, false);
    expect(await getSettings(db)).toMatchObject({ lastBackupAt: Date.UTC(2026, 9, 28), addedSinceBackup: 0 });
  });
});

describe('importazione', () => {
  test('ripristino completo su un dispositivo nuovo: libreria, playlist, preferiti e ascolti identici', async () => {
    const src = await makeLibrary();
    const { a, b } = await seed(src.library);
    const files = await exportBackup(src.deps, true);

    const dst = await makeLibrary();
    const r = await importBackup(dst.deps, files);
    expect(r).toEqual({ added: 3, skipped: 0, missingAudio: 0, playlists: 1 });
    expect((await dst.library.list({})).items.map((t) => t.title).sort()).toEqual(['A', 'B', 'C']);
    expect(dst.library.isLocal(a.id)).toBe(true);
    const [pl] = await dst.library.listPlaylists();
    expect((await dst.library.getPlaylist(pl!.id)).items.map((i) => i.track.title)).toEqual(['C', 'A', 'A']);
    expect((await dst.library.listFavorites()).map((f) => f.track.id)).toEqual([b.id]);
    expect((await dst.library.get(a.id)).playCount).toBe(1);
  });

  test('backup leggero: i brani compaiono come "da riscaricare"', async () => {
    const src = await makeLibrary();
    const { a } = await seed(src.library);
    const files = await exportBackup(src.deps, false);
    const dst = await makeLibrary();
    const r = await importBackup(dst.deps, files);
    expect(r.missingAudio).toBe(3);
    expect(dst.library.isLocal(a.id)).toBe(false);
    expect(dst.library.lostTracks()).toHaveLength(3);
  });

  test('doppia importazione: nessun duplicato, ascolti non contati due volte', async () => {
    const src = await makeLibrary();
    const { a } = await seed(src.library);
    const files = await exportBackup(src.deps, true);
    const dst = await makeLibrary();
    await importBackup(dst.deps, files);
    const second = await importBackup(dst.deps, files);
    expect(second).toMatchObject({ added: 0, skipped: 3, playlists: 0 });
    expect(dst.library.usage().count).toBe(3);
    expect((await dst.library.get(a.id)).playCount).toBe(1);
    expect(await dst.library.listPlaylists()).toHaveLength(1);
  });

  test('file troncato o non valido: errore e libreria invariata', async () => {
    const src = await makeLibrary();
    await seed(src.library);
    const [main] = await exportBackup(src.deps, false);
    const bytes = new Uint8Array(await main!.arrayBuffer());
    const truncated = new File([bytes.slice(0, Math.floor(bytes.length / 2))], main!.name);
    const dst = await makeLibrary();
    await expect(importBackup(dst.deps, [truncated])).rejects.toBeInstanceOf(BackupError);
    await expect(importBackup(dst.deps, [new File(['ciao'], 'x.zip')])).rejects.toBeInstanceOf(BackupError);
    expect(dst.library.usage().count).toBe(0);
  });
});

describe('promemoria di backup', () => {
  const DAY = 24 * 60 * 60 * 1000;
  test.each([
    [{ lastBackupAt: null, addedSinceBackup: 25 }, 25, 0, true],
    [{ lastBackupAt: null, addedSinceBackup: 5 }, 5, 0, false],
    [{ lastBackupAt: 0, addedSinceBackup: 2 }, 40, 31 * DAY, true],
    [{ lastBackupAt: 0, addedSinceBackup: 2 }, 40, 10 * DAY, false],
    [{ lastBackupAt: null, addedSinceBackup: 0 }, 0, 0, false],
  ])('%o con %i brani dopo %i ms → %s', (s, count, now, due) => {
    expect(backupReminderDue({ bridge: null, ...s }, count, now)).toBe(due);
  });
});
