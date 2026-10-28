import path from 'node:path';
import { type YtDlpOptions, createYtDlp } from '../../src/ingest/ytdlp.js';

export const FAKE_YTDLP_SCRIPT = path.resolve(import.meta.dirname, 'fake-ytdlp.mjs');

/** yt-dlp finto eseguito con lo stesso Node dei test. */
export function fakeYtDlp(o: Partial<YtDlpOptions> = {}) {
  return createYtDlp({ command: process.execPath, argsPrefix: [FAKE_YTDLP_SCRIPT], nice: 0, ...o });
}
