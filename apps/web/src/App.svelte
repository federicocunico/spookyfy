<script lang="ts">
import BulkDownloadBar from './components/BulkDownloadBar.svelte';
import Dialogs from './components/Dialogs.svelte';
import FullPlayer from './components/FullPlayer.svelte';
import MiniPlayer from './components/MiniPlayer.svelte';
import OfflineBanner from './components/OfflineBanner.svelte';
import QueueSheet from './components/QueueSheet.svelte';
import TabBar from './components/TabBar.svelte';
import Toasts from './components/Toasts.svelte';
import TrackMenu from './components/TrackMenu.svelte';
import UpdatePrompt from './components/UpdatePrompt.svelte';
import { pwa } from './lib/pwa.svelte';
import { PUBLIC_ROUTES, pathOf, safeNext } from './lib/router.svelte';
import { services, startAuthenticated, stopAuthenticated } from './lib/services.svelte';
import DownloadedView from './views/DownloadedView.svelte';
import FavoritesView from './views/FavoritesView.svelte';
import HomeView from './views/HomeView.svelte';
import LibraryView from './views/LibraryView.svelte';
import LoginView from './views/LoginView.svelte';
import PlaylistView from './views/PlaylistView.svelte';
import RegisterView from './views/RegisterView.svelte';
import SearchView from './views/SearchView.svelte';
import SettingsView from './views/SettingsView.svelte';

const s = services();
const { session, router, player } = s;
const route = $derived(router.route);
const isPublic = $derived(PUBLIC_ROUTES.has(route.name));

// L'unico elemento audio dell'app: vive nel DOM radice e non viene mai smontato.
let audio: HTMLAudioElement | undefined = $state();
$effect(() => {
  if (!audio) return;
  player.attach(audio);
  return () => player.detach();
});

$effect(() => {
  void session.init();
  const onHide = () => player.flush();
  window.addEventListener('pagehide', onHide);
  return () => window.removeEventListener('pagehide', onHide);
});

// Avvio e arresto dei servizi legati all'utente.
let started = false;
$effect(() => {
  if (session.status === 'authenticated' && !started) {
    started = true;
    void startAuthenticated(s);
  } else if (session.status === 'anonymous' && started) {
    started = false;
    stopAuthenticated(s);
  }
});

// Protezione delle rotte: senza sessione si va al login ricordando la destinazione.
$effect(() => {
  const status = session.status;
  const r = router.route;
  if (status === 'anonymous' && !PUBLIC_ROUTES.has(r.name)) {
    router.navigate(pathOf.login(r.path + r.search), { replace: true });
  } else if (status === 'authenticated' && PUBLIC_ROUTES.has(r.name)) {
    router.navigate(safeNext(r.search), { replace: true });
  }
});
</script>

<audio bind:this={audio} preload="auto" crossorigin="use-credentials"></audio>

{#if session.status === 'unknown'}
  <div class="splash" aria-busy="true" aria-label="Caricamento">
    <img src="/icons/icon-192.png" alt="" width="96" height="96" />
  </div>
{:else if session.status === 'anonymous' || isPublic}
  {#if route.name === 'register'}
    <RegisterView />
  {:else}
    <LoginView />
  {/if}
{:else}
  <OfflineBanner />
  <BulkDownloadBar />
  <main>
    {#if route.name === 'home'}
      <HomeView />
    {:else if route.name === 'search'}
      <SearchView />
    {:else if route.name === 'library'}
      <LibraryView />
    {:else if route.name === 'downloaded'}
      <DownloadedView />
    {:else if route.name === 'favorites'}
      <FavoritesView />
    {:else if route.name === 'playlist'}
      {#key route.params.id}
        <PlaylistView id={route.params.id ?? ''} />
      {/key}
    {:else if route.name === 'settings'}
      <SettingsView />
    {/if}
  </main>
  <MiniPlayer />
  <TabBar />
  <FullPlayer />
  <TrackMenu />
  <QueueSheet />
  <Dialogs />
{/if}

<Toasts />
<UpdatePrompt update={pwa.update} />

<style>
  .splash {
    min-height: 100dvh;
    display: grid;
    place-items: center;
  }
  .splash img {
    border-radius: 22px;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.5;
    }
  }
</style>
