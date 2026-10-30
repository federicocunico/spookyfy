<script lang="ts">
import type {
  HybridPlaylistDto,
  PlayableOccurrence,
  SpotifyDetailDto,
  SpotifyTrackDto,
  TrackDto,
} from '@spookyfy/shared';
import BulkDownloadBar from './components/BulkDownloadBar.svelte';
import CatalogDialogs from './components/CatalogDialogs.svelte';
import Dialogs from './components/Dialogs.svelte';
import FullPlayer from './components/FullPlayer.svelte';
import MiniPlayer from './components/MiniPlayer.svelte';
import OfflineBanner from './components/OfflineBanner.svelte';
import QueueSheet from './components/QueueSheet.svelte';
import SpotifyPlayer from './components/SpotifyPlayer.svelte';
import TabBar from './components/TabBar.svelte';
import Toasts from './components/Toasts.svelte';
import TrackMenu from './components/TrackMenu.svelte';
import UpdatePrompt from './components/UpdatePrompt.svelte';
import { pwa } from './lib/pwa.svelte';
import { PUBLIC_ROUTES, pathOf, safeNext } from './lib/router.svelte';
import { services, startAuthenticated, stopAuthenticated } from './lib/services.svelte';
import AlbumView from './views/AlbumView.svelte';
import DownloadedView from './views/DownloadedView.svelte';
import FavoritesView from './views/FavoritesView.svelte';
import GenreView from './views/GenreView.svelte';
import HomeView from './views/HomeView.svelte';
import HybridPlaylistsView from './views/HybridPlaylistsView.svelte';
import LibraryView from './views/LibraryView.svelte';
import LoginView from './views/LoginView.svelte';
import PlaylistView from './views/PlaylistView.svelte';
import RegisterView from './views/RegisterView.svelte';
import SearchView from './views/SearchView.svelte';
import SettingsView from './views/SettingsView.svelte';
import SpotifyView from './views/SpotifyView.svelte';

const s = services();
const { session, router, player } = s;
const route = $derived(router.route);
const isPublic = $derived(PUBLIC_ROUTES.has(route.name));
let collectionTracks = $state<TrackDto[]>([]);
let remoteLabels = $state<Record<string, string>>({});
let collectionOccurrences = new Map<string, PlayableOccurrence[]>();
let collectionUser: string | undefined;
let collectionRevision = $state(0);
$effect(() => {
  if (route.name !== 'hybrid' || session.status !== 'authenticated') return;
  collectionRevision;
  s.spotify.status?.generation;
  s.spotify.status?.accountId;
  s.connection.offline;
  const user = session.user?.id;
  if (user !== collectionUser) {
    collectionTracks = [];
    remoteLabels = {};
    collectionOccurrences = new Map();
    collectionUser = user;
  }
  let cancelled = false;
  const prepare = async () => {
    const collections = await s.hybrid.list();
    const localIds = collections.flatMap((playlist) =>
      playlist.items.flatMap((item) => (item.ref.provider === 'local' ? [item.ref.trackId] : [])),
    );
    const tracks: TrackDto[] = await s.library.knownTracks(localIds);
    let cursor: string | null = null;
    if (s.device || !s.connection.offline)
      do {
        const page = await s.api.tracks.list({ limit: 100, ...(cursor ? { cursor } : {}) });
        for (const track of page.items) if (!tracks.some((old) => old.id === track.id)) tracks.push(track);
        cursor = page.nextCursor;
      } while (cursor && tracks.length < 10000 && !cancelled);
    if (cancelled || session.user?.id !== user) return;
    collectionTracks = tracks;
    if (!s.device) {
      const tx = (await s.db()).transaction('tracks', 'readwrite');
      for (const track of tracks) await tx.store.put(track);
      await tx.done;
    }
    await s.library.loadPlaylists().catch(() => {});
    const labels: Record<string, string> = {};
    const resolved = new Map<string, PlayableOccurrence[]>();
    for (const playlist of collections) {
      const occurrences: PlayableOccurrence[] = [];
      for (const item of playlist.items) {
        const base = { occurrenceId: item.itemId, ref: item.ref };
        if (item.ref.provider === 'local') {
          const id = item.ref.trackId;
          occurrences.push({
            ...base,
            local: item.inert ? undefined : tracks.find((track) => track.id === id),
          });
          continue;
        }
        if (
          s.connection.offline ||
          item.inert ||
          item.spotifyAccountId !== s.spotify.status?.accountId ||
          !s.spotify.status?.capabilities.canBrowse
        ) {
          occurrences.push(base);
          continue;
        }
        const response = await s.spotify.api
          .request<SpotifyDetailDto>('detail', 'GET', undefined, {
            type: 'track',
            id: item.ref.uri.split(':')[2]!,
          })
          .catch(() => null);
        const track = response?.entity.kind === 'track' ? (response.entity as SpotifyTrackDto) : undefined;
        if (track) labels[item.ref.uri] = `${track.name} - ${track.artists.join(', ')}`;
        occurrences.push({ ...base, spotify: track });
      }
      resolved.set(playlist.id, occurrences);
    }
    if (!cancelled && session.user?.id === user) {
      remoteLabels = labels;
      collectionOccurrences = resolved;
    }
  };
  void prepare().catch(() => {});
  const unsubscribe = s.hybrid.subscribe?.(() => {
    collectionRevision++;
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
});

async function playCollection(playlist: HybridPlaylistDto) {
  if (
    playlist.items.every((item) => item.ref.provider === 'local') ||
    s.connection.offline ||
    !s.spotify.status?.capabilities.canHybridPlayback
  ) {
    const tracks = playlist.items.flatMap((item) => {
      const ref = item.ref;
      return ref.provider === 'local' && !item.inert
        ? collectionTracks.filter(
            (track) => track.id === ref.trackId && (!s.connection.offline || s.isLocal(track.id)),
          )
        : [];
    });
    const excluded = playlist.items.filter((item) => item.ref.provider === 'spotify').length;
    if (excluded)
      s.toasts.show(`${excluded} elementi Spotify esclusi; riproduzione dei file locali disponibili`);
    s.player.playTracks(tracks);
    return;
  }
  const prepared = collectionOccurrences.get(playlist.id);
  if (
    prepared &&
    prepared.length === playlist.items.length &&
    prepared.every((item, i) => item.occurrenceId === playlist.items[i]?.itemId)
  ) {
    s.spotify.playOccurrences(prepared);
    return;
  }
  const occurrences: PlayableOccurrence[] = await Promise.all(
    playlist.items.map(async (item) => {
      const base = { occurrenceId: item.itemId, ref: item.ref };
      if (item.inert) return base;
      if (item.ref.provider === 'local')
        return { ...base, local: await s.api.tracks.get(item.ref.trackId).catch(() => undefined) };
      if (item.spotifyAccountId !== s.spotify.status?.accountId) return base;
      const response = await s.spotify.api
        .request<SpotifyDetailDto>('detail', 'GET', undefined, {
          type: 'track',
          id: item.ref.uri.split(':')[2]!,
        })
        .catch(() => null);
      return {
        ...base,
        spotify: response?.entity.kind === 'track' ? (response.entity as SpotifyTrackDto) : undefined,
      };
    }),
  );
  s.spotify.playOccurrences(occurrences);
}

function downloadCollection(playlist: HybridPlaylistDto) {
  const tracks = playlist.items.flatMap((item) => {
    const ref = item.ref;
    return ref.provider === 'local' && !item.inert
      ? collectionTracks.filter((track) => track.id === ref.trackId)
      : [];
  });
  const excluded = playlist.items.filter((item) => item.ref.provider === 'spotify').length;
  s.toasts.show(`${tracks.length} file locali; ${excluded} elementi Spotify esclusi dal download`);
  if (!s.device) void s.downloads.downloadAll(tracks);
}
async function reconcileCollectionReferences() {
  const status = s.spotify.status;
  if (!status?.accountId || !s.device) return;
  await s.deviceHybrid.reconcile(status.accountId, status.generation, true);
  collectionRevision++;
}

// L'unico elemento audio dell'app: vive nel DOM radice e non viene mai smontato.
let audio: HTMLAudioElement | undefined = $state();
$effect(() => {
  if (!audio) return;
  player.attach(audio);
  return () => player.detach();
});

$effect(() => {
  void session.init();
  const onHide = () => {
    player.flush();
    s.spotify.flush();
  };
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
      <LibraryView view="playlists" />
    {:else if route.name === 'albums'}
      <LibraryView view="albums" />
    {:else if route.name === 'genres'}
      <LibraryView view="genres" />
    {:else if route.name === 'album'}
      {#key route.params.id}
        <AlbumView id={route.params.id ?? ''} />
      {/key}
    {:else if route.name === 'genre'}
      {#key route.params.name}
        <GenreView name={route.params.name ?? ''} />
      {/key}
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
    {:else if route.name === 'spotify'}
      <SpotifyView />
    {:else if route.name === 'hybrid'}
      <HybridPlaylistsView repository={s.hybrid} accountId={s.spotify.status?.accountId} localTracks={collectionTracks} {remoteLabels} legacyPlaylists={s.library.playlists ?? []} onplay={(playlist) => void playCollection(playlist)} ondownload={downloadCollection} onreconcile={s.device ? () => void reconcileCollectionReferences() : undefined} />
    {/if}
    <SpotifyPlayer />
  </main>
  <MiniPlayer />
  <TabBar />
  <FullPlayer />
  <TrackMenu />
  <QueueSheet />
  <Dialogs />
  <CatalogDialogs />
{/if}

<Toasts />
<UpdatePrompt update={pwa.update} />

<style>
  /* Su PC lascia spazio alla colonna di navigazione (vedi --sidebar-w in app.css). */
  main {
    padding-left: var(--sidebar-w);
  }
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
