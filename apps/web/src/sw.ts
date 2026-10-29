/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { createPartialResponse } from 'workbox-range-requests';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope;

// Nomi condivisi con src/lib/offline/downloads.svelte.ts.
const AUDIO_CACHE = 'spk-audio-v1';
const OFFLINE_COVER_CACHE = 'spk-covers-offline-v1';
const COVER_CACHE = 'spk-covers-v1';

// Alla prima installazione prende subito il controllo della pagina già aperta: senza, in
// modalità client i brani sul dispositivo (/local/*) non suonerebbero fino a una ricarica.
// Gli aggiornamenti restano in attesa del consenso (registerType: prompt), quindi è sicuro.
clientsClaim();

// App shell disponibile offline.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api(\/|$)/] }));

const sameOrigin = (url: URL) => url.origin === self.location.origin;
const AUDIO_PATH = /^\/api\/tracks\/[^/]+\/audio$/;
// Copertine dei brani e quelle assegnate agli album (mostrate anche dai brani dell'album).
const COVER_PATH = /^\/api\/(tracks|albums)\/[^/]+\/cover$/;

/**
 * Audio: se il brano è scaricato lo si serve dalla cache, ritagliando le
 * richieste Range (WebKit chiede sempre `bytes=0-1` e poi intervalli) con una
 * risposta 206; altrimenti si passa alla rete (streaming). Se l'OS ha svuotato
 * la cache si torna automaticamente allo streaming.
 */
registerRoute(
  ({ url, request }) => sameOrigin(url) && request.method === 'GET' && AUDIO_PATH.test(url.pathname),
  async ({ request }) => {
    const cache = await caches.open(AUDIO_CACHE);
    const cached = await cache.match(request.url);
    if (!cached) return fetch(request);
    if (request.headers.has('range')) return createPartialResponse(request, cached);
    return cached;
  },
);

// Copertine: quelle dei brani scaricati restano sempre disponibili; le altre in cache a rotazione.
const coverStrategy = new StaleWhileRevalidate({
  cacheName: COVER_CACHE,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
    new ExpirationPlugin({ maxEntries: 400, purgeOnQuotaError: true }),
  ],
});
registerRoute(
  ({ url, request }) => sameOrigin(url) && request.method === 'GET' && COVER_PATH.test(url.pathname),
  async (options) => {
    const offline = await (await caches.open(OFFLINE_COVER_CACHE)).match(options.request.url);
    return offline ?? coverStrategy.handle(options);
  },
);

// Modalità client: libreria sul dispositivo sotto URL sintetici /local/*. Solo cache,
// con risposte 206 per l'<audio>; 404 se il file è stato eliminato dal sistema.
const DEVICE_AUDIO_CACHE = 'spk-device-audio-v1';
const DEVICE_COVER_CACHE = 'spk-device-covers-v1';
registerRoute(
  ({ url, request }) => sameOrigin(url) && request.method === 'GET' && url.pathname.startsWith('/local/'),
  async ({ request, url }) => {
    const cacheName = url.pathname.startsWith('/local/audio/') ? DEVICE_AUDIO_CACHE : DEVICE_COVER_CACHE;
    const cached = await (await caches.open(cacheName)).match(request.url);
    if (!cached) return new Response(null, { status: 404 });
    if (request.headers.has('range')) return createPartialResponse(request, cached);
    return cached;
  },
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
