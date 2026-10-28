import { cleanMetadata } from '@spookyfy/shared';
import { Innertube } from 'youtubei.js';
import {
  type AudioSource,
  type VideoMeta,
  type YoutubeClient,
  YoutubeError,
  assertDuration,
  fallbackThumbnail,
  playabilityError,
  withTimeout,
} from './youtube.js';

const TIMEOUT_MS = 15_000;
/** Gli URL dei flussi scadono dopo circa 6 ore: li si riusa al massimo per 4. */
const URL_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Accesso a YouTube con youtubei.js, usando il comportamento predefinito della
 * libreria. Nessun tentativo di aggirare i controlli anti-bot: se YouTube
 * rifiuta, l'errore viene riportato all'app, che propone le alternative.
 */
export class InnertubeYoutube implements YoutubeClient {
  private client: Promise<Innertube> | null = null;
  /** Cache in memoria dell'istanza (non persistente) degli URL risolti. */
  private readonly urls = new Map<string, { source: AudioSource; at: number }>();

  private yt(): Promise<Innertube> {
    this.client ??= Innertube.create({ generate_session_locally: true, retrieve_player: true }).catch(
      (err) => {
        this.client = null;
        throw err;
      },
    );
    return this.client;
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await withTimeout(fn(), TIMEOUT_MS);
    } catch (err) {
      if (err instanceof YoutubeError) throw err;
      const msg = (err as Error)?.message ?? '';
      if (/bot|sign in to confirm/i.test(msg)) {
        throw new YoutubeError('blocked', 'YouTube ha bloccato la richiesta del gateway (verifica anti-bot)');
      }
      throw new YoutubeError('failed', 'YouTube non ha risposto correttamente');
    }
  }

  search(query: string) {
    return this.run(async () => {
      const yt = await this.yt();
      const res = await yt.search(query, { type: 'video' });
      return res.videos
        .filter((v) => v.type === 'Video')
        .map(
          (v) =>
            v as unknown as {
              video_id: string;
              title: { toString(): string };
              author?: { name?: string };
              duration?: { seconds?: number };
              is_live?: boolean;
              thumbnails?: { url: string }[];
            },
        )
        .filter((v) => !v.is_live && /^[A-Za-z0-9_-]{11}$/.test(v.video_id))
        .slice(0, 10)
        .map((v) => ({
          sourceId: v.video_id,
          title: v.title.toString(),
          artist: v.author?.name ?? '',
          durationMs: typeof v.duration?.seconds === 'number' ? v.duration.seconds * 1000 : null,
          thumbnailUrl: v.thumbnails?.[0]?.url ?? fallbackThumbnail(v.video_id),
        }));
    });
  }

  private async info(sourceId: string) {
    const yt = await this.yt();
    const info = await yt.getBasicInfo(sourceId);
    const blocked = playabilityError(info.playability_status as { status?: string; reason?: string });
    if (blocked) throw blocked;
    assertDuration(info.basic_info.duration, info.basic_info.is_live);
    return { yt, info };
  }

  meta(sourceId: string): Promise<VideoMeta> {
    return this.run(async () => {
      const { info } = await this.info(sourceId);
      const b = info.basic_info;
      const clean = cleanMetadata({
        id: sourceId,
        title: b.title,
        uploader: b.author,
        channel: b.channel?.name,
      });
      let format: { content_length?: number; mime_type: string } | undefined;
      try {
        format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
      } catch {}
      return {
        sourceId,
        ...clean,
        durationMs: (b.duration ?? 0) * 1000,
        sizeBytes: format?.content_length ?? null,
        mimeType: format?.mime_type.split(';')[0] ?? 'audio/mp4',
        thumbnailUrl: fallbackThumbnail(sourceId),
      };
    });
  }

  audioSource(sourceId: string): Promise<AudioSource> {
    const cached = this.urls.get(sourceId);
    if (cached && Date.now() - cached.at < URL_TTL_MS) return Promise.resolve(cached.source);
    return this.run(async () => {
      const { yt, info } = await this.info(sourceId);
      let url: string;
      let format: ReturnType<typeof info.chooseFormat>;
      try {
        format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
        url = await format.decipher(yt.session.player);
      } catch {
        throw new YoutubeError(
          'failed',
          'YouTube non ha fornito un flusso audio scaricabile per questo video',
        );
      }
      if (!format.content_length) {
        throw new YoutubeError('failed', 'Dimensione del flusso audio sconosciuta');
      }
      const source = {
        url,
        sizeBytes: format.content_length,
        mimeType: format.mime_type.split(';')[0] ?? 'audio/mp4',
      };
      this.urls.set(sourceId, { source, at: Date.now() });
      return source;
    });
  }

  thumbnailUrl(sourceId: string) {
    return fallbackThumbnail(sourceId);
  }
}
