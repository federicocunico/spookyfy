<script lang="ts">
import type { TrackDto } from '@spookyfy/shared';
import { untrack } from 'svelte';
import DeviceNotices from '../components/DeviceNotices.svelte';
import Icon from '../components/Icon.svelte';
import ImportFilesButton from '../components/ImportFilesButton.svelte';
import PlaylistCover from '../components/PlaylistCover.svelte';
import Skeleton from '../components/Skeleton.svelte';
import TrackRow from '../components/TrackRow.svelte';
import { formatLongDuration, pluralize } from '../lib/format';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

const { library, router, ui, toasts, api, player, downloads, connection, mode } = services();
// In modalità client la libreria è sul dispositivo: nuove playlist anche offline.
const needsNetwork = mode === 'onpremise';

let all = $state<TrackDto[] | null>(null);
let cursor = $state<string | null>(null);
let loadingMore = $state(false);
let sentinel: HTMLElement | undefined = $state();

// Caricamento iniziale una sola volta: untrack evita che lo stato letto dentro i
// caricamenti (cursore, loadingMore) riattivi l'effetto in un ciclo infinito.
$effect(() => {
  untrack(() => {
    void library.loadPlaylists().catch(() => {});
    void library.loadFavorites().catch(() => {});
    void loadMore(true);
  });
});

async function loadMore(reset = false) {
  if (loadingMore || (!reset && !cursor)) return;
  loadingMore = true;
  try {
    const page = await api.tracks.list({
      sort: 'added',
      limit: 50,
      cursor: reset ? undefined : (cursor ?? undefined),
    });
    all = reset ? page.items : [...(all ?? []), ...page.items];
    cursor = page.nextCursor;
  } catch {
    all ??= [];
  } finally {
    loadingMore = false;
  }
}

// Scorrimento infinito sulla lista di tutti i brani.
$effect(() => {
  if (!sentinel) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void loadMore();
  });
  io.observe(sentinel);
  return () => io.disconnect();
});

function newPlaylist() {
  ui.prompt = {
    title: 'Nuova playlist',
    label: 'Nome della playlist',
    value: '',
    confirmLabel: 'Crea',
    submit: async (name) => {
      const p = await library.createPlaylist(name);
      toasts.show(`Playlist «${p.name}» creata`);
      router.navigate(pathOf.playlist(p.id));
    },
  };
}

function go(e: MouseEvent, path: string) {
  e.preventDefault();
  router.navigate(path);
}
</script>

<div class="page">
  <header class="top">
    <h1 class="page-title">La tua Libreria</h1>
    <div class="actions">
      {#if mode === 'client'}<ImportFilesButton variant="icon" />{/if}
      <button
        class="icon-btn"
        aria-label="Nuova playlist"
        onclick={newPlaylist}
        disabled={needsNetwork && connection.offline}
      >
        <Icon name="plus" />
      </button>
      <button class="icon-btn" aria-label="Impostazioni" onclick={() => router.navigate(pathOf.settings())}>
        <Icon name="settings" />
      </button>
    </div>
  </header>

  {#if mode === 'client'}
    <DeviceNotices />
  {:else}
    <nav class="chips" aria-label="Filtri">
      <a class="chip" aria-current="page" href={pathOf.library()} onclick={(e) => go(e, pathOf.library())}>Playlist</a>
      <a class="chip" href={pathOf.downloaded()} onclick={(e) => go(e, pathOf.downloaded())}>
        Scaricati{downloads.downloadedCount > 0 ? ` · ${downloads.downloadedCount}` : ''}
      </a>
    </nav>
  {/if}

  <ul class="list">
    <li>
      <a class="entry" href={pathOf.favorites()} onclick={(e) => go(e, pathOf.favorites())}>
        <span class="fav-art"><Icon name="heart" size={26} /></span>
        <span class="names">
          <span class="name">Brani che ti piacciono</span>
          <span class="muted sub">
            {library.favorites ? pluralize(library.favorites.length, 'brano', 'brani') : 'Playlist'}
          </span>
        </span>
      </a>
    </li>
    {#if library.playlists === null}
      <li><Skeleton rows={3} /></li>
    {:else}
      {#each library.playlists as p (p.id)}
        <li>
          <a class="entry" href={pathOf.playlist(p.id)} onclick={(e) => go(e, pathOf.playlist(p.id))}>
            <PlaylistCover trackIds={p.coverTrackIds} size={64} />
            <span class="names">
              <span class="name ellipsis">{p.name}</span>
              <span class="muted sub">
                Playlist · {pluralize(p.trackCount, 'brano', 'brani')}{p.durationMs > 0 ? ` · ${formatLongDuration(p.durationMs)}` : ''}
              </span>
            </span>
          </a>
        </li>
      {/each}
    {/if}
  </ul>

  <h2 class="section-title">Tutti i brani</h2>
  {#if all === null}
    <Skeleton rows={6} />
  {:else if all.length === 0}
    <p class="muted">Nessun brano. Aggiungine uno da Cerca.</p>
  {:else}
    {#each all as t, i (t.id)}
      <TrackRow track={t} onplay={() => player.playTracks(all ?? [], i, 'library')} />
    {/each}
    {#if cursor}
      <div bind:this={sentinel}><Skeleton rows={2} /></div>
    {/if}
  {/if}
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .top .page-title {
    margin: 0;
  }
  .actions {
    display: flex;
  }
  .chips {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-4);
  }
  .chip {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--surface-3);
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .chip[aria-current='page'] {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .entry {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 72px;
  }
  .entry:active {
    opacity: 0.7;
  }
  .fav-art {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    flex: none;
    border-radius: var(--radius-s);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .names {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .name {
    font-weight: 600;
  }
  .sub {
    font-size: var(--fs-s);
  }
</style>
