import { Router, matchRoute, pathOf, safeNext } from './router.svelte';

const waitPop = () =>
  new Promise<void>((r) => window.addEventListener('popstate', () => setTimeout(r, 0), { once: true }));

describe('matchRoute', () => {
  test.each([
    ['/', 'home', {}],
    ['/search', 'search', {}],
    ['/library', 'library', {}],
    ['/library/downloaded', 'downloaded', {}],
    ['/playlist/01ABC', 'playlist', { id: '01ABC' }],
    ['/favorites/', 'favorites', {}],
    ['/settings', 'settings', {}],
    ['/login?next=%2Fsearch', 'login', {}],
    ['/register', 'register', {}],
    ['/sconosciuta', 'home', {}],
  ])('%s → %s', (url, name, params) => {
    const r = matchRoute(url);
    expect(r.name).toBe(name);
    expect(r.params).toEqual(params);
  });
});

test('safeNext accetta solo percorsi interni', () => {
  expect(safeNext('?next=%2Fplaylist%2Fabc')).toBe('/playlist/abc');
  expect(safeNext('?next=https%3A%2F%2Fevil.example')).toBe('/');
  expect(safeNext('?next=%2F%2Fevil.example')).toBe('/');
  expect(safeNext('')).toBe('/');
  expect(pathOf.login('/playlist/abc')).toBe('/login?next=%2Fplaylist%2Fabc');
});

describe('Router', () => {
  let router: Router;
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    router = new Router(window);
  });
  afterEach(() => router.destroy());

  test('navigazione e Indietro', async () => {
    router.navigate('/library');
    expect(router.route.name).toBe('library');
    expect(window.location.pathname).toBe('/library');
    router.navigate('/playlist/p1');
    expect(router.route).toMatchObject({ name: 'playlist', params: { id: 'p1' } });

    const popped = waitPop();
    window.history.back();
    await popped;
    expect(router.route.name).toBe('library');
  });

  test('apertura diretta di un URL', () => {
    router.destroy();
    window.history.replaceState(null, '', '/playlist/xyz');
    router = new Router(window);
    expect(router.route).toMatchObject({ name: 'playlist', params: { id: 'xyz' } });
  });

  test('il player a schermo intero si chiude con Indietro senza cambiare vista', async () => {
    router.navigate('/search');
    router.openOverlay('player');
    expect(router.overlay).toBe('player');
    expect(window.location.pathname).toBe('/search');
    const popped = waitPop();
    router.closeOverlay();
    await popped;
    expect(router.overlay).toBeNull();
    expect(router.route.name).toBe('search');
  });

  test('salva e ripristina la posizione di scorrimento per voce', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    router.navigate('/library');
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
    router.navigate('/playlist/p1');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const popped = waitPop();
    window.history.back();
    await popped;
    expect(router.savedScroll()).toBe(640);
    await new Promise((r) => setTimeout(r, 50));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 640 }));
    scrollTo.mockRestore();
  });
});
