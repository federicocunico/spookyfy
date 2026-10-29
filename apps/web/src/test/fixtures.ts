import type { MeDto, TrackDto } from '@spookyfy/shared';
import { trackAudioUrl, trackCoverUrl } from '@spookyfy/shared';
import { vi } from 'vitest';
import type { Api } from '../lib/api';
import { openSpookyfyDb } from '../lib/offline/db';
import { MediaSessionBridge } from '../lib/player/media-session';
import { RealtimeClient } from '../lib/realtime/ws';
import { type Services, createServices, setServices } from '../lib/services.svelte';

let n = 0;

export function makeTrack(o: Partial<TrackDto> = {}): TrackDto {
  const id = o.id ?? `t${++n}`;
  return {
    id,
    sourceId: `src${String(n).padStart(8, '0')}`,
    title: `Brano ${id}`,
    artist: 'Artista',
    album: null,
    albumId: null,
    genres: [],
    durationMs: 180_000,
    sizeBytes: 1000,
    dominantColor: '#c02020',
    addedAt: 1,
    audioUrl: trackAudioUrl(id),
    coverUrl: trackCoverUrl(id, 512),
    coverThumbUrl: trackCoverUrl(id, 128),
    isFavorite: false,
    playCount: 0,
    lastPlayedAt: null,
    ...o,
  };
}

export const ME: MeDto = { id: 'u1', username: 'fede', createdAt: 1 };

/** API finta: ogni metodo è un vi.fn() con una risposta vuota predefinita. */
export function fakeApi() {
  return {
    auth: {
      me: vi.fn().mockResolvedValue(ME),
      login: vi.fn().mockResolvedValue(ME),
      register: vi.fn().mockResolvedValue(ME),
      logout: vi.fn().mockResolvedValue(undefined),
    },
    tracks: {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    favorites: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    plays: {
      submit: vi.fn().mockResolvedValue({ recorded: 1, ignored: 0 }),
      recent: vi.fn().mockResolvedValue({ items: [] }),
    },
    playlists: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      get: vi.fn(),
      create: vi.fn(),
      rename: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      addItem: vi.fn(),
      removeItem: vi.fn().mockResolvedValue(undefined),
      moveItem: vi.fn(),
    },
    albums: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      addTracks: vi.fn(),
      removeTrack: vi.fn(),
      moveTrack: vi.fn(),
      setCover: vi.fn(),
      removeCover: vi.fn(),
      updateGenres: vi.fn(),
      applyCandidate: vi.fn(),
    },
    genres: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      get: vi.fn(),
      setForTrack: vi.fn(),
    },
    lookup: {
      search: vi.fn().mockResolvedValue({ items: [] }),
      imageUrl: (url: string) => `/api/lookup/image?url=${encodeURIComponent(url)}`,
    },
    settings: {
      get: vi.fn().mockResolvedValue({ coverLookup: true, coverLookupLocked: false }),
      update: vi.fn(),
    },
    remote: {
      search: vi.fn().mockResolvedValue({ items: [] }),
      ingest: vi.fn(),
      jobs: vi.fn().mockResolvedValue({ items: [] }),
      retry: vi.fn(),
    },
  } satisfies Api;
}

export type FakeApi = ReturnType<typeof fakeApi>;

export interface FakeMediaSession {
  metadata: MediaMetadataInit | null;
  playbackState: MediaSessionPlaybackState;
  handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>;
  positions: MediaPositionState[];
}

export function fakeMediaSession() {
  const state: FakeMediaSession = { metadata: null, playbackState: 'none', handlers: {}, positions: [] };
  const session = {
    get metadata() {
      return state.metadata as unknown as MediaMetadata;
    },
    set metadata(m: MediaMetadata | null) {
      state.metadata = m as unknown as MediaMetadataInit;
    },
    get playbackState() {
      return state.playbackState;
    },
    set playbackState(s: MediaSessionPlaybackState) {
      state.playbackState = s;
    },
    setActionHandler(a: MediaSessionAction, h: MediaSessionActionHandler | null) {
      state.handlers[a] = h;
    },
    setPositionState(p: MediaPositionState) {
      state.positions.push(p);
    },
  } as unknown as MediaSession;
  // MediaMetadata finto: conserva i campi passati.
  const Metadata = class {
    constructor(init: MediaMetadataInit) {
      Object.assign(this, init);
    }
  } as unknown as typeof MediaMetadata;
  return { state, bridge: new MediaSessionBridge(session, Metadata) };
}

export interface TestServices extends Services {
  fake: FakeApi;
  media: FakeMediaSession;
}

/** Servizi isolati per un test: API finta, IndexedDB nuovo, niente WebSocket reale. */
export async function setupServices(): Promise<TestServices> {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  const fake = fakeApi();
  const db = await openSpookyfyDb(`spk-test-${Date.now()}-${++n}`);
  const media = fakeMediaSession();
  const s = createServices({
    api: fake,
    db: async () => db,
    mediaSession: media.bridge,
    realtime: () =>
      new RealtimeClient({ onEvent: () => {}, WebSocketImpl: class {} as unknown as typeof WebSocket }),
  });
  s.session.user = ME;
  s.session.status = 'authenticated';
  setServices(s);
  return Object.assign(s, { fake, media: media.state });
}

/** Risposta audio completa come la restituisce il server. */
export function audioResponse(bytes: number): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes) },
  });
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
