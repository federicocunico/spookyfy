export type RouteName =
  | 'home'
  | 'search'
  | 'library'
  | 'downloaded'
  | 'albums'
  | 'genres'
  | 'album'
  | 'genre'
  | 'playlist'
  | 'favorites'
  | 'settings'
  | 'login'
  | 'register';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  path: string;
  search: string;
}

/** Sovrapposizioni con una propria voce di cronologia: "Indietro" le chiude. */
export type Overlay = 'player';

const TABLE: [RouteName, RegExp][] = [
  ['home', /^\/$/],
  ['search', /^\/search$/],
  ['library', /^\/library$/],
  ['downloaded', /^\/library\/downloaded$/],
  ['albums', /^\/library\/albums$/],
  ['genres', /^\/library\/genres$/],
  ['album', /^\/album\/(?<id>[^/]+)$/],
  ['genre', /^\/genre\/(?<name>[^/]+)$/],
  ['favorites', /^\/favorites$/],
  ['playlist', /^\/playlist\/(?<id>[^/]+)$/],
  ['settings', /^\/settings$/],
  ['login', /^\/login$/],
  ['register', /^\/register$/],
];

export const PUBLIC_ROUTES: ReadonlySet<RouteName> = new Set(['login', 'register']);

export function matchRoute(url: string): Route {
  const u = new URL(url, 'http://spookyfy.local');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  for (const [name, re] of TABLE) {
    const m = re.exec(path);
    if (m) {
      const params = Object.fromEntries(
        Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]),
      );
      return { name, params, path, search: u.search };
    }
  }
  return { name: 'home', params: {}, path: '/', search: '' };
}

export const pathOf = {
  home: () => '/',
  search: () => '/search',
  library: () => '/library',
  downloaded: () => '/library/downloaded',
  albums: () => '/library/albums',
  genres: () => '/library/genres',
  album: (id: string) => `/album/${encodeURIComponent(id)}`,
  genre: (name: string) => `/genre/${encodeURIComponent(name)}`,
  favorites: () => '/favorites',
  playlist: (id: string) => `/playlist/${encodeURIComponent(id)}`,
  settings: () => '/settings',
  login: (next?: string) => (next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'),
  register: (next?: string) =>
    next && next !== '/' ? `/register?next=${encodeURIComponent(next)}` : '/register',
};

/** Destinazione dopo il login: solo percorsi interni, mai URL esterni. */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

interface HistoryState {
  key: string;
  overlay?: Overlay;
}

const SCROLL_STORAGE = 'spk-scroll';
const newKey = () => Math.random().toString(36).slice(2, 10);

export class Router {
  route = $state<Route>({ name: 'home', params: {}, path: '/', search: '' });
  overlay = $state<Overlay | null>(null);
  private scroll = new Map<string, number>();

  constructor(private readonly win: Window = window) {
    try {
      const saved = JSON.parse(win.sessionStorage.getItem(SCROLL_STORAGE) ?? '{}') as Record<string, number>;
      this.scroll = new Map(Object.entries(saved));
    } catch {}
    const state = win.history.state as HistoryState | null;
    if (!state?.key)
      win.history.replaceState({ key: newKey() } satisfies HistoryState, '', win.location.href);
    this.route = matchRoute(win.location.pathname + win.location.search);
    // Un'eventuale sovrapposizione aperta prima del ricaricamento non viene ripristinata.
    if (state?.overlay) win.history.replaceState({ key: this.key }, '', win.location.href);
    win.addEventListener('popstate', this.onPopState);
  }

  private get key(): string {
    return (this.win.history.state as HistoryState | null)?.key ?? 'root';
  }

  private saveScroll(): void {
    this.scroll.set(this.key, this.win.scrollY);
    try {
      this.win.sessionStorage.setItem(SCROLL_STORAGE, JSON.stringify(Object.fromEntries(this.scroll)));
    } catch {}
  }

  /** Posizione di scorrimento salvata per la voce corrente (0 se nuova). */
  savedScroll(): number {
    return this.scroll.get(this.key) ?? 0;
  }

  navigate(path: string, { replace = false } = {}): void {
    const current = this.win.location.pathname + this.win.location.search;
    if (path === current && !this.overlay && !replace) return;
    this.saveScroll();
    const state: HistoryState = { key: newKey() };
    if (replace) this.win.history.replaceState(state, '', path);
    else this.win.history.pushState(state, '', path);
    this.overlay = null;
    this.route = matchRoute(path);
    this.restoreScroll(0);
  }

  back(fallback = '/'): void {
    if (this.win.history.length > 1) this.win.history.back();
    else this.navigate(fallback, { replace: true });
  }

  openOverlay(overlay: Overlay): void {
    if (this.overlay === overlay) return;
    this.win.history.pushState({ key: this.key, overlay } satisfies HistoryState, '', this.win.location.href);
    this.overlay = overlay;
  }

  closeOverlay(): void {
    if (!this.overlay) return;
    if ((this.win.history.state as HistoryState | null)?.overlay) this.win.history.back();
    else this.overlay = null;
  }

  private onPopState = (e: PopStateEvent): void => {
    const state = e.state as HistoryState | null;
    const next = matchRoute(this.win.location.pathname + this.win.location.search);
    const routeChanged = next.path !== this.route.path || next.search !== this.route.search;
    this.overlay = state?.overlay ?? null;
    if (routeChanged) {
      this.route = next;
      this.restoreScroll(this.savedScroll());
    }
  };

  /** Dopo il render della nuova vista (i dati in cache sono già disponibili). */
  private restoreScroll(y: number): void {
    const raf =
      this.win.requestAnimationFrame?.bind(this.win) ?? ((cb: FrameRequestCallback) => setTimeout(cb, 0));
    raf(() => raf(() => this.win.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })));
  }

  destroy(): void {
    this.win.removeEventListener('popstate', this.onPopState);
  }
}

let instance: Router | undefined;
export function getRouter(): Router {
  instance ??= new Router();
  return instance;
}
