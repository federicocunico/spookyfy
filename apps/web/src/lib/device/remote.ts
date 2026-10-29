import type {
  ApiErrorBody,
  IngestResponse,
  JobDto,
  LookupCandidateDto,
  RemoteSearchResultDto,
  TrackDto,
} from '@spookyfy/shared';
import { ApiError, request } from '../api';

/** Metadati di un video restituiti dal gateway (`/api/meta/:id`). */
export interface GatewayMeta {
  sourceId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  sizeBytes: number | null;
  mimeType: string;
  thumbnailUrl: string;
}

async function errorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    res.status,
    body?.error.code ?? `HTTP_${res.status}`,
    body?.error.message ?? 'Errore del server',
  );
}

/** Scarica una risorsa binaria con avanzamento; fallisce se incompleta. */
export async function fetchBlob(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Connessione non disponibile');
  }
  if (!res.ok || !res.body) throw await errorFrom(res);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) onProgress?.(Math.min(1, received / total));
  }
  if (total && received !== total) throw new Error(`Download incompleto (${received}/${total} byte)`);
  return new Blob(chunks as BlobPart[], {
    type: res.headers.get('content-type') ?? 'application/octet-stream',
  });
}

/** Funzioni del gateway su Vercel usate dalla modalità client (stessa origine, cookie di sessione). */
export class GatewayClient {
  constructor(private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  search(q: string, signal?: AbortSignal) {
    return request<{ items: RemoteSearchResultDto[] }>(
      'GET',
      `/api/search?q=${encodeURIComponent(q)}`,
      undefined,
      {
        signal,
      },
    );
  }

  meta(sourceId: string) {
    return request<GatewayMeta>('GET', `/api/meta/${encodeURIComponent(sourceId)}`);
  }

  /** Candidati per un album dai database musicali (ricerca online del gateway). */
  lookupAlbums(query: { album?: string; artist?: string; title?: string }, signal?: AbortSignal) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    return request<{ items: LookupCandidateDto[] }>('GET', `/api/lookup/albums?${p}`, undefined, { signal });
  }

  /** Immagine di un candidato, scaricata dalla stessa origine tramite il gateway. */
  lookupImage(url: string, signal?: AbortSignal): Promise<Blob> {
    return fetchBlob(this.fetchImpl, `/api/lookup/image?url=${encodeURIComponent(url)}`, {
      credentials: 'same-origin',
      signal,
    });
  }

  audioUrl(sourceId: string) {
    return `/api/audio/${encodeURIComponent(sourceId)}`;
  }

  coverUrl(sourceId: string) {
    return `/api/cover/${encodeURIComponent(sourceId)}`;
  }

  audio(sourceId: string, onProgress: (f: number) => void, signal?: AbortSignal) {
    return fetchBlob(
      this.fetchImpl,
      this.audioUrl(sourceId),
      { credentials: 'same-origin', signal },
      onProgress,
    );
  }

  async cover(sourceId: string, signal?: AbortSignal): Promise<Blob | null> {
    try {
      return await fetchBlob(this.fetchImpl, this.coverUrl(sourceId), { credentials: 'same-origin', signal });
    } catch {
      return null;
    }
  }
}

export interface BridgeSettings {
  url: string;
  token: string;
}

/**
 * Server on-premise usato come ponte: token di accesso nell'header, mai cookie.
 * Le richieste partono da un'altra origine (CORS consentito dal server).
 */
export class BridgeClient {
  private readonly base: string;

  constructor(
    private readonly settings: BridgeSettings,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {
    this.base = new URL(settings.url).origin;
  }

  private init(extra: RequestInit = {}): RequestInit {
    return {
      ...extra,
      credentials: 'omit',
      headers: {
        authorization: `Bearer ${this.settings.token}`,
        ...(extra.headers as Record<string, string>),
      },
    };
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, this.init(init));
    } catch {
      throw new ApiError(0, 'NETWORK', 'Il server di casa non è raggiungibile');
    }
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as T;
  }

  /** Verifica raggiungibilità, modalità e validità del token. */
  async check(): Promise<void> {
    let health: Response;
    try {
      health = await this.fetchImpl(`${this.base}/api/health`, { credentials: 'omit' });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Il server di casa non è raggiungibile');
    }
    const body = (await health.json().catch(() => null)) as { mode?: string; features?: string[] } | null;
    if (body?.mode !== 'onpremise')
      throw new ApiError(400, 'NOT_ONPREMISE', 'L’indirizzo non è un server Spookyfy on-premise');
    if (!body.features?.includes('bridge-tokens')) {
      throw new ApiError(
        400,
        'BRIDGE_DISABLED',
        'Il ponte non è abilitato su quel server (BRIDGE_ALLOWED_ORIGINS)',
      );
    }
    await this.jobs();
  }

  search(q: string) {
    return this.json<{ items: RemoteSearchResultDto[] }>(`/api/search/remote?q=${encodeURIComponent(q)}`);
  }

  ingest(sourceId: string) {
    return this.json<IngestResponse>('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
      headers: { 'content-type': 'application/json' },
    });
  }

  jobs() {
    return this.json<{ items: JobDto[] }>('/api/jobs');
  }

  track(id: string) {
    return this.json<TrackDto>(`/api/tracks/${encodeURIComponent(id)}`);
  }

  audio(track: TrackDto, onProgress: (f: number) => void, signal?: AbortSignal) {
    return fetchBlob(this.fetchImpl, `${this.base}${track.audioUrl}`, this.init({ signal }), onProgress);
  }

  cover(track: TrackDto, size: 512 | 128, signal?: AbortSignal) {
    const url = size === 512 ? track.coverUrl : track.coverThumbUrl;
    return fetchBlob(this.fetchImpl, `${this.base}${url}`, this.init({ signal }));
  }
}
