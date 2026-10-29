import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

// Blob e File di Node: compatibili con Response/fetch di Node (quelli di jsdom verrebbero
// serializzati come la stringa "[object Blob]" dentro una Response).
globalThis.Blob = NodeBlob as unknown as typeof Blob;
globalThis.File = NodeFile as unknown as typeof File;

// API del browser non implementate da jsdom.
window.scrollTo = () => {};
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: function play(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: function pause(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
    this.dispatchEvent(new Event('pause'));
  },
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  writable: true,
  value: () => {},
});

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom non implementa PointerEvent: senza, clientX/clientY andrebbero persi.
if (!globalThis.PointerEvent) {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  } as unknown as typeof PointerEvent;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// jsdom non espone le Cache API: implementazione minima in memoria per i test.
if (!globalThis.caches) {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (req: RequestInfo | URL) =>
    new URL(typeof req === 'string' ? req : req instanceof URL ? req.href : req.url, 'http://localhost').href;
  const open = async (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    const s = store;
    return {
      match: async (req: RequestInfo | URL) => s.get(keyOf(req))?.clone(),
      put: async (req: RequestInfo | URL, res: Response) => void s.set(keyOf(req), res),
      delete: async (req: RequestInfo | URL) => s.delete(keyOf(req)),
      keys: async () => [...s.keys()].map((k) => new Request(k)),
    } as unknown as Cache;
  };
  globalThis.caches = {
    open,
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    match: async (req: RequestInfo | URL) => {
      for (const s of stores.values()) {
        const r = s.get(keyOf(req));
        if (r) return r.clone();
      }
      return undefined;
    },
  } as unknown as CacheStorage;
}

// Come in produzione: la pagina è controllata dal Service Worker, che serve gli URL /local/*.
// I test della riserva senza Service Worker tolgono `controller` per il loro caso.
if (!('serviceWorker' in navigator)) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { controller: {} },
    configurable: true,
  });
}
