import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_TRACK_DURATION_SEC, REMOTE_SEARCH_LIMIT, YOUTUBE_ID_PATTERN } from '@spookyfy/shared';
import { SpawnError, runProcess } from './process.js';

/** Metadati rilevanti prodotti da yt-dlp (`--write-info-json` / `-J`). */
export interface YtInfo {
  id: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  track?: string;
  artist?: string;
  artists?: string[];
  album?: string;
  live_status?: string;
  thumbnails?: { url: string; width?: number; height?: number }[];
}

export interface RemoteSearchItem {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number | null;
  thumbnailUrl: string;
}

export interface DownloadResult {
  audioFile: string;
  thumbnailFile: string | undefined;
  info: YtInfo;
}

export type YtDlpErrorKind = 'unavailable' | 'too_long' | 'timeout' | 'aborted' | 'not_installed' | 'failed';

export class YtDlpError extends Error {
  constructor(
    public readonly kind: YtDlpErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'YtDlpError';
  }
}

export interface YtDlp {
  search(query: string, opts?: { timeoutMs?: number }): Promise<RemoteSearchItem[]>;
  download(
    sourceId: string,
    outDir: string,
    opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<DownloadResult>;
}

export interface YtDlpOptions {
  /** Eseguibile (es. `yt-dlp`, o `node` nei test). */
  command: string;
  /** Argomenti da anteporre (es. lo script finto nei test). */
  argsPrefix?: string[];
  ffmpegPath?: string;
  nice?: number;
  searchTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

const PROGRESS_MARK = 'spk-progress';
const PROGRESS_RE = new RegExp(`${PROGRESS_MARK}\\s+([\\d.]+)%`);
const UNAVAILABLE_RE =
  /video unavailable|private video|not available|has been removed|members-only|sign in to confirm your age|account associated with this video has been terminated|copyright/i;

export const youtubeUrl = (sourceId: string) => `https://www.youtube.com/watch?v=${sourceId}`;
const fallbackThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function lastErrorLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim());
  const err = [...lines].reverse().find((l) => l.startsWith('ERROR'));
  return (err ?? lines.at(-1) ?? 'errore sconosciuto').replace(/^ERROR:\s*/, '').slice(0, 300);
}

export function parseSearchOutput(stdout: string): RemoteSearchItem[] {
  const data = JSON.parse(stdout) as { entries?: YtInfo[] };
  return (data.entries ?? [])
    .filter(
      (e) => e && typeof e.id === 'string' && YOUTUBE_ID_PATTERN.test(e.id) && e.live_status !== 'is_live',
    )
    .slice(0, REMOTE_SEARCH_LIMIT)
    .map((e) => ({
      sourceId: e.id,
      title: e.title ?? e.id,
      channel: e.channel ?? e.uploader ?? '',
      durationSec: typeof e.duration === 'number' ? e.duration : null,
      thumbnailUrl: e.thumbnails?.at(-1)?.url ?? fallbackThumbnail(e.id),
    }));
}

export function createYtDlp(o: YtDlpOptions): YtDlp {
  const prefix = o.argsPrefix ?? [];
  const run = async (args: string[], opts: Parameters<typeof runProcess>[2]) => {
    try {
      return await runProcess(o.command, [...prefix, ...args], { nice: o.nice, ...opts });
    } catch (err) {
      if (err instanceof SpawnError) {
        throw new YtDlpError('not_installed', `yt-dlp non è eseguibile (${o.command}): è installato?`);
      }
      throw err;
    }
  };

  return {
    async search(query, opts = {}) {
      const res = await run(
        [
          '--flat-playlist',
          '-J',
          '--no-warnings',
          '--ignore-config',
          `ytsearch${REMOTE_SEARCH_LIMIT}:${query}`,
        ],
        { timeoutMs: opts.timeoutMs ?? o.searchTimeoutMs ?? 15_000 },
      );
      if (res.timedOut) throw new YtDlpError('timeout', 'La ricerca remota ha superato il tempo massimo');
      if (res.code !== 0) throw new YtDlpError('failed', lastErrorLine(res.stderr));
      try {
        return parseSearchOutput(res.stdout);
      } catch {
        throw new YtDlpError('failed', 'Risposta di yt-dlp non valida');
      }
    },

    async download(sourceId, outDir, opts = {}) {
      if (!YOUTUBE_ID_PATTERN.test(sourceId)) throw new YtDlpError('failed', 'Identificativo non valido');
      const args = [
        '--ignore-config',
        '--no-playlist',
        '--no-warnings',
        '-f',
        'bestaudio/best',
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '--write-thumbnail',
        '--convert-thumbnails',
        'jpg',
        '--write-info-json',
        '--match-filter',
        `duration <= ${MAX_TRACK_DURATION_SEC} & !is_live`,
        '--newline',
        '--progress-template',
        `download:${PROGRESS_MARK} %(progress._percent_str)s`,
        ...(o.ffmpegPath ? ['--ffmpeg-location', o.ffmpegPath] : []),
        '-o',
        path.join(outDir, '%(id)s.%(ext)s'),
        '--',
        youtubeUrl(sourceId),
      ];
      const res = await run(args, {
        timeoutMs: o.downloadTimeoutMs ?? 15 * 60_000,
        signal: opts.signal,
        onStdoutLine: (line) => {
          const m = PROGRESS_RE.exec(line);
          if (m && opts.onProgress) opts.onProgress(Math.min(1, Number(m[1]) / 100));
        },
      });
      if (res.aborted) throw new YtDlpError('aborted', 'Download interrotto');
      if (res.timedOut) throw new YtDlpError('timeout', 'Il download ha superato il tempo massimo');
      if (res.code !== 0) {
        if (UNAVAILABLE_RE.test(res.stderr))
          throw new YtDlpError('unavailable', 'Il video non è disponibile');
        throw new YtDlpError('failed', `yt-dlp: ${lastErrorLine(res.stderr)}`);
      }

      const audioFile = path.join(outDir, `${sourceId}.mp3`);
      const exists = (f: string) =>
        fs.access(f).then(
          () => true,
          () => false,
        );
      if (!(await exists(audioFile))) {
        if (/does not pass filter/i.test(res.stdout + res.stderr)) {
          throw new YtDlpError(
            'too_long',
            `Il video supera la durata massima di ${MAX_TRACK_DURATION_SEC / 60} minuti (o è una diretta)`,
          );
        }
        throw new YtDlpError('failed', 'yt-dlp non ha prodotto il file audio');
      }
      const info = JSON.parse(
        await fs.readFile(path.join(outDir, `${sourceId}.info.json`), 'utf8'),
      ) as YtInfo;
      const thumb = path.join(outDir, `${sourceId}.jpg`);
      return { audioFile, thumbnailFile: (await exists(thumb)) ? thumb : undefined, info };
    },
  };
}
