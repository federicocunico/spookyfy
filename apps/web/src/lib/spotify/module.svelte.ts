import {
  type MediaRef,
  type PlayableOccurrence,
  type SpotifyDetailDto,
  type SpotifyDeviceDto,
  type SpotifyPlaybackCommand,
  type SpotifyPlaybackDto,
  type SpotifyStatusDto,
  type SpotifyTokenDto,
  type SpotifyTrackDto,
  type TrackDto,
  mediaRefSchema,
} from '@spookyfy/shared';
import type { MediaSessionBridge } from '../player/media-session';
import type { Player } from '../player/player.svelte';
import type { SdkPlayer, SdkState } from './sdk';
import { SpotifyError, type SpotifyTransport } from './transport';

export type PlaybackPhase = 'idle' | 'preparing' | 'playing' | 'paused' | 'needs-gesture' | 'unavailable';
interface QueuePersistence {
  items: { occurrenceId: string; ref: MediaRef }[];
  index: number;
  positionMs: number;
  accountId: string | null;
}
interface ModuleOptions {
  storage?: Storage;
  userId?: () => string | undefined;
  localTrack?: (id: string) => Promise<TrackDto | undefined>;
  localAvailable?: (track: TrackDto) => boolean;
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
}
export const bounded = <T>(promise: Promise<T>, ms = 10000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Spotify: attesa scaduta')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/** Optional provider: memory-only credentials; persisted queues contain references only. */
export class SpotifyModule {
  status = $state<SpotifyStatusDto | null>(null);
  error = $state<string | null>(null);
  phase = $state<PlaybackPhase>('idle');
  active = $state(false);
  current = $state<SpotifyTrackDto | null>(null);
  remote = $state<SpotifyPlaybackDto | null>(null);
  devices = $state<SpotifyDeviceDto[]>([]);
  browserDevice = $state<string | null>(null);
  deviceId = $state<string | null>(null);
  occurrences = $state<PlayableOccurrence[]>([]);
  occurrenceIndex = $state(0);
  repeat = $state<'off' | 'all' | 'one'>('off');
  shuffle = $state(false);
  private generation = 0;
  private sdk: SdkPlayer | null = null;
  private token: SpotifyTokenDto | null = null;
  private tokenFlight: Promise<SpotifyTokenDto> | null = null;
  private sdkFlight: Promise<void> | null = null;
  private lastState: SdkState | null = null;
  private endConsumed = false;
  private sessionGeneration = 0;
  private pendingStart: Promise<unknown> = Promise.resolve();
  private startingOccurrence = false;
  private originalOccurrences: PlayableOccurrence[] = [];
  private restoredPositionMs = 0;
  private listenerEvents: string[] = [];
  private queueInterrupted = false;
  private channel: BroadcastChannel | null = null;
  private credentialsGeneration = 0;
  private lifecycleChecking = false;
  private visibilityAttached = false;
  private statusVersion = 0;
  private externalTimer: ReturnType<typeof setTimeout> | null = null;
  private externalAbort: AbortController | null = null;
  private externalMonitorGeneration = 0;
  onStatus?: (status: SpotifyStatusDto) => void | Promise<void>;
  onUnlink?: (accountId: string) => void | Promise<void>;

  constructor(
    readonly api: SpotifyTransport,
    private readonly local: Player,
    private readonly media: MediaSessionBridge,
    private readonly authenticated: () => boolean,
    private readonly options: ModuleOptions = {},
  ) {}

  async refresh(): Promise<void> {
    if (!this.authenticated()) return;
    if (!this.visibilityAttached && this.options.document) {
      this.options.document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.visibilityAttached = true;
    }
    if (!this.channel && this.options.userId && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('spookyfy-spotify');
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data as { userId?: string } | null;
        if (message?.userId !== this.options.userId?.() || !this.authenticated()) return;
        this.sessionGeneration++;
        this.clearPlayback();
        this.api.reset();
        void this.refresh();
      };
    }
    const generation = this.sessionGeneration;
    try {
      const status = await this.api.request<SpotifyStatusDto>('status');
      if (generation !== this.sessionGeneration) return;
      if (
        this.status &&
        (this.status.generation !== status.generation || this.status.accountId !== status.accountId)
      )
        this.clearPlayback();
      this.status = status;
      if (status.linkState !== 'linked') this.stopExternalMonitor();
      this.statusVersion++;
      this.lifecycleChecking = false;
      this.error = null;
      await this.onStatus?.(status);
      if (!this.occurrences.length) await this.restoreOccurrences();
    } catch (error) {
      if (generation === this.sessionGeneration) this.fail(error);
    }
  }

  async link(
    capability: 'profile' | 'library' | 'playlist-write' | 'library-write' | 'playback' = 'library',
  ): Promise<void> {
    if (!this.authenticated()) throw new Error('Accedi prima con il tuo account Spookyfy');
    const { url } = await this.api.request<{ url: string }>('link', 'POST', { capability });
    const target = new URL(url, window.location.origin);
    const fakeCallback =
      this.status?.mode === 'fake' &&
      target.origin === window.location.origin &&
      target.pathname === '/api/spotify/callback';
    if (
      !fakeCallback &&
      (target.origin !== 'https://accounts.spotify.com' || target.pathname !== '/authorize')
    )
      throw new Error('URL Spotify non valido');
    window.location.assign(target.href);
  }

  async unlink(): Promise<void> {
    const account = this.status?.accountId;
    let stopUnconfirmed = false;
    if (this.active) {
      try {
        await bounded(this.confirmPause(), 3000);
      } catch {
        // Revoking access must remain possible even when Spotify/device is unreachable.
        stopUnconfirmed = true;
      }
    }
    this.clearPlayback();
    this.api.reset();
    await this.api.request('link', 'DELETE');
    const userId = this.options.userId?.();
    if (userId) {
      try {
        const raw = this.options.storage?.getItem(`spk-hybrid-player:${userId}`);
        if (raw) {
          const saved = JSON.parse(raw) as QueuePersistence;
          saved.items = saved.items.filter((item) => item.ref.provider === 'local');
          saved.index = 0;
          saved.positionMs = 0;
          saved.accountId = null;
          this.options.storage?.setItem(`spk-hybrid-player:${userId}`, JSON.stringify(saved));
        }
      } catch {}
      this.channel?.postMessage({ userId });
    }
    if (account) await this.onUnlink?.(account);
    await this.refresh();
    if (stopUnconfirmed)
      this.error = 'Spotify scollegato. Arresta anche l’eventuale riproduzione sul dispositivo esterno.';
  }

  clear(): void {
    this.sessionGeneration++;
    this.api.reset();
    this.clearPlayback();
    this.channel?.close();
    this.channel = null;
    this.options.document?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityAttached = false;
    this.lifecycleChecking = false;
    this.status = null;
    this.error = null;
  }
  private clearPlayback(): void {
    this.stopExternalMonitor();
    if (this.active) {
      this.media.setSpotifyTrack(null);
      this.media.setPlaying(false, true);
    }
    this.generation++;
    this.credentialsGeneration++;
    this.teardownSdk();
    this.sdkFlight = null;
    this.token = null;
    this.tokenFlight = null;
    this.lastState = null;
    this.browserDevice = null;
    this.deviceId = null;
    this.current = null;
    this.remote = null;
    this.devices = [];
    this.occurrences = [];
    this.active = false;
    this.phase = 'idle';
  }
  private teardownSdk(): void {
    for (const event of this.listenerEvents) this.sdk?.removeListener(event);
    this.listenerEvents = [];
    this.sdk?.disconnect();
    this.sdk = null;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60000) return this.token.accessToken;
    const generation = this.sessionGeneration;
    const credentialsGeneration = this.credentialsGeneration;
    this.tokenFlight ??= this.api.request<SpotifyTokenDto>('token', 'POST').finally(() => {
      this.tokenFlight = null;
    });
    const token = await this.tokenFlight;
    if (generation !== this.sessionGeneration || credentialsGeneration !== this.credentialsGeneration)
      throw new Error('Sessione Spotify terminata');
    this.token = token;
    return token.accessToken;
  }

  /** First gesture enables the browser device; subsequent play gestures activate it synchronously. */
  enableBrowser(): Promise<void> {
    if (this.sdk) {
      void this.sdk.activateElement().catch(() => {
        this.phase = 'needs-gesture';
      });
      return Promise.resolve();
    }
    if (this.sdkFlight) return this.sdkFlight;
    if (!this.status?.capabilities.canStream)
      return Promise.reject(new Error('Riproduzione Spotify non abilitata'));
    const generation = this.generation;
    this.sdkFlight = (async () => {
      const { loadSdk } = await import('./sdk');
      const namespace = await loadSdk();
      if (generation !== this.generation) return;
      const sdk = new namespace.Player({
        name: 'Spookyfy',
        enableMediaSession: false,
        getOAuthToken: (callback) => {
          void this.accessToken()
            .then((token) => {
              if (sdk === this.sdk) callback(token);
            })
            .catch((error: unknown) => {
              if (sdk === this.sdk) this.fail(error);
            });
        },
      });
      this.sdk = sdk;
      let signalReady: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        signalReady = resolve;
      });
      const listen = <T>(event: string, fn: (value: T) => void) => {
        this.listenerEvents.push(event);
        sdk.addListener(event, ((value: T) => {
          if (sdk === this.sdk) fn(value);
        }) as (event: never) => void);
      };
      listen<{ device_id: string }>('ready', ({ device_id }) => {
        this.browserDevice = device_id;
        signalReady?.();
      });
      listen('not_ready', () => {
        const activeBrowser = this.deviceId === this.browserDevice;
        this.browserDevice = null;
        if (activeBrowser) {
          this.phase = 'unavailable';
          this.error = 'Dispositivo Spotify perso. Scegli esplicitamente un dispositivo.';
        }
      });
      listen<SdkState | null>('player_state_changed', (state) => this.receiveState(state));
      listen('autoplay_failed', () => {
        this.phase = 'needs-gesture';
      });
      for (const event of ['account_error', 'authentication_error', 'initialization_error', 'playback_error'])
        listen(event, () => {
          if (event === 'account_error' && this.status)
            this.status = {
              ...this.status,
              entitlement: 'non-premium',
              capabilities: { ...this.status.capabilities, canStream: false, canHybridPlayback: false },
            };
          this.fail(
            new SpotifyError(
              event === 'account_error'
                ? 'SPOTIFY_PREMIUM_REQUIRED'
                : event === 'authentication_error'
                  ? 'SPOTIFY_REAUTH_REQUIRED'
                  : 'SPOTIFY_UNSUPPORTED',
              event === 'account_error'
                ? 'Spotify richiede Premium'
                : 'Player Spotify non disponibile. Apri Spotify o scegli un altro dispositivo.',
            ),
          );
        });
      if (!(await bounded(sdk.connect()))) throw new Error('Connessione al player Spotify non riuscita');
      await bounded(ready);
      if (sdk !== this.sdk) return;
      // Loading cannot retain the initial gesture; do not autoplay after this asynchronous step.
      this.phase = 'needs-gesture';
    })()
      .catch((error: unknown) => {
        if (generation === this.generation) {
          this.teardownSdk();
          this.fail(error);
        }
        throw error;
      })
      .finally(() => {
        this.sdkFlight = null;
      });
    return this.sdkFlight;
  }

  async refreshDevices(): Promise<void> {
    this.devices = (await this.api.request<{ devices: SpotifyDeviceDto[] }>('devices')).devices;
  }
  async transfer(deviceId: string): Promise<void> {
    if (this.lifecycleChecking)
      throw new Error('Verifica il collegamento Spotify prima di scegliere un dispositivo.');
    const device = this.devices.find((d) => d.id === deviceId);
    if (device?.isRestricted) throw new Error('Dispositivo limitato');
    this.stopExternalMonitor();
    const generation = ++this.generation;
    await this.api.request('playback', 'POST', { action: 'transfer', deviceId });
    if (generation !== this.generation) return;
    this.deviceId = deviceId;
    await this.refreshPlayback();
  }
  async refreshPlayback(): Promise<void> {
    if (this.lifecycleChecking || !this.authenticated() || this.status?.linkState !== 'linked') return;
    const generation = this.generation;
    const deviceId = this.deviceId;
    this.stopExternalMonitor();
    const monitor = this.externalMonitorGeneration;
    const state = await this.api.request<SpotifyPlaybackDto | null>('playback');
    if (
      generation !== this.generation ||
      deviceId !== this.deviceId ||
      monitor !== this.externalMonitorGeneration
    )
      return;
    if (this.applyPlaybackState(state, deviceId)) this.startExternalMonitor();
  }
  private applyPlaybackState(state: SpotifyPlaybackDto | null, expectedDevice: string | null): boolean {
    this.remote = state;
    if (this.active && !state) {
      this.current = null;
      this.phase = 'paused';
      this.error = 'Stato Spotify non disponibile. Aggiorna lo stato o scegli un dispositivo.';
      this.updateMedia();
      return false;
    }
    if (this.active && state) {
      const occurrence = this.occurrences[this.occurrenceIndex];
      this.current = state.track;
      this.phase = state.playing ? 'playing' : 'paused';
      if (expectedDevice && state.device && state.device.id !== expectedDevice) {
        this.deviceId = state.device.id;
        this.queueInterrupted = this.occurrences.length > 0;
        this.error = 'Riproduzione spostata in Spotify. Verifica il dispositivo prima di continuare.';
        this.updateMedia();
        return false;
      }
      if (occurrence?.ref.provider === 'spotify' && state.track && state.track.uri !== occurrence.ref.uri) {
        this.queueInterrupted = true;
        this.error =
          'Riproduzione modificata in Spotify. Riprendi esplicitamente la raccolta per continuare.';
        this.updateMedia();
        return false;
      }
      this.persistOccurrences(state.positionMs);
      if (expectedDevice !== this.browserDevice && occurrence?.ref.provider === 'spotify' && !state.playing) {
        this.error =
          'Riproduzione sul dispositivo esterno terminata o sospesa. Premi Successivo per continuare la raccolta.';
        this.updateMedia();
        return false;
      }
      if (!this.queueInterrupted) this.error = null;
      this.updateMedia();
    }
    return Boolean(state && this.active);
  }
  private canMonitorExternal(): boolean {
    return (
      this.authenticated() &&
      this.status?.linkState === 'linked' &&
      this.active &&
      Boolean(this.deviceId) &&
      this.deviceId !== this.browserDevice &&
      !this.options.document?.hidden &&
      !this.lifecycleChecking
    );
  }
  private stopExternalMonitor(): void {
    this.externalMonitorGeneration++;
    if (this.externalTimer !== null) clearTimeout(this.externalTimer);
    this.externalTimer = null;
    this.externalAbort?.abort();
    this.externalAbort = null;
  }
  private startExternalMonitor(): void {
    this.stopExternalMonitor();
    if (!this.canMonitorExternal()) return;
    const monitor = this.externalMonitorGeneration;
    const generation = this.generation;
    const deviceId = this.deviceId;
    let remaining = 60;
    const current = () =>
      monitor === this.externalMonitorGeneration &&
      generation === this.generation &&
      deviceId === this.deviceId &&
      this.canMonitorExternal();
    const schedule = () => {
      if (!current()) return;
      this.externalTimer = setTimeout(() => {
        void poll();
      }, 5000);
    };
    const poll = async () => {
      this.externalTimer = null;
      if (!current()) return;
      const abort = new AbortController();
      this.externalAbort = abort;
      try {
        const state = await this.api.request<SpotifyPlaybackDto | null>(
          'playback',
          'GET',
          undefined,
          {},
          abort.signal,
        );
        if (!current()) return;
        remaining--;
        if (!this.applyPlaybackState(state, deviceId)) {
          this.stopExternalMonitor();
          return;
        }
        if (remaining <= 0) {
          this.stopExternalMonitor();
          this.error =
            'Aggiornamento automatico Spotify sospeso. Premi Aggiorna stato Spotify per continuare.';
          return;
        }
        schedule();
      } catch (error) {
        if (!current() || abort.signal.aborted) return;
        this.stopExternalMonitor();
        this.fail(error);
      } finally {
        if (this.externalAbort === abort) this.externalAbort = null;
      }
    };
    schedule();
  }

  /** Called synchronously by the unchanged local engine before any start/resume. */
  beforeLocalPlay = (start: () => void): boolean => {
    const occurrence = this.startingOccurrence;
    if (!this.active) return true;
    this.stopExternalMonitor();
    const generation = ++this.generation;
    this.phase = 'preparing';
    void this.confirmPause()
      .then(() => {
        if (generation !== this.generation) return;
        this.active = false;
        this.phase = 'paused';
        this.current = null;
        this.startingOccurrence = occurrence;
        try {
          start();
        } finally {
          this.startingOccurrence = false;
        }
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.fail(error);
      });
    return false;
  };
  localQueueReplaced = (): void => {
    if (!this.startingOccurrence) {
      this.occurrences = [];
      this.originalOccurrences = [];
    }
  };
  localQueueCommand = (command: 'next' | 'previous' | 'shuffle' | 'repeat'): boolean => {
    if (
      !this.occurrences.length ||
      this.active ||
      this.occurrences[this.occurrenceIndex]?.ref.provider !== 'local'
    )
      return false;
    if (command === 'shuffle') this.toggleOccurrenceShuffle();
    else if (command === 'repeat')
      this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    else if (
      command === 'previous' &&
      this.local.position - (this.occurrences[this.occurrenceIndex]?.local?.trimStartMs ?? 0) / 1000 > 3
    ) {
      this.local.seek((this.occurrences[this.occurrenceIndex]?.local?.trimStartMs ?? 0) / 1000);
      this.local.resume();
    } else {
      if (command === 'previous') this.occurrenceIndex = Math.max(-1, this.occurrenceIndex - 2);
      this.advanceOccurrence();
    }
    return true;
  };

  private async confirmPause(): Promise<void> {
    const generation = this.generation;
    const assertCurrent = () => {
      if (generation !== this.generation) throw new Error('Operazione Spotify terminata');
    };
    await bounded(this.pendingStart.catch(() => {}));
    assertCurrent();
    if (this.deviceId && this.deviceId === this.browserDevice && this.sdk) {
      await bounded(this.sdk.pause());
      assertCurrent();
      const state = await bounded(this.sdk.getCurrentState());
      if (!state || !state.paused)
        throw new Error(
          'Pausa Spotify non confermata. Disconnetti il player browser o arresta il dispositivo remoto.',
        );
    } else {
      await this.api.request('playback', 'POST', {
        action: 'pause',
        ...(this.deviceId ? { deviceId: this.deviceId } : {}),
      });
      assertCurrent();
      const state = await this.api.request<SpotifyPlaybackDto | null>('playback');
      if (!state || state.playing)
        throw new Error('Arresta Spotify sul dispositivo remoto e riprova: pausa non confermata.');
    }
  }

  play(track: SpotifyTrackDto, contextUri?: string, fromOccurrence = false): void {
    if (this.lifecycleChecking) {
      this.fail(new Error('Verifica il collegamento Spotify prima di riprodurre.'));
      return;
    }
    if (!fromOccurrence) this.occurrences = [];
    if (!this.status?.capabilities.canStream || !track.available) {
      this.fail(new Error('Brano Spotify non riproducibile'));
      return;
    }
    this.stopExternalMonitor();
    // activateElement MUST run before awaiting a network operation, from this gesture.
    if (this.sdk && this.deviceId === this.browserDevice)
      void this.sdk.activateElement().catch(() => {
        this.phase = 'needs-gesture';
      });
    const generation = ++this.generation;
    this.local.pause();
    if (!this.local.isPaused()) {
      this.fail(new Error('Arresto del player locale non confermato'));
      return;
    }
    this.active = true;
    this.current = track;
    this.phase = 'preparing';
    this.endConsumed = false;
    this.lastState = null;
    this.queueInterrupted = false;
    if (!this.deviceId) {
      this.phase = 'unavailable';
      this.error = 'Scegli un dispositivo o attiva il player browser, poi premi Riproduci.';
      return;
    }
    this.pendingStart = this.pendingStart
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        if (this.occurrences.length) {
          await this.api.request('playback', 'POST', {
            action: 'repeat',
            repeat: 'off',
            deviceId: this.deviceId,
          });
          if (generation !== this.generation) return;
          await this.api.request('playback', 'POST', {
            action: 'shuffle',
            state: false,
            deviceId: this.deviceId,
          });
          if (generation !== this.generation) return;
        }
        const positionMs = this.restoredPositionMs;
        this.restoredPositionMs = 0;
        return this.api.request('playback', 'POST', {
          action: 'play',
          deviceId: this.deviceId,
          ...(contextUri ? { contextUri, offsetUri: track.uri } : { uri: track.uri }),
          ...(positionMs ? { positionMs } : {}),
        });
      });
    void this.pendingStart
      .then(async () => {
        if (generation !== this.generation) return;
        await this.refreshPlayback();
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.fail(error);
      });
  }

  async command(command: SpotifyPlaybackCommand): Promise<void> {
    if (this.lifecycleChecking) throw new Error('Verifica il collegamento Spotify prima di riprendere.');
    if (!this.active) return;
    if (this.occurrences.length && command.action === 'shuffle') {
      this.toggleOccurrenceShuffle();
      return;
    }
    if (this.occurrences.length && command.action === 'repeat') {
      this.repeat = command.repeat === 'context' ? 'all' : command.repeat === 'track' ? 'one' : 'off';
      return;
    }
    if (this.occurrences.length && (command.action === 'next' || command.action === 'previous')) {
      if (command.action === 'previous') this.occurrenceIndex = Math.max(-1, this.occurrenceIndex - 2);
      this.advanceOccurrence();
      return;
    }
    const disallow: Record<string, string> = {
      pause: 'pausing',
      resume: 'resuming',
      next: 'skipping_next',
      previous: 'skipping_prev',
      seek: 'seeking',
      shuffle: 'toggling_shuffle',
      repeat: 'toggling_repeat_context',
    };
    if (
      this.remote?.disallows[
        command.action === 'repeat' && command.repeat === 'track'
          ? 'toggling_repeat_track'
          : (disallow[command.action] ?? '')
      ]
    )
      throw new Error('Comando non consentito da Spotify');
    if (command.action === 'resume' && this.sdk)
      void this.sdk.activateElement().catch(() => {
        this.phase = 'needs-gesture';
      });
    this.stopExternalMonitor();
    await this.api.request('playback', 'POST', {
      ...command,
      ...(this.deviceId ? { deviceId: this.deviceId } : {}),
    });
    await this.refreshPlayback();
  }

  disconnectBrowser(): void {
    this.stopExternalMonitor();
    this.generation++;
    const external = this.deviceId !== this.browserDevice;
    this.teardownSdk();
    this.browserDevice = null;
    this.token = null;
    if (!external) {
      this.active = false;
      this.phase = 'paused';
      this.current = null;
      this.deviceId = null;
    } else this.error = 'Arresta il dispositivo Spotify esterno e riprova il file locale.';
  }

  playOccurrences(items: PlayableOccurrence[]): void {
    if (!this.status?.capabilities.canHybridPlayback) {
      this.fail(new Error('Riproduzione multisorgente disattivata'));
      return;
    }
    this.occurrences = [...items];
    this.originalOccurrences = [...items];
    this.occurrenceIndex = 0;
    this.advanceOccurrence(false);
  }
  toggleOccurrenceShuffle(): void {
    this.shuffle = !this.shuffle;
    if (!this.shuffle) {
      const id = this.occurrences[this.occurrenceIndex]?.occurrenceId;
      this.occurrences = [...this.originalOccurrences];
      this.occurrenceIndex = Math.max(
        0,
        this.occurrences.findIndex((item) => item.occurrenceId === id),
      );
      this.persistOccurrences();
      return;
    }
    const current = this.occurrences[this.occurrenceIndex];
    const remaining = this.occurrences.filter((_, i) => i !== this.occurrenceIndex);
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!];
    }
    this.occurrences = current ? [current, ...remaining] : remaining;
    this.occurrenceIndex = 0;
    this.persistOccurrences();
  }
  advanceOccurrence(next = true, automatic = false): void {
    const items = this.occurrences;
    if (!items.length) return;
    let index = this.occurrenceIndex + (next && !(automatic && this.repeat === 'one') ? 1 : 0);
    for (let scanned = 0; scanned < items.length; scanned++, index++) {
      if (index >= items.length) {
        if (this.repeat === 'off') {
          this.local.pause();
          void this.command({ action: 'pause' }).catch(() => {});
          return;
        }
        index = 0;
      }
      const item = items[index]!;
      if (item.ref.provider === 'spotify' && item.spotify?.available) {
        this.occurrenceIndex = index;
        this.persistOccurrences();
        this.play(item.spotify, undefined, true);
        return;
      }
      if (
        item.ref.provider === 'local' &&
        item.local &&
        (this.options.localAvailable?.(item.local) ?? true)
      ) {
        this.occurrenceIndex = index;
        this.persistOccurrences();
        this.startingOccurrence = true;
        const position = this.restoredPositionMs / 1000;
        this.restoredPositionMs = 0;
        try {
          this.local.playTracks([item.local], 0, null, position);
        } finally {
          this.startingOccurrence = false;
        }
        return;
      }
    }
    this.local.pause();
    if (this.active) void this.command({ action: 'pause' }).catch((error: unknown) => this.fail(error));
    this.phase = 'paused';
    this.error = 'Nessun elemento disponibile nella raccolta';
  }
  private persistOccurrences(positionMs = 0): void {
    const user = this.options.userId?.();
    if (!user || !this.occurrences.length) return;
    const data: QueuePersistence = {
      items: this.occurrences.map(({ occurrenceId, ref }) => ({ occurrenceId, ref })),
      index: this.occurrenceIndex,
      positionMs,
      accountId: this.status?.accountId ?? null,
    };
    try {
      this.options.storage?.setItem(`spk-hybrid-player:${user}`, JSON.stringify(data));
    } catch {}
  }
  private async restoreOccurrences(): Promise<void> {
    const user = this.options.userId?.();
    if (!user) return;
    const generation = this.sessionGeneration;
    try {
      const raw = this.options.storage?.getItem(`spk-hybrid-player:${user}`);
      if (!raw) return;
      const data = JSON.parse(raw) as QueuePersistence;
      if (
        !Array.isArray(data.items) ||
        data.items.length > 1000 ||
        !Number.isInteger(data.index) ||
        !Number.isFinite(data.positionMs) ||
        data.positionMs < 0
      )
        return;
      const items = await Promise.all(
        data.items.map(async (item): Promise<PlayableOccurrence> => {
          const ref = mediaRefSchema.parse(item.ref);
          if (typeof item.occurrenceId !== 'string') throw new Error('Occorrenza non valida');
          const base = { occurrenceId: item.occurrenceId, ref };
          if (ref.provider === 'local')
            return { ...base, local: await this.options.localTrack?.(ref.trackId) };
          if (data.accountId !== this.status?.accountId || this.status?.linkState !== 'linked') return base;
          const response = await this.api
            .request<SpotifyDetailDto>('detail', 'GET', undefined, {
              type: 'track',
              id: ref.uri.split(':')[2]!,
            })
            .catch(() => null);
          return {
            ...base,
            spotify: response?.entity.kind === 'track' ? (response.entity as SpotifyTrackDto) : undefined,
          };
        }),
      );
      if (generation !== this.sessionGeneration || this.occurrences.length) return;
      this.occurrences = items;
      this.originalOccurrences = [...items];
      this.occurrenceIndex = Math.max(0, Math.min(data.index, items.length - 1));
      this.restoredPositionMs = data.positionMs;
      this.phase = 'paused';
    } catch {
      /* Invalid saved refs cannot enter a playback queue. */
    }
  }
  resumeOccurrence(): void {
    this.advanceOccurrence(false);
  }
  flush(): void {
    this.persistOccurrences(this.active ? (this.remote?.positionMs ?? 0) : this.local.position * 1000);
  }
  private receiveState(state: SdkState | null): void {
    if (!this.active || this.deviceId !== this.browserDevice || !state) return;
    if (this.lifecycleChecking) return;
    if (this.phase === 'preparing' || this.queueInterrupted) return; // Ignore stale signals until start is acknowledged.
    const previous = this.lastState;
    this.lastState = state;
    if (this.current && state.track_window.current_track.uri !== this.current.uri) {
      if (this.occurrences.length) {
        this.queueInterrupted = true;
        this.phase = 'paused';
        this.error = 'Riproduzione modificata in Spotify. Aggiorna lo stato prima di continuare.';
        return;
      }
      const track = state.track_window.current_track;
      if (!mediaRefSchema.safeParse({ provider: 'spotify', uri: track.uri }).success) {
        this.phase = 'unavailable';
        return;
      }
      this.current = {
        kind: 'track',
        id: track.uri.split(':')[2]!,
        uri: track.uri,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        album: track.album.name,
        imageUrl: track.album.images[0]?.url ?? null,
        durationMs: state.duration,
        available: true,
        externalUrl: `https://open.spotify.com/track/${track.uri.split(':')[2]!}`,
      };
    }
    this.phase = state.paused ? 'paused' : 'playing';
    const track = state.track_window.current_track;
    this.remote = {
      device: this.remote?.device ?? null,
      track: this.current,
      playing: !state.paused,
      positionMs: state.position,
      shuffle: this.remote?.shuffle ?? false,
      repeat: this.remote?.repeat ?? 'off',
      disallows: state.disallows,
    };
    if (this.current && track.uri === this.current.uri)
      this.current = {
        ...this.current,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        album: track.album.name,
        imageUrl: track.album.images[0]?.url ?? null,
        durationMs: state.duration,
      };
    this.persistOccurrences(state.position);
    // Paused alone is never an end signal. Require a near-end to zero transition on the same URI.
    if (
      this.occurrences.length &&
      !this.endConsumed &&
      previous &&
      !previous.paused &&
      state.paused &&
      previous.duration > 0 &&
      previous.position >= previous.duration - 1000 &&
      state.position === 0 &&
      previous.track_window.current_track.uri === state.track_window.current_track.uri
    ) {
      this.endConsumed = true;
      this.advanceOccurrence(true, true);
    }
    this.updateMedia();
  }
  private updateMedia(): void {
    if (!this.active) return;
    this.media.setSpotifyTrack(this.current);
    this.media.setPlaying(this.phase === 'playing', true);
    if (this.current)
      this.media.setPosition(this.current.durationMs / 1000, (this.remote?.positionMs ?? 0) / 1000, 1, true);
  }
  private fail(error: unknown): void {
    this.stopExternalMonitor();
    if (error instanceof SpotifyError && error.code === 'SESSION_REQUIRED') {
      this.clearPlayback();
      this.status = null;
    }
    if (error instanceof SpotifyError && error.code === 'SPOTIFY_REAUTH_REQUIRED' && this.status) {
      this.status = {
        ...this.status,
        linkState: 'reauth-required',
        capabilities: {
          ...this.status.capabilities,
          canBrowse: false,
          canEditLibrary: false,
          canEditPlaylist: false,
          canStream: false,
          canHybridPlayback: false,
        },
      };
      this.token = null;
    }
    this.error = error instanceof Error ? error.message : 'Spotify non disponibile';
    this.phase = 'unavailable';
  }
  private onVisibilityChange = (): void => {
    if (this.options.document?.hidden) {
      this.stopExternalMonitor();
      return;
    }
    if (!this.authenticated()) return;
    const generation = this.sessionGeneration;
    const version = this.statusVersion;
    this.lifecycleChecking = true;
    this.current = null;
    this.remote = null;
    if (this.active) {
      this.phase = 'preparing';
      this.media.setSpotifyTrack(null);
      this.media.setPlaying(false, true);
    }
    void this.refresh()
      .then(async () => {
        if (
          generation !== this.sessionGeneration ||
          version === this.statusVersion ||
          this.status?.linkState !== 'linked'
        )
          return;
        if (this.active) await this.refreshPlayback();
      })
      .catch((error: unknown) => {
        if (generation === this.sessionGeneration) this.fail(error);
      });
  };
}
