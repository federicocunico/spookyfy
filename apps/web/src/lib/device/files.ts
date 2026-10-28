import type { TrackDto } from '@spookyfy/shared';
import type { CoverProcessor } from './cover';
import type { DeviceLibrary } from './library';

export const SUPPORTED_EXTENSIONS: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
};
export const FILE_ACCEPT = 'audio/mpeg,audio/mp4,audio/aac,audio/x-m4a,.mp3,.m4a,.aac';
export const UNKNOWN_ARTIST = 'Artista sconosciuto';

export interface FileTags {
  title?: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  picture?: { data: Uint8Array; format: string };
}

export type TagReader = (bytes: Uint8Array, mimeType: string) => Promise<FileTags>;

/** Lettura dei tag (ID3, atomi MP4) con music-metadata, caricato solo quando serve. */
export const readTags: TagReader = async (bytes, mimeType) => {
  const { parseBuffer } = await import('music-metadata');
  const m = await parseBuffer(bytes, { mimeType }, { duration: true, skipCovers: false });
  const pic = m.common.picture?.[0];
  return {
    title: m.common.title,
    artist: m.common.artist ?? m.common.albumartist,
    album: m.common.album,
    durationSec: m.format.duration,
    picture: pic ? { data: pic.data, format: pic.format } : undefined,
  };
};

export type ImportFileResult =
  | { file: string; status: 'imported'; track: TrackDto }
  | { file: string; status: 'duplicate'; track: TrackDto }
  | { file: string; status: 'rejected'; reason: string };

export interface FileImportDeps {
  library: DeviceLibrary;
  processCover: CoverProcessor;
  readTags?: TagReader;
  /** Il dispositivo sa riprodurre il tipo (es. `audio.canPlayType`). */
  canPlay?: (mimeType: string) => boolean;
}

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const titleFromName = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim() || name;

/** Chiave di deduplicazione: SHA-256 del primo MB più la dimensione. */
export async function fileKey(file: Blob): Promise<string> {
  const head = await file.slice(0, 1024 * 1024).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', head);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `file:${hex}:${file.size}`;
}

function defaultCanPlay(mimeType: string): boolean {
  if (typeof document === 'undefined') return true;
  return document.createElement('audio').canPlayType(mimeType) !== '';
}

/** Importa i file audio scelti dall'utente nella libreria del dispositivo. */
export async function importFiles(files: File[], d: FileImportDeps): Promise<ImportFileResult[]> {
  const reader = d.readTags ?? readTags;
  const canPlay = d.canPlay ?? defaultCanPlay;
  const out: ImportFileResult[] = [];
  for (const file of files) {
    const mimeType = SUPPORTED_EXTENSIONS[extOf(file.name)];
    if (!mimeType || !canPlay(mimeType)) {
      out.push({
        file: file.name,
        status: 'rejected',
        reason: 'Formato non supportato: usa file MP3 o M4A/AAC',
      });
      continue;
    }
    const key = await fileKey(file);
    const existing = d.library.bySourceKey(key);
    if (existing) {
      out.push({ file: file.name, status: 'duplicate', track: d.library.toDto(existing) });
      continue;
    }
    let tags: FileTags = {};
    try {
      tags = await reader(new Uint8Array(await file.arrayBuffer()), mimeType);
    } catch {
      // File senza tag leggibili: si usano nome del file e valori predefiniti.
    }
    const picture = tags.picture
      ? new Blob([tags.picture.data as BlobPart], { type: tags.picture.format || 'image/jpeg' })
      : null;
    const cover = await d.processCover(picture);
    const track = await d.library.addTrack({
      record: {
        sourceKey: key,
        title: tags.title?.trim() || titleFromName(file.name),
        artist: tags.artist?.trim() || UNKNOWN_ARTIST,
        album: tags.album?.trim() || null,
        durationMs: Math.round((tags.durationSec ?? 0) * 1000),
        sizeBytes: file.size,
        mimeType,
        dominantColor: cover.dominantColor,
      },
      audio: file,
      cover512: cover.large,
      cover128: cover.thumb,
    });
    out.push({ file: file.name, status: 'imported', track });
  }
  return out;
}
