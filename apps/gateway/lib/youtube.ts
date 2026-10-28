import { MAX_TRACK_DURATION_SEC, type RemoteSearchResultDto } from '@spookyfy/shared';

export type YoutubeErrorKind = 'blocked' | 'unavailable' | 'too_long' | 'timeout' | 'failed';

export class YoutubeError extends Error {
  constructor(
    public readonly kind: YoutubeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'YoutubeError';
  }
}

export interface VideoMeta {
  sourceId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  /** Dimensione del flusso audio scelto (byte), se nota. */
  sizeBytes: number | null;
  mimeType: string;
  thumbnailUrl: string;
}

/** Flusso audio risolto: URL utilizzabile solo da questa istanza (legato al suo IP). */
export interface AudioSource {
  url: string;
  sizeBytes: number;
  mimeType: string;
}

/** Accesso a YouTube dal gateway: reale (youtubei.js) o finto (sviluppo e test). */
export interface YoutubeClient {
  search(query: string): Promise<Omit<RemoteSearchResultDto, 'trackId'>[]>;
  meta(sourceId: string): Promise<VideoMeta>;
  audioSource(sourceId: string): Promise<AudioSource>;
  thumbnailUrl(sourceId: string): string;
}

export const fallbackThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Stato di riproducibilità restituito da YouTube (playability_status). */
export interface Playability {
  status?: string;
  reason?: string;
}

const BOT_RE = /bot|sign in to confirm|confirm you.?re not|unusual traffic/i;

/** Traduce lo stato di riproducibilità di YouTube negli errori del gateway. */
export function playabilityError(p: Playability | undefined): YoutubeError | null {
  const status = p?.status ?? 'OK';
  if (status === 'OK') return null;
  const reason = p?.reason ?? '';
  if (status === 'LOGIN_REQUIRED' && BOT_RE.test(reason)) {
    return new YoutubeError('blocked', 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)');
  }
  if (BOT_RE.test(reason)) {
    return new YoutubeError('blocked', 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)');
  }
  return new YoutubeError('unavailable', 'Il video non è disponibile');
}

export function assertDuration(durationSec: number | undefined, isLive: boolean | undefined): void {
  if (isLive || (durationSec !== undefined && durationSec > MAX_TRACK_DURATION_SEC)) {
    throw new YoutubeError(
      'too_long',
      `Il video supera la durata massima di ${MAX_TRACK_DURATION_SEC / 60} minuti (o è una diretta)`,
    );
  }
}

/** Interrompe un'operazione verso YouTube oltre il tempo massimo. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new YoutubeError('timeout', 'YouTube non ha risposto in tempo')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
