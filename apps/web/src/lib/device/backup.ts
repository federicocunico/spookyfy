import {
  BACKUP_AUDIO_PART_BYTES,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupLibrary,
  type BackupManifest,
  backupLibrarySchema,
  backupManifestSchema,
} from '@spookyfy/shared';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Db, DeviceSettings, LocalTrackRecord } from '../offline/db';
import {
  DEVICE_AUDIO_CACHE,
  DEVICE_COVER_CACHE,
  type DeviceLibrary,
  localAudioUrl,
  localCoverUrl,
} from './library';
import { patchSettings } from './settings';

export { DEFAULT_SETTINGS, getSettings, patchSettings } from './settings';

const absolute = (url: string) => new URL(url, globalThis.location?.href ?? 'http://localhost').href;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export class BackupError extends Error {}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const extFor = (mime: string) => (mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/aac' ? 'aac' : 'm4a');

export interface BackupPlan {
  tracks: number;
  audioBytes: number;
  parts: number;
}

/** Stima di dimensione e numero di parti prima di esportare. */
export function planBackup(
  tracks: LocalTrackRecord[],
  includeAudio: boolean,
  partBytes = BACKUP_AUDIO_PART_BYTES,
): BackupPlan {
  const withAudio = includeAudio ? tracks.filter((t) => !t.lost) : [];
  let parts = 0;
  let current = Number.POSITIVE_INFINITY;
  for (const t of withAudio) {
    if (current + t.sizeBytes > partBytes) {
      parts++;
      current = 0;
    }
    current += t.sizeBytes;
  }
  return { tracks: tracks.length, audioBytes: withAudio.reduce((s, t) => s + t.sizeBytes, 0), parts };
}

export interface BackupDeps {
  db: () => Promise<Db>;
  library: DeviceLibrary;
  caches?: CacheStorage;
  now?: () => number;
  appVersion?: string;
  partBytes?: number;
}

/**
 * Esporta la libreria: uno ZIP con manifest, libreria e copertine, più (se
 * richiesto) parti audio di dimensione limitata generate una alla volta.
 */
export async function exportBackup(d: BackupDeps, includeAudio: boolean): Promise<File[]> {
  const caches = d.caches ?? globalThis.caches;
  const now = (d.now ?? Date.now)();
  const snap = await d.library.snapshot();
  const partBytes = d.partBytes ?? BACKUP_AUDIO_PART_BYTES;
  const prefix = `spookyfy-backup-${day(now)}`;
  const audioCache = await caches.open(DEVICE_AUDIO_CACHE);
  const coverCache = await caches.open(DEVICE_COVER_CACHE);

  // Assegnazione dei brani alle parti audio.
  const partOf = new Map<string, number>();
  const parts: { index: number; tracks: LocalTrackRecord[]; bytes: number }[] = [];
  if (includeAudio) {
    for (const t of snap.tracks.filter((x) => !x.lost)) {
      let part = parts.at(-1);
      if (!part || part.bytes + t.sizeBytes > partBytes) {
        part = { index: parts.length + 1, tracks: [], bytes: 0 };
        parts.push(part);
      }
      part.tracks.push(t);
      part.bytes += t.sizeBytes;
      partOf.set(t.id, part.index);
    }
  }

  const covers: Record<string, Uint8Array> = {};
  for (const t of snap.tracks) {
    const res = await coverCache.match(absolute(localCoverUrl(t.id, 512)));
    if (res) covers[`covers/${t.id}-512.jpg`] = new Uint8Array(await res.arrayBuffer());
  }

  const itemsByPlaylist = new Map<string, typeof snap.items>();
  for (const i of snap.items)
    itemsByPlaylist.set(i.playlistId, [...(itemsByPlaylist.get(i.playlistId) ?? []), i]);

  const library: BackupLibrary = {
    tracks: snap.tracks.map((t) => ({
      id: t.id,
      sourceKey: t.sourceKey,
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationMs: t.durationMs,
      ...(t.trimStartMs ? { trimStartMs: t.trimStartMs } : {}),
      ...(t.trimEndMs ? { trimEndMs: t.trimEndMs } : {}),
      ...(t.silenceChecked ? { silenceChecked: true } : {}),
      sizeBytes: t.sizeBytes,
      mimeType: t.mimeType,
      dominantColor: t.dominantColor,
      addedAt: t.addedAt,
      cover: covers[`covers/${t.id}-512.jpg`] ? `covers/${t.id}-512.jpg` : null,
      audioPart: partOf.get(t.id) ?? null,
    })),
    favorites: snap.favorites,
    playlists: snap.playlists.map((p) => ({
      ...p,
      trackIds: (itemsByPlaylist.get(p.id) ?? [])
        .sort((a, b) => a.position - b.position)
        .map((i) => i.trackId),
    })),
    plays: snap.plays,
  };
  const libraryBytes = strToU8(JSON.stringify(library));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    appVersion: d.appVersion ?? '0.2.0',
    counts: {
      tracks: library.tracks.length,
      playlists: library.playlists.length,
      favorites: library.favorites.length,
      plays: library.plays.length,
    },
    librarySha256: await sha256(libraryBytes),
    audioParts: parts.map((p) => ({
      index: p.index,
      fileName: `${prefix}-audio-${p.index}.zip`,
      trackIds: p.tracks.map((t) => t.id),
      bytes: p.bytes,
    })),
  };

  const files = [
    new File(
      [
        zipSync(
          { 'manifest.json': strToU8(JSON.stringify(manifest)), 'library.json': libraryBytes, ...covers },
          { level: 0 },
        ) as BlobPart,
      ],
      `${prefix}.zip`,
      { type: 'application/zip' },
    ),
  ];
  // Una parte alla volta, per non tenere in memoria tutta la libreria.
  for (const p of parts) {
    const entries: Record<string, Uint8Array> = {};
    for (const t of p.tracks) {
      const res = await audioCache.match(absolute(localAudioUrl(t.id)));
      if (res) entries[`audio/${t.id}.${extFor(t.mimeType)}`] = new Uint8Array(await res.arrayBuffer());
    }
    files.push(
      new File([zipSync(entries, { level: 0 }) as BlobPart], `${prefix}-audio-${p.index}.zip`, {
        type: 'application/zip',
      }),
    );
  }
  await patchSettings(await d.db(), { lastBackupAt: now, addedSinceBackup: 0 });
  return files;
}

export interface ImportBackupResult {
  added: number;
  skipped: number;
  /** Brani senza audio nel backup: da riscaricare. */
  missingAudio: number;
  playlists: number;
}

const unzip = async (f: File) => {
  try {
    return unzipSync(new Uint8Array(await f.arrayBuffer()));
  } catch {
    throw new BackupError(`Il file ${f.name} non è un archivio valido o è danneggiato`);
  }
};

/**
 * Importa un backup: validazione completa prima di modificare qualsiasi dato,
 * unione senza duplicati (per sorgente), ascolti non contati due volte.
 */
export async function importBackup(d: BackupDeps, files: File[]): Promise<ImportBackupResult> {
  const caches = d.caches ?? globalThis.caches;
  // 1. Archivio principale: manifest e libreria validi, hash corretto.
  let main: Record<string, Uint8Array> | null = null;
  const others: File[] = [];
  for (const f of files) {
    const entries = await unzip(f);
    if (entries['manifest.json']) main = entries;
    else others.push(f);
  }
  if (!main) throw new BackupError('Manca il file principale del backup (spookyfy-backup-AAAA-MM-GG.zip)');
  let manifest: BackupManifest;
  let library: BackupLibrary;
  try {
    const m = backupManifestSchema.safeParse(JSON.parse(strFromU8(main['manifest.json']!)));
    if (!m.success) throw new BackupError(m.error.issues[0]?.message ?? 'Backup non valido');
    manifest = m.data;
    const libBytes = main['library.json'];
    if (!libBytes || (await sha256(libBytes)) !== manifest.librarySha256) {
      throw new BackupError('Il backup è danneggiato (libreria incompleta o modificata)');
    }
    const l = backupLibrarySchema.safeParse(JSON.parse(strFromU8(libBytes)));
    if (!l.success) throw new BackupError('Il backup è danneggiato (libreria non valida)');
    library = l.data;
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('Il backup è danneggiato o non è un backup di Spookyfy');
  }

  // 2. Parti audio (opzionali), indicizzate per id del brano.
  const audio = new Map<string, Uint8Array>();
  for (const f of others) {
    for (const [name, bytes] of Object.entries(await unzip(f))) {
      const m = /^audio\/(.+)\.[a-z0-9]+$/.exec(name);
      if (m?.[1]) audio.set(m[1], bytes);
    }
  }

  // 3. Unione con la libreria del dispositivo.
  await d.library.ready();
  const idMap = new Map<string, string>(); // id nel backup → id sul dispositivo
  let added = 0;
  let skipped = 0;
  let missingAudio = 0;
  for (const t of library.tracks) {
    const existing = d.library.bySourceKey(t.sourceKey);
    if (existing) {
      idMap.set(t.id, existing.id);
      skipped++;
      continue;
    }
    const bytes = audio.get(t.id);
    const coverBytes = t.cover ? main[t.cover] : undefined;
    const record: LocalTrackRecord = {
      id: t.id,
      sourceKey: t.sourceKey,
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationMs: t.durationMs,
      ...(t.trimStartMs ? { trimStartMs: t.trimStartMs } : {}),
      ...(t.trimEndMs ? { trimEndMs: t.trimEndMs } : {}),
      ...(t.silenceChecked ? { silenceChecked: true } : {}),
      sizeBytes: t.sizeBytes,
      mimeType: t.mimeType,
      dominantColor: t.dominantColor,
      addedAt: t.addedAt,
      lost: !bytes,
    };
    if (bytes) {
      const cover = coverBytes ? new Blob([coverBytes as BlobPart], { type: 'image/jpeg' }) : new Blob([]);
      await d.library.addTrack({
        record,
        audio: new Blob([bytes as BlobPart], { type: t.mimeType }),
        cover512: cover,
        cover128: cover,
      });
    } else {
      // Solo metadati: il brano compare come "da riscaricare".
      if (coverBytes) {
        const coverCache = await caches.open(DEVICE_COVER_CACHE);
        for (const size of [512, 128] as const) {
          await coverCache.put(
            absolute(localCoverUrl(t.id, size)),
            new Response(coverBytes as BodyInit, { headers: { 'Content-Type': 'image/jpeg' } }),
          );
        }
      }
      await d.library.importRecords({ tracks: [record] });
      missingAudio++;
    }
    idMap.set(t.id, t.id);
    added++;
  }

  const map = (id: string) => idMap.get(id);
  const snap = await d.library.snapshot();
  const existingPlaylists = new Map(snap.playlists.map((p) => [p.id, p]));
  const newPlaylists = library.playlists.filter((p) => !existingPlaylists.has(p.id));
  await d.library.importRecords({
    favorites: library.favorites.flatMap((f) => {
      const id = map(f.trackId);
      return id ? [{ trackId: id, createdAt: f.createdAt }] : [];
    }),
    playlists: newPlaylists.map(({ trackIds: _t, ...p }) => p),
    items: newPlaylists.flatMap((p) =>
      p.trackIds.flatMap((tid, i) => {
        const id = map(tid);
        return id
          ? [{ id: `${p.id}:${i}`, playlistId: p.id, trackId: id, position: i + 1, addedAt: p.updatedAt }]
          : [];
      }),
    ),
    plays: library.plays.flatMap((p) => {
      const id = map(p.trackId);
      return id ? [{ ...p, trackId: id }] : [];
    }),
  });
  return { added, skipped, missingAudio, playlists: newPlaylists.length };
}

/** Consegna i file del backup: foglio di condivisione su iOS ("Salva su File"), altrimenti download. */
export async function deliverFiles(files: File[]): Promise<void> {
  const nav = globalThis.navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav?.canShare?.({ files }) && nav.share) {
    try {
      await nav.share({ files, title: 'Backup di Spookyfy' });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = Object.assign(document.createElement('a'), { href: url, download: f.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Promemoria di backup: dopo 20 brani o 30 giorni dall'ultimo. */
export function backupReminderDue(s: DeviceSettings, trackCount: number, now: number): boolean {
  if (trackCount === 0) return false;
  if (s.addedSinceBackup >= 20) return true;
  if (s.lastBackupAt === null) return false;
  return now - s.lastBackupAt >= 30 * 24 * 60 * 60 * 1000;
}
