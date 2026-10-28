import { type Api, api as defaultApi, setApiHooks } from './api';
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

export interface Services {
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
  realtime: RealtimeClient;
}

export interface ServiceOverrides {
  api?: Api;
  db?: () => Promise<Db>;
  window?: Window;
  mediaSession?: MediaSessionBridge;
  realtime?: (s: Pick<Services, 'jobs'>) => RealtimeClient;
}

/** Crea e collega tutti gli store dell'app (anche nei test, con dipendenze finte). */
export function createServices(o: ServiceOverrides = {}): Services {
  const api = o.api ?? defaultApi;
  const db = o.db ?? getDb;
  const win = o.window ?? window;
  const connection = new Connection(win);
  const toasts = new Toasts();
  const ui = new Ui();
  const router = new Router(win);
  const storage = new StorageStatus();
  const library = new Library(api, db);
  const wakeLock = new WakeLockController(win.navigator, win.document);
  const downloads = new Downloads({ db, toasts, wakeLock, doc: win.document });
  const reporter = new PlayReporter({ api, db });
  const player = new Player({
    downloads,
    connection,
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
    onOwnTrackReady: (track) => void downloads.download(track, { silent: true }).catch(() => {}),
    onTrackAdded: (track) => {
      if (library.recentlyAdded)
        library.recentlyAdded = [track, ...library.recentlyAdded.filter((t) => t.id !== track.id)];
    },
  });
  const realtime =
    o.realtime?.({ jobs }) ??
    new RealtimeClient({
      onEvent: (e) => jobs.handleEvent(e),
      onReconnect: () => void jobs.reload().catch(() => {}),
    });

  setApiHooks({
    onUnauthenticated: () => session.expire(),
    onReachable: () => connection.markReachable(),
    onUnreachable: () => connection.markUnreachable(),
  });
  library.onTrackChanged((t) => player.updateTrack(t));
  library.onTrackRemoved((id) => {
    player.removeTrack(id);
    void downloads.remove(id).catch(() => {});
  });
  connection.onBackOnline(() => {
    void reporter.flush();
    realtime.nudge();
    void jobs.reload().catch(() => {});
  });

  return {
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

/** Avvio dopo l'autenticazione: download, coda, canale in tempo reale, ascolti in attesa. */
export async function startAuthenticated(s: Services): Promise<void> {
  await s.downloads.init().catch(() => {});
  s.player.restore();
  void s.storage.requestPersistence();
  void s.reporter.flush();
  s.realtime.start();
  void s.jobs.reload().catch(() => {});
}

export function stopAuthenticated(s: Services): void {
  s.realtime.stop();
  s.player.stop();
}
