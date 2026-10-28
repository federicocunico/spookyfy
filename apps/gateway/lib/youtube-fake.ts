import { FAKE_COVER_JPEG_BASE64 } from './fake-assets.js';
import { type AudioSource, type VideoMeta, type YoutubeClient, YoutubeError } from './youtube.js';

/** MP3 silenzioso valido (frame MPEG-1 Layer III a zero), come nei test del server. */
export function silentMp3(seconds: number): Uint8Array {
  const frameLength = 417;
  const frames = Math.ceil((seconds * 44100) / 1152);
  const out = new Uint8Array(frameLength * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0xc0], i * frameLength);
  return out;
}

export const FAKE_AUDIO_SECONDS = 3;

/**
 * YouTube finto per sviluppo e test. Comportamenti per prefisso dell'id:
 * `blocked…` verifica anti-bot, `unavail…` non disponibile, `toolong…` troppo lungo.
 * L'audio è servito dal server locale indicato da `audioBaseUrl`.
 */
export class FakeYoutube implements YoutubeClient {
  /** Richieste di risoluzione dell'audio (per i test della cache). */
  resolveCount = 0;

  constructor(private readonly audioBaseUrl: string) {}

  private check(id: string) {
    if (id.startsWith('blocked')) {
      throw new YoutubeError('blocked', 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)');
    }
    if (id.startsWith('unavail')) throw new YoutubeError('unavailable', 'Il video non è disponibile');
    if (id.startsWith('toolong')) {
      throw new YoutubeError('too_long', 'Il video supera la durata massima di 20 minuti (o è una diretta)');
    }
  }

  async search(query: string) {
    if (query.includes('blocked')) {
      throw new YoutubeError('blocked', 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)');
    }
    return Array.from({ length: 10 }, (_, i) => ({
      sourceId: `fake${String(i).padStart(7, '0')}`,
      title: `${query} risultato ${i}`,
      artist: `Canale ${i}`,
      durationMs: (180 + i) * 1000,
      thumbnailUrl: `/api/cover/fake${String(i).padStart(7, '0')}`,
    }));
  }

  async meta(id: string): Promise<VideoMeta> {
    this.check(id);
    return {
      sourceId: id,
      title: `Canzone ${id}`,
      artist: 'Band Finta',
      album: null,
      durationMs: FAKE_AUDIO_SECONDS * 1000,
      sizeBytes: silentMp3(FAKE_AUDIO_SECONDS).byteLength,
      mimeType: 'audio/mpeg',
      thumbnailUrl: `/api/cover/${id}`,
    };
  }

  async audioSource(id: string): Promise<AudioSource> {
    this.check(id);
    this.resolveCount++;
    return {
      url: `${this.audioBaseUrl}/${id}`,
      sizeBytes: silentMp3(FAKE_AUDIO_SECONDS).byteLength,
      mimeType: 'audio/mpeg',
    };
  }

  thumbnailUrl() {
    return `data:image/jpeg;base64,${FAKE_COVER_JPEG_BASE64}`;
  }
}

/** Origine audio finta con supporto Range (per test e dev server). */
export function fakeAudioOrigin(req: Request): Response {
  const bytes = silentMp3(FAKE_AUDIO_SECONDS);
  const range = /^bytes=(\d+)-(\d+)?$/.exec(req.headers.get('range') ?? '');
  if (!range) return new Response(bytes as BodyInit, { headers: { 'content-type': 'audio/mpeg' } });
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
  return new Response(bytes.slice(start, end + 1) as BodyInit, {
    status: 206,
    headers: { 'content-type': 'audio/mpeg', 'content-range': `bytes ${start}-${end}/${bytes.length}` },
  });
}
