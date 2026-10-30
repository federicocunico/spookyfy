import type { SpotifyStatusDto, SpotifyTrackDto } from '@spookyfy/shared';
import { makeTrack } from '../../test/fixtures';
import { setApiHooks } from '../api';
import { MediaSessionBridge } from '../player/media-session';
import type { Player } from '../player/player.svelte';
import { SpotifyModule } from './module.svelte';
import { loadSdk } from './sdk';
import type { SdkNamespace, SdkState } from './sdk';
import { SpotifyError, SpotifyTransport } from './transport';

const STATUS: SpotifyStatusDto = {
  mode: 'fake',
  linkState: 'linked',
  accountId: 'account',
  displayName: 'Test',
  entitlement: 'unknown',
  scopes: [],
  generation: 1,
  capabilities: {
    canBrowse: true,
    canEditLibrary: true,
    canEditPlaylist: true,
    canStream: true,
    canHybridPlayback: true,
    canDownload: false,
    canEditTags: false,
  },
};
const TRACK: SpotifyTrackDto = {
  kind: 'track',
  id: 'a'.repeat(22),
  uri: `spotify:track:${'a'.repeat(22)}`,
  name: 'Test Spotify',
  artists: ['Artist'],
  album: 'Album',
  durationMs: 180000,
  available: true,
  externalUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
  imageUrl: null,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup() {
  const local = { pause: vi.fn(), isPaused: vi.fn(() => true), playTracks: vi.fn() };
  const request = vi.fn().mockResolvedValue(undefined);
  const api = { request, reset: vi.fn() } as unknown as SpotifyTransport;
  const module = new SpotifyModule(
    api,
    local as unknown as Player,
    new MediaSessionBridge(undefined, undefined),
    () => true,
  );
  module.status = STATUS;
  return { module, local, request };
}

describe('provider isolation', () => {
  test('a revoked local browser session clears only Spotify playback and credentials', async () => {
    const { module, request, local } = setup();
    module.active = true;
    module.current = TRACK;
    request.mockRejectedValue(new SpotifyError('SESSION_REQUIRED', 'Accedi a Spookyfy'));
    await module.refresh();
    expect(module.active).toBe(false);
    expect(module.current).toBeNull();
    expect(module.status).toBeNull();
    expect(local.pause).not.toHaveBeenCalled();
    module.clear();
  });
  test('machine-readable provider errors have a human message without losing the error code', async () => {
    const api = new SpotifyTransport(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'SPOTIFY_SCOPE_REQUIRED', message: 'SPOTIFY_SCOPE_REQUIRED' },
            }),
            { status: 403 },
          ),
      ),
    );
    await expect(api.request('saved')).rejects.toMatchObject({
      code: 'SPOTIFY_SCOPE_REQUIRED',
      message: 'Autorizza questa funzione Spotify dalle impostazioni.',
    });
  });
  test('default native fetch is bound to the global receiver', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    try {
      await expect(new SpotifyTransport().request('playback')).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
  test.each([401, 403, 429, 503])(
    'Spotify %i does not change app authentication/connectivity',
    async (status) => {
      const hooks = { onUnauthenticated: vi.fn(), onReachable: vi.fn(), onUnreachable: vi.fn() };
      setApiHooks(hooks);
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 'SPOTIFY_REAUTH_REQUIRED', message: 'Relink' }), { status }),
        );
      const api = new SpotifyTransport(fetcher);
      await expect(api.request('search')).rejects.toMatchObject({ code: 'SPOTIFY_REAUTH_REQUIRED' });
      for (const hook of Object.values(hooks)) expect(hook).not.toHaveBeenCalled();
    },
  );
  test('uses cookie-only/no-store, accepts 204, cancels all requests on logout', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new SpotifyTransport(fetcher);
    await expect(api.request('playback', 'POST', { action: 'pause' })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/spotify/playback',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', method: 'POST' }),
    );
    fetcher.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    );
    const pending = api.request('library');
    api.reset();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  });
  test('network timeout is bounded and confined to Spotify', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError'))),
        ),
    );
    const result = new SpotifyTransport(fetcher).request('library');
    const rejected = expect(result).rejects.toHaveProperty('code', 'SPOTIFY_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(12000);
    await rejected;
    vi.useRealTimers();
  });
});

describe('handoff', () => {
  test('unlink still revokes access when the external player cannot confirm pause', async () => {
    const { module, request } = setup();
    module.active = true;
    module.deviceId = 'external';
    request.mockImplementation((action, method) => {
      if (action === 'playback') return Promise.reject(new Error('Device unreachable'));
      if (action === 'status') return Promise.resolve({ ...STATUS, linkState: 'unlinked', accountId: null });
      return Promise.resolve(undefined);
    });
    await module.unlink();
    expect(request).toHaveBeenCalledWith('link', 'DELETE');
    expect(module.active).toBe(false);
    expect(module.status?.linkState).toBe('unlinked');
    expect(module.error).toContain('dispositivo esterno');
  });
  test('disabled Spotify preserves a synchronous local start', () => {
    const { module, request } = setup();
    module.status = null;
    const start = vi.fn();
    if (module.beforeLocalPlay(start)) start();
    expect(start).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
  test('local -> Spotify pauses synchronously; 204 is not a playing signal', async () => {
    const { module, local, request } = setup();
    module.deviceId = 'external';
    request.mockResolvedValue(null);
    module.play(TRACK);
    expect(local.pause).toHaveBeenCalledTimes(1);
    expect(module.phase).toBe('preparing');
    await flush();
    expect(module.phase).not.toBe('playing');
    expect(request).toHaveBeenCalledWith(
      'playback',
      'POST',
      expect.objectContaining({ action: 'play', uri: TRACK.uri }),
    );
  });
  test('failed local pause forbids any remote start', async () => {
    const { module, local, request } = setup();
    module.deviceId = 'external';
    local.isPaused.mockReturnValue(false);
    module.play(TRACK);
    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(module.phase).toBe('unavailable');
  });
  test('remote pause must be positively observed before local playback', async () => {
    const { module, request } = setup();
    module.active = true;
    module.deviceId = 'external';
    let release: ((value: unknown) => void) | undefined;
    request.mockImplementation((_action, method) =>
      method === 'POST'
        ? Promise.resolve()
        : new Promise((resolve) => {
            release = resolve;
          }),
    );
    const start = vi.fn();
    expect(module.beforeLocalPlay(start)).toBe(false);
    await flush();
    expect(start).not.toHaveBeenCalled();
    release?.({ playing: false });
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(module.active).toBe(false);
  });
  test.each([null, { playing: true }])('unconfirmed remote pause %j prevents double audio', async (state) => {
    const { module, request } = setup();
    module.active = true;
    request.mockResolvedValue(state);
    const start = vi.fn();
    module.beforeLocalPlay(start);
    await flush();
    expect(start).not.toHaveBeenCalled();
    expect(module.active).toBe(true);
    expect(module.phase).toBe('unavailable');
  });
  test('superseded handoff/logout cannot start an old local request', async () => {
    const { module, request } = setup();
    module.active = true;
    let release: ((value: unknown) => void) | undefined;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const start = vi.fn();
    module.beforeLocalPlay(start);
    await flush();
    module.clear();
    release?.({ playing: false });
    await flush();
    expect(start).not.toHaveBeenCalled();
    expect(module.current).toBeNull();
  });
  test('inflight Spotify start settles before the pause that gates local audio', async () => {
    const { module, request } = setup();
    module.deviceId = 'external';
    let release: ((value: unknown) => void) | undefined;
    request.mockImplementation((_action, method, body) =>
      body?.action === 'play'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(method !== 'POST' ? { playing: false } : undefined),
    );
    module.play(TRACK);
    await flush();
    const start = vi.fn();
    module.beforeLocalPlay(start);
    await flush();
    expect(request).not.toHaveBeenCalledWith(
      'playback',
      'POST',
      expect.objectContaining({ action: 'pause' }),
    );
    release?.(undefined);
    await flush();
    expect(request).toHaveBeenCalledWith('playback', 'POST', expect.objectContaining({ action: 'pause' }));
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('all-unavailable repeated occurrence queue is bounded and preserves duplicate identity', () => {
    const { module, local } = setup();
    module.repeat = 'all';
    module.playOccurrences([
      { occurrenceId: 'one', ref: { provider: 'spotify', uri: TRACK.uri } },
      { occurrenceId: 'two', ref: { provider: 'spotify', uri: TRACK.uri } },
    ]);
    expect(module.occurrences).toHaveLength(2);
    expect(module.phase).toBe('paused');
    expect(local.playTracks).not.toHaveBeenCalled();
  });
  test('unknown Premium remains unknown and no SDK loads at status/constructor time', () => {
    const { module } = setup();
    expect(module.status?.entitlement).toBe('unknown');
    expect(document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')).toBeNull();
  });
});

test('SDK loader is bounded, removes failed script, and can be retried', async () => {
  vi.useFakeTimers();
  const promise = loadSdk(window, 100);
  expect(document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')).not.toBeNull();
  const rejection = expect(promise).rejects.toThrow('browser');
  await vi.advanceTimersByTimeAsync(100);
  await rejection;
  expect(document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')).toBeNull();
  vi.useRealTimers();
});

describe('official SDK lifecycle and media signals', () => {
  const sdkWindow = window as Window & { Spotify?: SdkNamespace };
  afterEach(() => {
    sdkWindow.Spotify = undefined;
  });
  function fakeSdk() {
    const listeners = new Map<string, (event: never) => void>();
    const sdk = {
      connect: vi.fn(async () => {
        listeners.get('ready')?.({ device_id: 'browser' } as never);
        return true;
      }),
      disconnect: vi.fn(),
      activateElement: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      getCurrentState: vi.fn().mockResolvedValue(null),
      addListener: vi.fn((event: string, callback: (event: never) => void) => {
        listeners.set(event, callback);
        return true;
      }),
      removeListener: vi.fn((event: string) => {
        listeners.delete(event);
        return true;
      }),
    };
    const options: { enableMediaSession?: boolean } = {};
    sdkWindow.Spotify = {
      Player: class {
        constructor(input: { enableMediaSession: boolean }) {
          Object.assign(options, input);
          Object.assign(this, sdk);
        }
      } as unknown as SdkNamespace['Player'],
    };
    const emit = (event: string, value: unknown = {}) => listeners.get(event)?.(value as never);
    return { sdk, emit, options };
  }
  const state = (position = 1000, paused = false): SdkState => ({
    paused,
    position,
    duration: TRACK.durationMs,
    disallows: { skipping_next: true },
    track_window: {
      current_track: {
        uri: TRACK.uri,
        name: TRACK.name,
        artists: [{ name: 'Artist' }],
        album: { name: 'Album', images: [] },
      },
    },
  });

  test('ready/teardown; SDK media session is disabled; activateElement runs before network', async () => {
    const { sdk, options } = fakeSdk();
    const { module, request } = setup();
    await module.enableBrowser();
    expect(module.browserDevice).toBe('browser');
    expect(options.enableMediaSession).toBe(false);
    module.deviceId = 'browser';
    module.play(TRACK);
    expect(sdk.activateElement).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    await flush();
    module.clear();
    expect(sdk.disconnect).toHaveBeenCalled();
    expect(sdk.removeListener).toHaveBeenCalledWith('player_state_changed');
    expect(module.browserDevice).toBeNull();
  });
  test('account_error proves non-Premium; not_ready on inactive browser preserves external state', async () => {
    const { emit } = fakeSdk();
    const { module } = setup();
    await module.enableBrowser();
    module.deviceId = 'external';
    module.phase = 'playing';
    emit('not_ready');
    expect(module.phase).toBe('playing');
    expect(module.browserDevice).toBeNull();
    emit('account_error');
    expect(module.status?.capabilities.canHybridPlayback).toBe(false);
    expect(module.status?.entitlement).toBe('non-premium');
    expect(module.status?.capabilities.canStream).toBe(false);
  });
  test('autoplay is needs-gesture; SDK state carries actual position/disallows; generic pause never skips', async () => {
    const { emit } = fakeSdk();
    const { module, request } = setup();
    await module.enableBrowser();
    module.deviceId = 'browser';
    module.active = true;
    module.current = TRACK;
    module.phase = 'playing';
    module.occurrences = [
      { occurrenceId: 'one', ref: { provider: 'spotify', uri: TRACK.uri }, spotify: TRACK },
      { occurrenceId: 'two', ref: { provider: 'spotify', uri: TRACK.uri }, spotify: TRACK },
    ];
    emit('player_state_changed', state(12345));
    expect(module.remote?.positionMs).toBe(12345);
    expect(module.remote?.disallows.skipping_next).toBe(true);
    emit('autoplay_failed');
    expect(module.phase).toBe('needs-gesture');
    expect(module.occurrenceIndex).toBe(0);
    emit('player_state_changed', state(12345, true));
    expect(module.occurrenceIndex).toBe(0);
    await expect(module.command({ action: 'next' })).resolves.toBeUndefined(); // occurrence queue owns next, not SDK queue
    expect(request).not.toHaveBeenCalledWith('playback', 'POST', expect.objectContaining({ action: 'next' }));
  });
  test('near-end reset is deduplicated and external URI change pauses instead of spuriously skipping', async () => {
    const { emit } = fakeSdk();
    const { module } = setup();
    await module.enableBrowser();
    module.deviceId = 'browser';
    module.active = true;
    module.current = TRACK;
    module.phase = 'playing';
    module.occurrences = [
      { occurrenceId: 'one', ref: { provider: 'spotify', uri: TRACK.uri }, spotify: TRACK },
      { occurrenceId: 'two', ref: { provider: 'spotify', uri: TRACK.uri }, spotify: TRACK },
    ];
    emit('player_state_changed', state(TRACK.durationMs - 100));
    emit('player_state_changed', state(0, true));
    emit('player_state_changed', state(0, true));
    expect(module.occurrenceIndex).toBe(1);
    module.phase = 'playing';
    const changed = state(1000);
    changed.track_window.current_track.uri = `spotify:track:${'b'.repeat(22)}`;
    emit('player_state_changed', changed);
    expect(module.phase).toBe('paused');
    expect(module.occurrenceIndex).toBe(1);
  });
});

test('queue persistence is references only, partitioned by user, restores paused after link verification', async () => {
  const local = { pause: vi.fn(), isPaused: () => true, playTracks: vi.fn(), position: 0 };
  const request = vi.fn().mockResolvedValue(STATUS);
  const api = { request, reset: vi.fn() } as unknown as SpotifyTransport;
  const storage = window.localStorage;
  storage.clear();
  const create = (user: string) =>
    new SpotifyModule(
      api,
      local as unknown as Player,
      new MediaSessionBridge(undefined, undefined),
      () => true,
      { userId: () => user, storage, localTrack: async () => makeTrack({ id: 'local' }) },
    );
  const module = create('first');
  module.status = STATUS;
  module.playOccurrences([
    { occurrenceId: 'one', ref: { provider: 'local', trackId: 'local' }, local: makeTrack({ id: 'local' }) },
  ]);
  const saved = storage.getItem('spk-hybrid-player:first')!;
  expect(saved).not.toMatch(/audioUrl|accessToken|coverUrl|durationMs|artists/);
  local.playTracks.mockClear();
  const restored = create('first');
  await restored.refresh();
  expect(restored.occurrences).toHaveLength(1);
  expect(restored.phase).toBe('paused');
  expect(local.playTracks).not.toHaveBeenCalled();
  const other = create('second');
  await other.refresh();
  expect(other.occurrences).toHaveLength(0);
});

test('hybrid scanning excludes unavailable offline local files and shuffle-off restores original occurrence order', () => {
  const local = { pause: vi.fn(), isPaused: () => true, playTracks: vi.fn() };
  const api = { request: vi.fn(), reset: vi.fn() } as unknown as SpotifyTransport;
  const module = new SpotifyModule(
    api,
    local as unknown as Player,
    new MediaSessionBridge(undefined, undefined),
    () => true,
    { localAvailable: () => false },
  );
  module.status = STATUS;
  module.repeat = 'all';
  const items = ['one', 'two', 'three'].map((id) => ({
    occurrenceId: id,
    ref: { provider: 'local' as const, trackId: id },
    local: makeTrack({ id }),
  }));
  module.playOccurrences(items);
  expect(local.playTracks).not.toHaveBeenCalled();
  expect(module.phase).toBe('paused');
  module.toggleOccurrenceShuffle();
  module.toggleOccurrenceShuffle();
  expect(module.occurrences.map((item) => item.occurrenceId)).toEqual(['one', 'two', 'three']);
});

describe('bounded external Connect monitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  async function monitorSetup() {
    const doc = new EventTarget() as EventTarget & { hidden: boolean };
    doc.hidden = false;
    let state = {
      device: {
        id: 'external',
        name: 'Connect speaker',
        type: 'Speaker',
        isActive: true,
        isRestricted: false,
        volumePercent: 50,
      },
      track: TRACK,
      playing: true,
      positionMs: 1000,
      shuffle: false,
      repeat: 'off',
      disallows: {},
    };
    const request = vi
      .fn()
      .mockImplementation((action, method) =>
        Promise.resolve(action === 'status' ? STATUS : method === 'POST' ? undefined : state),
      );
    const reset = vi.fn();
    const local = { pause: vi.fn(), isPaused: () => true, playTracks: vi.fn(), position: 0 };
    const media = new MediaSessionBridge(undefined, undefined);
    const module = new SpotifyModule(
      { request, reset } as unknown as SpotifyTransport,
      local as unknown as Player,
      media,
      () => true,
      { document: doc },
    );
    await module.refresh();
    module.deviceId = 'external';
    module.play(TRACK);
    await flush();
    const reads = () =>
      request.mock.calls.filter(([action, method]) => action === 'playback' && method !== 'POST').length;
    return {
      module,
      request,
      local,
      doc,
      media,
      reads,
      setState: (next: typeof state) => {
        state = next;
      },
      state: () => state,
    };
  }

  test('updates observed state without overlap and stops after sixty reads until explicit refresh', async () => {
    const { module, request, reads, state, setState } = await monitorSetup();
    expect(reads()).toBe(1);
    setState({ ...state(), positionMs: 44000, disallows: { pausing: true } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(module.remote?.positionMs).toBe(44000);
    expect(module.remote?.disallows.pausing).toBe(true);
    await vi.advanceTimersByTimeAsync(295000);
    expect(reads()).toBe(61);
    expect(module.error).toContain('Aggiornamento automatico Spotify sospeso');
    await vi.advanceTimersByTimeAsync(300000);
    expect(reads()).toBe(61);
    await module.refreshPlayback();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads()).toBe(63);
    expect(request).not.toHaveBeenCalledWith(
      'playback',
      'POST',
      expect.objectContaining({ action: 'transfer' }),
    );
    module.clear();
  });

  test('slow read cannot overlap another read; local handoff aborts it and rejects its late state', async () => {
    const { module, request, reads, state } = await monitorSetup();
    let release: ((value: unknown) => void) | undefined;
    let signal: AbortSignal | undefined;
    request.mockImplementation((action, method, _body, _query, abort) => {
      if (action === 'playback' && method === 'GET') {
        signal = abort;
        return new Promise((done) => {
          release = done;
        });
      }
      return Promise.resolve(method === 'POST' ? undefined : { ...state(), playing: false });
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads()).toBe(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(reads()).toBe(2);
    const start = vi.fn();
    module.beforeLocalPlay(start);
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    release?.({ ...state(), positionMs: 99999 });
    await flush();
    expect(module.active).toBe(false);
    expect(module.current).toBeNull();
    await vi.advanceTimersByTimeAsync(20000);
    expect(reads()).toBe(3); // one explicit pause-confirmation read only
    module.clear();
  });

  test('external hybrid pause/reset never advances, and changing URI holds the queue with actual metadata', async () => {
    const { module, setState, state, reads, local } = await monitorSetup();
    module.occurrences = [
      { occurrenceId: 'first', ref: { provider: 'spotify', uri: TRACK.uri }, spotify: TRACK },
      {
        occurrenceId: 'second',
        ref: { provider: 'local', trackId: 'next' },
        local: makeTrack({ id: 'next' }),
      },
    ];
    setState({ ...state(), positionMs: TRACK.durationMs - 1 });
    await vi.advanceTimersByTimeAsync(5000);
    setState({ ...state(), positionMs: 0, playing: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(module.occurrenceIndex).toBe(0);
    expect(local.playTracks).not.toHaveBeenCalled();
    expect(module.error).toContain('Premi Successivo');
    expect(module.phase).toBe('paused');
    const pausedReads = reads();
    await vi.advanceTimersByTimeAsync(15000);
    expect(reads()).toBe(pausedReads);
    const changed = { ...TRACK, uri: `spotify:track:${'b'.repeat(22)}`, name: 'Changed externally' };
    setState({ ...state(), track: changed, playing: true });
    await module.refreshPlayback();
    expect(module.current?.name).toBe('Changed externally');
    expect(module.phase).toBe('playing');
    expect(module.occurrenceIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(reads()).toBe(pausedReads + 1);
    module.clear();
  });

  test('observed device changes update device association without transfer or old-device polling', async () => {
    const { module, state, setState, reads } = await monitorSetup();
    setState({ ...state(), device: { ...state().device, id: 'new-external', name: 'Other speaker' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(module.deviceId).toBe('new-external');
    expect(module.remote?.device?.name).toBe('Other speaker');
    expect(module.error).toContain('Riproduzione spostata');
    await vi.advanceTimersByTimeAsync(15000);
    expect(reads()).toBe(2);
    module.clear();
  });

  test.each(['hidden', 'logout', 'error', 'no-state'] as const)(
    'stops on %s and never retries or infers an end',
    async (reason) => {
      const { module, request, doc, reads } = await monitorSetup();
      if (reason === 'hidden') {
        doc.hidden = true;
        doc.dispatchEvent(new Event('visibilitychange'));
      } else if (reason === 'logout') module.clear();
      else if (reason === 'error') request.mockRejectedValue(new Error('Spotify rate limited'));
      else request.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(30000);
      expect(reads()).toBe(reason === 'hidden' || reason === 'logout' ? 1 : 2);
      expect(module.occurrenceIndex).toBe(0);
      module.clear();
    },
  );
});

test('native context selects the requested track offset and leaves the occurrence queue', async () => {
  const { module, request } = setup();
  module.deviceId = 'external';
  module.occurrences = [
    { occurrenceId: 'old', ref: { provider: 'spotify', uri: TRACK.uri }, spotify: TRACK },
  ];
  const contextUri = `spotify:playlist:${'p'.repeat(22)}`;
  module.play(TRACK, contextUri);
  await flush();
  expect(module.occurrences).toHaveLength(0);
  expect(request).toHaveBeenCalledWith('playback', 'POST', {
    action: 'play',
    deviceId: 'external',
    contextUri,
    offsetUri: TRACK.uri,
  });
});

describe('link lifecycle across tabs and visibility', () => {
  class Channel {
    static instances = new Set<Channel>();
    static payloads: unknown[] = [];
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    constructor(readonly name: string) {
      Channel.instances.add(this);
    }
    postMessage(payload: unknown) {
      Channel.payloads.push(payload);
      for (const channel of Channel.instances)
        if (channel !== this && channel.name === this.name)
          channel.onmessage?.({ data: payload } as MessageEvent);
    }
    close() {
      Channel.instances.delete(this);
    }
  }
  beforeEach(() => {
    Channel.instances.clear();
    Channel.payloads = [];
    vi.stubGlobal('BroadcastChannel', Channel);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('successful unlink tears down same-owner SDK immediately, purges persisted remote refs, and ignores other owners', async () => {
    let linked = true;
    const disconnect = vi.fn();
    const listeners = new Map<string, (event: never) => void>();
    const sdkWindow = window as Window & { Spotify?: SdkNamespace };
    sdkWindow.Spotify = {
      Player: class {
        constructor() {
          Object.assign(this, {
            disconnect,
            activateElement: async () => {},
            addListener: (name: string, handler: (event: never) => void) => {
              listeners.set(name, handler);
              return true;
            },
            removeListener: (name: string) => listeners.delete(name),
            connect: async () => {
              listeners.get('ready')?.({ device_id: 'browser' } as never);
              return true;
            },
          });
        }
      } as unknown as SdkNamespace['Player'],
    };
    const local = { pause: vi.fn(), isPaused: () => true, playTracks: vi.fn(), position: 0 };
    const create = (user: string) => {
      const request = vi.fn(async (action: string, method?: string) => {
        if (action === 'link' && method === 'DELETE') {
          linked = false;
          return;
        }
        return linked ? STATUS : { ...STATUS, accountId: null, generation: 2, linkState: 'unlinked' };
      });
      return new SpotifyModule(
        { request, reset: vi.fn() } as unknown as SpotifyTransport,
        local as unknown as Player,
        new MediaSessionBridge(undefined, undefined),
        () => true,
        { userId: () => user, storage: localStorage },
      );
    };
    const first = create('same-owner');
    const second = create('same-owner');
    const other = create('other-owner');
    await Promise.all([first.refresh(), second.refresh(), other.refresh()]);
    await second.enableBrowser();
    second.active = true;
    second.current = TRACK;
    other.current = TRACK;
    localStorage.setItem(
      'spk-hybrid-player:same-owner',
      JSON.stringify({
        items: [
          { occurrenceId: 'local', ref: { provider: 'local', trackId: 'local' } },
          { occurrenceId: 'remote', ref: { provider: 'spotify', uri: TRACK.uri } },
        ],
        index: 1,
        positionMs: 1000,
        accountId: STATUS.accountId,
      }),
    );
    await first.unlink();
    await flush();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(second.current).toBeNull();
    expect(second.active).toBe(false);
    expect(second.browserDevice).toBeNull();
    expect(second.status?.linkState).toBe('unlinked');
    expect(other.current?.uri).toBe(TRACK.uri);
    expect(JSON.parse(localStorage.getItem('spk-hybrid-player:same-owner')!).items).toEqual([
      { occurrenceId: 'local', ref: { provider: 'local', trackId: 'local' } },
    ]);
    expect(Channel.payloads).toEqual([{ userId: 'same-owner' }]);
    first.clear();
    second.clear();
    other.clear();
    expect(Channel.instances.size).toBe(0);
    sdkWindow.Spotify = undefined;
  });

  test('visibility resume hides old metadata until link generation is verified and cleans listener on logout', async () => {
    const doc = new EventTarget() as EventTarget & { hidden: boolean };
    doc.hidden = false;
    const remove = vi.spyOn(doc, 'removeEventListener');
    let resolve: ((value: unknown) => void) | undefined;
    const request = vi.fn().mockResolvedValue(STATUS);
    const module = new SpotifyModule(
      { request, reset: vi.fn() } as unknown as SpotifyTransport,
      { pause: vi.fn() } as unknown as Player,
      new MediaSessionBridge(undefined, undefined),
      () => true,
      { userId: () => 'visibility-owner', document: doc },
    );
    await module.refresh();
    module.current = TRACK;
    module.active = true;
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(module.current).toBeNull();
    expect(module.remote).toBeNull();
    expect(module.phase).toBe('preparing');
    resolve?.({ ...STATUS, generation: 2, accountId: null, linkState: 'unlinked' });
    await flush();
    expect(module.status?.linkState).toBe('unlinked');
    expect(module.active).toBe(false);
    expect(request).not.toHaveBeenCalledWith('playback');
    module.clear();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const calls = request.mock.calls.length;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(request.mock.calls).toHaveLength(calls);
  });
});
