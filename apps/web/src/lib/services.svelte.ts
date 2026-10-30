import type { BackendMode, HealthDto, SpotifyStatusDto, WsServerEvent } from '@spookyfy/shared';
import { type Api, api as defaultApi, request, setApiHooks } from './api';
import { createDeviceBackend } from './device/backend';
import { getSettings } from './device/backup';
import { catalogSettings, scheduleCoverLookup } from './device/catalog';
import { type CoverProcessor, processCover } from './device/cover';
import { DeviceImporter } from './device/importer';
import { DeviceLibrary, localFallbackSrc } from './device/library';
import { BridgeClient, GatewayClient } from './device/remote';
import { HttpHybridRepository } from './hybrid/http';
import { HybridRepository, type HybridRepositoryApi } from './hybrid/repository';
import { type Db, getDb } from './offline/db';
import { Downloads } from './offline/downloads.svelte';
import { StorageStatus } from './offline/storage.svelte';
import { WakeLockController } from './offline/wakelock';
import { MediaSessionBridge } from './player/media-session';
import { PlayReporter } from './player/play-reporter';
import { Player } from './player/player.svelte';
import { RealtimeClient } from './realtime/ws';
import { Router } from './router.svelte';
import { SpotifyModule } from './spotify/module.svelte';
import { SpotifyTransport } from './spotify/transport';
import { Catalog } from './stores/catalog.svelte';
import { Connection } from './stores/connection.svelte';
import { Jobs } from './stores/jobs.svelte';
import { Library } from './stores/library.svelte';
import { Session } from './stores/session.svelte';
import { Toasts } from './stores/toasts.svelte';
import { Ui } from './stores/ui.svelte';

/** Servizi propri della modalità client (libreria e importazioni sul dispositivo). */
export interface DeviceServices {
  library: DeviceLibrary;
  importer: DeviceImporter;
  gateway: GatewayClient;
  processCover: CoverProcessor;
  /** Client del ponte on-premise, se configurato nelle impostazioni. */
  bridge(): Promise<BridgeClient | null>;
  /** Brani persi (file eliminati dal sistema), aggiornato dalla riconciliazione. */
  lost: { ids: string[] };
}

/** Il realtime esiste solo in modalità on-premise; in modalità client è un segnaposto. */
export interface Realtime {
  start(): void;
  stop(): void;
  nudge(): void;
}

export interface Services {
  mode: BackendMode;
  health: HealthDto | null;
  api: Api;
  db: () => Promise<Db>;
  connection: Connection;
  toasts: Toasts;
  ui: Ui;
  router: Router;
  session: Session;
  storage: StorageStatus;
  library: Library;
  catalog: Catalog;
  wakeLock: WakeLockController;
  downloads: Downloads;
  reporter: PlayReporter;
  player: Player;
  spotify: SpotifyModule;
  hybrid: HybridRepositoryApi;
  deviceHybrid: HybridRepository;
  jobs: Jobs;
  realtime: Realtime;
  device: DeviceServices | null;
  /** Il brano è riproducibile senza rete (scaricato o, in modalità client, sul dispositivo). */
  isLocal(trackId: string): boolean;
}

export interface ServiceOverrides {
  mode?: BackendMode;
  health?: HealthDto | null;
  api?: Api;
  db?: () => Promise<Db>;
  window?: Window;
  mediaSession?: MediaSessionBridge;
  realtime?: (s: Pick<Services, 'jobs'>) => Realtime;
  /** Modalità client: fetch verso gateway, elaborazione copertine (finti nei test). */
  fetch?: typeof fetch;
  processCover?: CoverProcessor;
  bridgePollMs?: number;
}

const noopRealtime: Realtime = { start() {}, stop() {}, nudge() {} };

/** Crea e collega tutti gli store dell'app (anche nei test, con dipendenze finte). */
export function createServices(o: ServiceOverrides = {}): Services {
  const mode = o.mode ?? 'onpremise';
  const db = o.db ?? getDb;
  const win = o.window ?? window;
  const connection = new Connection(win);
  const toasts = new Toasts();
  const ui = new Ui();
  const router = new Router(win);
  const storage = new StorageStatus();
  const wakeLock = new WakeLockController(win.navigator, win.document);
  const downloads = new Downloads({ db, toasts, wakeLock, doc: win.document });

  // In modalità client gli eventi delle importazioni arrivano dal gestore locale.
  let onImportEvent: (e: WsServerEvent) => void = () => {};
  let device: DeviceServices | null = null;
  let api: Api = o.api ?? defaultApi;
  const lost = $state<{ ids: string[] }>({ ids: [] });
  if (mode === 'client') {
    const library = new DeviceLibrary({ db, processCover: o.processCover });
    const gateway = new GatewayClient(o.fetch);
    const cover = o.processCover ?? processCover;
    const bridge = async () => {
      const s = await getSettings(await db());
      return s.bridge ? new BridgeClient(s.bridge, o.fetch) : null;
    };
    const importer = new DeviceImporter({
      db,
      library,
      gateway,
      bridge,
      processCover: cover,
      wakeLock,
      storage: win.navigator?.storage,
      doc: win.document,
      bridgePollMs: o.bridgePollMs,
      onEvent: (e) => onImportEvent(e),
    });
    device = { library, importer, gateway, processCover: cover, bridge, lost };
    api = o.api ?? createDeviceBackend({ library, importer, gateway, auth: defaultApi.auth, db });
  }
  const dev = device;
  const isLocal = (id: string) => (dev ? dev.library.isLocal(id) : downloads.isDownloaded(id));

  const library = new Library(api, db);
  const catalog = new Catalog(api, library);
  const reporter = new PlayReporter({ api, db });
  const mediaSession = o.mediaSession ?? new MediaSessionBridge();
  const player = new Player({
    // Modalità client: si suonano solo brani sul dispositivo, più quelli in importazione
    // (`pending:<id>`) in streaming dal gateway quando c'è rete.
    downloads: {
      isDownloaded: (id) => (dev && id.startsWith('pending:') ? !connection.offline : isLocal(id)),
    },
    connection: dev ? { offline: true } : connection,
    resolveSrc: dev ? localFallbackSrc : undefined,
    toasts,
    reporter,
    mediaSession,
  });
  const session = new Session({
    api,
    db,
    onAuthenticated: () => void storage.requestPersistence(),
    beforeLogout: () => {
      spotify.clear();
      return reporter.flush();
    },
  });
  const spotify = new SpotifyModule(
    new SpotifyTransport(o.fetch),
    player,
    mediaSession,
    () => session.status === 'authenticated' && !session.offlineMode,
    {
      storage: win.localStorage,
      document: win.document,
      userId: () => session.user?.id,
      localTrack: async (id) =>
        connection.offline && !dev
          ? (await library.knownTracks([id]))[0]
          : api.tracks.get(id).catch(() => undefined),
      localAvailable: (track) => (dev ? isLocal(track.id) : !connection.offline || isLocal(track.id)),
    },
  );
  const deviceHybrid = new HybridRepository(db, () => session.user?.id);
  const hybrid = dev
    ? deviceHybrid
    : new HttpHybridRepository(
        <T>(path: string, options?: RequestInit) =>
          request<T>(
            (options?.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
            path,
            typeof options?.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined,
          ),
        {
          db,
          owner: () => session.user?.id,
          offline: () => connection.offline,
          status: (signal) => spotify.api.request<SpotifyStatusDto>('status', 'GET', undefined, {}, signal),
        },
      );
  spotify.onStatus = async (status) => {
    await hybrid.reconcile?.(status.linkState === 'unlinked' ? null : status.accountId, status.generation);
  };
  spotify.onUnlink = async (accountId) => {
    await hybrid.purgeSpotify?.(accountId);
  };
  player.beforePlay = spotify.beforeLocalPlay;
  player.onQueueReplaced = spotify.localQueueReplaced;
  player.onQueueCommand = spotify.localQueueCommand;
  player.onOccurrenceEnded = () => {
    if (
      !spotify.occurrences.length ||
      spotify.active ||
      spotify.occurrences[spotify.occurrenceIndex]?.ref.provider !== 'local'
    )
      return false;
    spotify.advanceOccurrence(true, true);
    return true;
  };
  mediaSession.localOwns = () => !spotify.active;
  const command = (action: 'resume' | 'pause' | 'previous' | 'next') =>
    void spotify
      .command({ action })
      .catch((error: unknown) =>
        toasts.error(error instanceof Error ? error.message : 'Spotify non disponibile'),
      );
  mediaSession.remoteHandlers = {
    play: () => command('resume'),
    pause: () => command('pause'),
    previous: () => command('previous'),
    next: () => command('next'),
    seekTo: (seconds) => {
      void spotify.command({ action: 'seek', positionMs: Math.round(seconds * 1000) }).catch(() => {});
    },
  };
  const jobs = new Jobs({
    api,
    toasts,
    // Modalità client: il brano importato è già sul dispositivo.
    onOwnTrackReady: dev
      ? () => {}
      : (track) => void downloads.download(track, { silent: true }).catch(() => {}),
    onTrackAdded: (track) => {
      library.trackAdded(track);
      player.replaceTrack(`pending:${track.sourceId}`, track);
    },
  });
  onImportEvent = (e) => jobs.handleEvent(e);
  const realtime: Realtime = dev
    ? noopRealtime
    : (o.realtime?.({ jobs }) ??
      new RealtimeClient({
        onEvent: (e) => jobs.handleEvent(e),
        onReconnect: () => void jobs.reload().catch(() => {}),
      }));

  setApiHooks({
    onUnauthenticated: () => session.expire(),
    onReachable: () => connection.markReachable(),
    onUnreachable: () => connection.markUnreachable(),
  });
  library.onTrackChanged((t) => player.updateTrack(t));
  // On-premise: la copertina dell'album di un brano scaricato resta disponibile offline.
  if (mode === 'onpremise') library.onTrackChanged((t) => void downloads.refreshCover(t));
  library.onTrackRemoved((id) => {
    player.removeTrack(id);
    if (!dev) void downloads.remove(id).catch(() => {});
  });
  connection.onBackOnline(() => {
    void reporter.flush();
    realtime.nudge();
    void jobs.reload().catch(() => {});
  });

  return {
    mode,
    health: o.health ?? null,
    api,
    db,
    connection,
    toasts,
    ui,
    router,
    session,
    storage,
    library,
    catalog,
    wakeLock,
    downloads,
    reporter,
    player,
    spotify,
    hybrid,
    deviceHybrid,
    jobs,
    realtime,
    device,
    isLocal,
  };
}

let current: Services | null = null;

export function services(): Services {
  current ??= createServices();
  return current;
}

export function setServices(s: Services | null): void {
  current = s;
}

/** Brani persi dal sistema: aggiorna l'elenco e avvisa l'utente. */
export async function reconcileDevice(s: Services): Promise<string[]> {
  if (!s.device) return [];
  const newly = await s.device.library.reconcile().catch(() => []);
  s.device.lost.ids = s.device.library.lostTracks().map((t) => t.id);
  if (newly.length > 0) {
    s.toasts.error(
      `${newly.length === 1 ? 'Un brano è stato eliminato' : `${newly.length} brani sono stati eliminati`} dal sistema per liberare spazio. Puoi riscaricarli o ripristinare un backup.`,
    );
  }
  return newly;
}

/** Avvio dopo l'autenticazione. */
export async function startAuthenticated(s: Services): Promise<void> {
  void s.spotify.refresh();
  if (s.device) {
    await s.device.library.ready().catch(() => {});
    await reconcileDevice(s);
    s.device.library.onChange = () => {
      if (s.device) s.device.lost.ids = s.device.library.lostTracks().map((t) => t.id);
    };
    s.device.importer.init().catch(() => {});
    scheduleSilenceBacklog(s);
    startCoverLookup(s);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (!document.hidden) void reconcileDevice(s);
    });
  } else {
    await s.downloads.init().catch(() => {});
  }
  s.player.restore();
  void s.storage.requestPersistence();
  void s.reporter.flush();
  s.realtime.start();
  void s.jobs.reload().catch(() => {});
}

/** Auto-trim dei brani già sul dispositivo, poco dopo l'avvio per non rallentarlo. */
const SILENCE_BACKLOG_DELAY_MS = 5000;
let silenceBacklog: { timer: ReturnType<typeof setTimeout>; abort: AbortController } | null = null;

function scheduleSilenceBacklog(s: Services): void {
  const device = s.device;
  if (!device) return;
  const abort = new AbortController();
  const timer = setTimeout(async () => {
    const analyzed = await device.library.analyzeSilenceBacklog(abort.signal).catch(() => 0);
    if (!analyzed || abort.signal.aborted) return;
    // La coda in riproduzione usa subito i nuovi punti di trim.
    for (const id of Object.keys(s.player.tracks)) {
      const r = device.library.record(id);
      if (r) s.player.updateTrack(device.library.toDto(r));
    }
  }, SILENCE_BACKLOG_DELAY_MS);
  silenceBacklog = { timer, abort };
}

/** Ricerca automatica delle copertine per gli album del dispositivo senza copertina. */
let stopCoverLookup: (() => void) | null = null;

function startCoverLookup(s: Services): void {
  const device = s.device;
  if (!device) return;
  stopCoverLookup?.();
  stopCoverLookup = scheduleCoverLookup(device.library, device.gateway, {
    enabled: async () => (await catalogSettings(await device.library.database())).coverLookup,
    // Album aperti, elenco degli album e coda in riproduzione mostrano subito le nuove copertine.
    onApplied: () => {
      void s.catalog.refresh();
      for (const id of Object.keys(s.player.tracks)) {
        const r = device.library.record(id);
        if (r) s.player.updateTrack(device.library.toDto(r));
      }
    },
  });
}

export function stopAuthenticated(s: Services): void {
  s.spotify.clear();
  stopCoverLookup?.();
  stopCoverLookup = null;
  if (silenceBacklog) {
    clearTimeout(silenceBacklog.timer);
    silenceBacklog.abort.abort();
    silenceBacklog = null;
  }
  s.realtime.stop();
  s.device?.importer.stop();
  s.player.stop();
}
