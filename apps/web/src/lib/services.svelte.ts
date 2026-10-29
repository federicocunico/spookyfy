import type { BackendMode, HealthDto, WsServerEvent } from '@spookyfy/shared';
import { type Api, api as defaultApi, setApiHooks } from './api';
import { createDeviceBackend } from './device/backend';
import { getSettings } from './device/backup';
import { type CoverProcessor, processCover } from './device/cover';
import { DeviceImporter } from './device/importer';
import { DeviceLibrary, localFallbackSrc } from './device/library';
import { BridgeClient, GatewayClient } from './device/remote';
import { type Db, getDb } from './offline/db';
import { Downloads } from './offline/downloads.svelte';
import { StorageStatus } from './offline/storage.svelte';
import { WakeLockController } from './offline/wakelock';
import { MediaSessionBridge } from './player/media-session';
import { PlayReporter } from './player/play-reporter';
import { Player } from './player/player.svelte';
import { RealtimeClient } from './realtime/ws';
import { Router } from './router.svelte';
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
  wakeLock: WakeLockController;
  downloads: Downloads;
  reporter: PlayReporter;
  player: Player;
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
    const library = new DeviceLibrary({ db });
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
    api = o.api ?? createDeviceBackend({ library, importer, gateway, auth: defaultApi.auth });
  }
  const dev = device;
  const isLocal = (id: string) => (dev ? dev.library.isLocal(id) : downloads.isDownloaded(id));

  const library = new Library(api, db);
  const reporter = new PlayReporter({ api, db });
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
    mediaSession: o.mediaSession ?? new MediaSessionBridge(),
  });
  const session = new Session({
    api,
    db,
    onAuthenticated: () => void storage.requestPersistence(),
    beforeLogout: () => reporter.flush(),
  });
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
    wakeLock,
    downloads,
    reporter,
    player,
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
  if (s.device) {
    await s.device.library.ready().catch(() => {});
    await reconcileDevice(s);
    s.device.library.onChange = () => {
      if (s.device) s.device.lost.ids = s.device.library.lostTracks().map((t) => t.id);
    };
    s.device.importer.init().catch(() => {});
    scheduleSilenceBacklog(s);
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

export function stopAuthenticated(s: Services): void {
  if (silenceBacklog) {
    clearTimeout(silenceBacklog.timer);
    silenceBacklog.abort.abort();
    silenceBacklog = null;
  }
  s.realtime.stop();
  s.device?.importer.stop();
  s.player.stop();
}
