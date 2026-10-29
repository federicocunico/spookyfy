import fs from 'node:fs';
import path from 'node:path';
import {
  type EdgeSilence,
  SILENCE_MIN_MS,
  SILENCE_THRESHOLD_DB,
  type TrimPoints,
  trimPoints,
} from '@spookyfy/shared';
import { runProcess } from '../ingest/process.js';

/** Punti di auto-trim di un file audio; null se l'analisi non è possibile (es. ffmpeg assente). */
export type SilenceAnalyzer = (file: string, opts?: { signal?: AbortSignal }) => Promise<TrimPoints | null>;

/** Tolleranza all'inizio: ffmpeg riporta tempi arrotondati a frame e campioni. */
const START_S = 0.05;
/**
 * Tolleranza alla fine: durata nell'intestazione (stimata negli MP3 VBR), tempo decodificato
 * e fine dell'ultimo silenzio differiscono di qualche centesimo.
 */
const END_S = 0.5;
const CLOCK = /(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

function seconds(m: RegExpExecArray | RegExpMatchArray | null | undefined): number {
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/**
 * Silenzio ai bordi dall'output di `ffmpeg -af silencedetect` (stderr). Il filtro riporta
 * solo i silenzi lunghi almeno SILENCE_MIN_MS; quello finale può non avere `silence_end`
 * (versioni vecchie) o averlo pari alla fine del file.
 */
export function parseSilencedetect(stderr: string): EdgeSilence | null {
  const header = seconds(new RegExp(`Duration:\\s*${CLOCK.source}`).exec(stderr));
  const decoded = seconds([...stderr.matchAll(new RegExp(`time=${CLOCK.source}`, 'g'))].at(-1));
  const total = Math.max(header, decoded);
  if (total === 0) return null;
  const spans: { start: number; end: number | null }[] = [];
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === 'start') spans.push({ start: t, end: null });
    else {
      const last = spans.at(-1);
      if (last && last.end === null) last.end = t;
    }
  }
  const first = spans[0];
  const last = spans.at(-1);
  const duration = Math.max(total, last?.end ?? 0);
  const leading = first && first.start <= START_S ? (first.end ?? duration) : 0;
  const trailing =
    last && (last.end === null || last.end >= duration - END_S) && last.start > leading
      ? duration - last.start
      : 0;
  return { leadingMs: leading * 1000, trailingMs: trailing * 1000, durationMs: duration * 1000 };
}

/** FFMPEG_PATH può indicare l'eseguibile o la cartella che lo contiene (come per yt-dlp). */
export function ffmpegBinary(location: string | undefined): string {
  if (!location) return 'ffmpeg';
  try {
    if (fs.statSync(location).isDirectory())
      return path.join(location, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  } catch {}
  return location;
}

export function createSilenceAnalyzer(o: { ffmpegPath?: string; nice?: number }): SilenceAnalyzer {
  const command = ffmpegBinary(o.ffmpegPath);
  return async (file, opts = {}) => {
    try {
      const res = await runProcess(
        command,
        [
          '-hide_banner',
          '-i',
          file,
          '-af',
          `silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${SILENCE_MIN_MS / 1000}`,
          '-f',
          'null',
          '-',
        ],
        { timeoutMs: 5 * 60_000, signal: opts.signal, nice: o.nice },
      );
      if (res.code !== 0) return null;
      const silence = parseSilencedetect(res.stderr);
      return silence ? trimPoints(silence) : null;
    } catch {
      return null;
    }
  };
}
