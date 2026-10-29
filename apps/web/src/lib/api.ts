import type {
  AlbumDto,
  AlbumSort,
  AlbumSummaryDto,
  ApiErrorBody,
  ApplyCandidateBody,
  CatalogSettingsDto,
  CreateAlbumBody,
  FavoriteDto,
  GenreDetailDto,
  GenreDto,
  IngestResponse,
  JobDto,
  ListTracksQuery,
  LookupCandidateDto,
  LookupQuery,
  MeDto,
  Page,
  PlayEvent,
  PlaylistDto,
  PlaylistItemDto,
  PlaylistSummaryDto,
  RegisterBody,
  RemoteSearchResultDto,
  SubmitPlaysResult,
  TrackDto,
  UpdateAlbumBody,
  UpdateTrackBody,
} from '@spookyfy/shared';

/** Errore dell'API; `status` 0 indica che il server non è raggiungibile. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface ApiHooks {
  onUnauthenticated(): void;
  onReachable(): void;
  onUnreachable(): void;
}

const hooks: ApiHooks = { onUnauthenticated() {}, onReachable() {}, onUnreachable() {} };

export function setApiHooks(h: Partial<ApiHooks>): void {
  Object.assign(hooks, h);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    // Un Blob (es. la copertina di un album) viaggia così com'è, con il suo tipo.
    const raw = body instanceof Blob;
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? undefined
          : { 'content-type': raw ? body.type || 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    hooks.onUnreachable();
    throw new ApiError(0, 'NETWORK', 'Connessione al server non disponibile');
  }
  hooks.onReachable();
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    const e = new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      // Risposta non JSON (es. pagina di errore della piattaforma): il codice HTTP aiuta a capire.
      err?.message ?? `Errore del server (HTTP ${res.status})`,
      err?.fields,
    );
    if (res.status === 401 && e.code === 'UNAUTHENTICATED') hooks.onUnauthenticated();
    throw e;
  }
  return data as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  auth: {
    me: () => request<MeDto>('GET', '/api/auth/me'),
    login: (username: string, password: string) =>
      request<MeDto>('POST', '/api/auth/login', { username, password }),
    register: (body: RegisterBody) => request<MeDto>('POST', '/api/auth/register', body),
    logout: () => request<void>('POST', '/api/auth/logout', {}),
  },
  tracks: {
    list: (query: Partial<ListTracksQuery> = {}, signal?: AbortSignal) =>
      request<Page<TrackDto>>('GET', `/api/tracks${q(query)}`, undefined, { signal }),
    get: (id: string) => request<TrackDto>('GET', `/api/tracks/${encodeURIComponent(id)}`),
    update: (id: string, body: UpdateTrackBody) =>
      request<TrackDto>('PATCH', `/api/tracks/${encodeURIComponent(id)}`, body),
    delete: (id: string) => request<void>('DELETE', `/api/tracks/${encodeURIComponent(id)}`),
  },
  favorites: {
    list: () => request<{ items: FavoriteDto[] }>('GET', '/api/me/favorites'),
    add: (trackId: string) => request<void>('PUT', `/api/me/favorites/${encodeURIComponent(trackId)}`),
    remove: (trackId: string) => request<void>('DELETE', `/api/me/favorites/${encodeURIComponent(trackId)}`),
  },
  plays: {
    submit: (plays: PlayEvent[]) => request<SubmitPlaysResult>('POST', '/api/me/plays', { plays }),
    recent: (limit = 12) => request<{ items: TrackDto[] }>('GET', `/api/me/recent-plays${q({ limit })}`),
  },
  playlists: {
    list: () => request<{ items: PlaylistSummaryDto[] }>('GET', '/api/playlists'),
    get: (id: string) => request<PlaylistDto>('GET', `/api/playlists/${encodeURIComponent(id)}`),
    create: (name: string) => request<PlaylistDto>('POST', '/api/playlists', { name }),
    rename: (id: string, name: string) =>
      request<PlaylistSummaryDto>('PATCH', `/api/playlists/${encodeURIComponent(id)}`, { name }),
    delete: (id: string) => request<void>('DELETE', `/api/playlists/${encodeURIComponent(id)}`),
    addItem: (id: string, trackId: string) =>
      request<PlaylistItemDto>('POST', `/api/playlists/${encodeURIComponent(id)}/items`, { trackId }),
    removeItem: (id: string, itemId: string) =>
      request<void>('DELETE', `/api/playlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`),
    moveItem: (id: string, itemId: string, toIndex: number) =>
      request<PlaylistDto>(
        'POST',
        `/api/playlists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/move`,
        { toIndex },
      ),
  },
  albums: {
    list: (sort?: AlbumSort, query?: string) =>
      request<{ items: AlbumSummaryDto[] }>('GET', `/api/albums${q({ sort, q: query })}`),
    get: (id: string) => request<AlbumDto>('GET', `/api/albums/${encodeURIComponent(id)}`),
    create: (body: CreateAlbumBody) => request<AlbumDto>('POST', '/api/albums', body),
    update: (id: string, body: UpdateAlbumBody) =>
      request<AlbumDto>('PATCH', `/api/albums/${encodeURIComponent(id)}`, body),
    delete: (id: string) => request<void>('DELETE', `/api/albums/${encodeURIComponent(id)}`),
    addTracks: (id: string, trackIds: string[], toIndex?: number) =>
      request<AlbumDto>('POST', `/api/albums/${encodeURIComponent(id)}/tracks`, { trackIds, toIndex }),
    /** undefined se l'album, creato in automatico, è sparito perché rimasto vuoto. */
    removeTrack: (id: string, trackId: string) =>
      request<AlbumDto | undefined>(
        'DELETE',
        `/api/albums/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`,
      ),
    moveTrack: (id: string, trackId: string, toIndex: number) =>
      request<AlbumDto>(
        'POST',
        `/api/albums/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}/move`,
        { toIndex },
      ),
    setCover: (id: string, image: Blob) =>
      request<AlbumDto>('PUT', `/api/albums/${encodeURIComponent(id)}/cover`, image),
    removeCover: (id: string) => request<AlbumDto>('DELETE', `/api/albums/${encodeURIComponent(id)}/cover`),
    updateGenres: (id: string, change: { add?: string[]; remove?: string[] }) =>
      request<AlbumDto>('POST', `/api/albums/${encodeURIComponent(id)}/genres`, change),
    applyCandidate: (id: string, body: ApplyCandidateBody) =>
      request<AlbumDto>('POST', `/api/albums/${encodeURIComponent(id)}/apply-candidate`, body),
  },
  genres: {
    list: () => request<{ items: GenreDto[] }>('GET', '/api/genres'),
    get: (name: string) => request<GenreDetailDto>('GET', `/api/genres/${encodeURIComponent(name)}`),
    setForTrack: (trackId: string, genres: string[]) =>
      request<TrackDto>('PUT', `/api/tracks/${encodeURIComponent(trackId)}/genres`, { genres }),
  },
  lookup: {
    search: (query: LookupQuery, signal?: AbortSignal) =>
      request<{ items: LookupCandidateDto[] }>('GET', `/api/lookup/albums${q(query)}`, undefined, { signal }),
    /** Immagine di un candidato dalla stessa origine dell'app (server on-premise o gateway). */
    imageUrl: (url: string) => `/api/lookup/image${q({ url })}`,
  },
  settings: {
    get: () => request<CatalogSettingsDto>('GET', '/api/settings'),
    update: (body: { coverLookup: boolean }) => request<CatalogSettingsDto>('PATCH', '/api/settings', body),
  },
  remote: {
    search: (query: string, signal?: AbortSignal) =>
      request<{ items: RemoteSearchResultDto[] }>('GET', `/api/search/remote${q({ q: query })}`, undefined, {
        signal,
      }),
    ingest: (sourceId: string) => request<IngestResponse>('POST', '/api/ingest', { sourceId }),
    jobs: () => request<{ items: JobDto[] }>('GET', '/api/jobs'),
    retry: (jobId: string) => request<JobDto>('POST', `/api/jobs/${encodeURIComponent(jobId)}/retry`, {}),
  },
};

export type Api = typeof api;
