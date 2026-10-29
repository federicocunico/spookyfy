<script lang="ts">
import type { AlbumSort, TrackDto } from '@spookyfy/shared';
import { untrack } from 'svelte';
import Cover from '../components/Cover.svelte';
import DeviceNotices from '../components/DeviceNotices.svelte';
import Icon from '../components/Icon.svelte';
import ImportFilesButton from '../components/ImportFilesButton.svelte';
import PlaylistCover from '../components/PlaylistCover.svelte';
import Skeleton from '../components/Skeleton.svelte';
import TrackRow from '../components/TrackRow.svelte';
import { formatLongDuration, pluralize } from '../lib/format';
import { genreColor } from '../lib/genre-color';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

/** Categoria mostrata: playlist (con tutti i brani), album o generi. */
let { view = 'playlists' }: { view?: 'playlists' | 'albums' | 'genres' } = $props();

const { library, catalog, router, ui, toasts, api, player, downloads, connection, mode } = services();
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
    if (view === 'albums') {
      void catalog.loadAlbums().catch(() => {
        catalog.albums ??= [];
      });
      return;
    }
    if (view === 'genres') {
      void catalog.loadGenres().catch(() => {
        catalog.genres ??= [];
      });
      return;
    }
    void library.loadPlaylists().catch(() => {});
    void library.loadFavorites().catch(() => {});
    void loadMore(true);
  });
});

const SORTS: { value: AlbumSort; label: string }[] = [
  { value: 'added', label: 'Aggiunti di recente' },
  { value: 'title', label: 'Titolo' },
  { value: 'artist', label: 'Artista' },
];

function newAlbum() {
  ui.prompt = {
    title: 'Nuovo album',
    label: 'Titolo dell’album',
    value: '',
    confirmLabel: 'Crea',
    submit: async (title) => {
      const a = await catalog.createAlbum({ title });
      toasts.show(`Album «${a.title}» creato`);
      router.navigate(pathOf.album(a.id));
    },
  };
}

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

// Brani appena importati (da file o da YouTube): subito in cima, senza ricaricare la lista.
$effect(() =>
  library.onTrackAdded((t) => {
    if (all) all = [t, ...all.filter((x) => x.id !== t.id)];
  }),
);

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
        aria-label={view === 'albums' ? 'Nuovo album' : 'Nuova playlist'}
        onclick={view === 'albums' ? newAlbum : newPlaylist}
        disabled={needsNetwork && connection.offline}
      >
        <Icon name="plus" />
      </button>
      <button class="icon-btn" aria-label="Impostazioni" onclick={() => router.navigate(pathOf.settings())}>
        <Icon name="settings" />
      </button>
    </div>
  </header>

  {#if mode === 'client'}<DeviceNotices />{/if}
  <nav class="chips" aria-label="Filtri">
    <a class="chip" aria-current={view === 'playlists' ? 'page' : undefined} href={pathOf.library()} onclick={(e) => go(e, pathOf.library())}>Playlist</a>
    <a class="chip" aria-current={view === 'albums' ? 'page' : undefined} href={pathOf.albums()} onclick={(e) => go(e, pathOf.albums())}>Album</a>
    <a class="chip" aria-current={view === 'genres' ? 'page' : undefined} href={pathOf.genres()} onclick={(e) => go(e, pathOf.genres())}>Generi</a>
    {#if mode === 'onpremise'}
      <a class="chip" href={pathOf.downloaded()} onclick={(e) => go(e, pathOf.downloaded())}>
        Scaricati{downloads.downloadedCount > 0 ? ` · ${downloads.downloadedCount}` : ''}
      </a>
    {/if}
  </nav>

  {#if view === 'albums'}
    {#if catalog.albums === null}
      <Skeleton rows={4} />
    {:else if catalog.albums.length === 0}
      <p class="empty-state">
        Nessun album. I brani con l’album nei tag vengono raggruppati da soli; puoi crearne uno con + e
        aggiungere brani dal menu ⋯ di ogni brano.
      </p>
    {:else}
      <label class="sort">
        <span class="muted">Ordina per</span>
        <select
          value={catalog.albumSort}
          onchange={(e) => void catalog.loadAlbums(e.currentTarget.value as AlbumSort).catch(() => {})}
        >
          {#each SORTS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
        </select>
      </label>
      <ul class="albums">
        {#each catalog.albums as a (a.id)}
          <li>
            <a class="album" href={pathOf.album(a.id)} onclick={(e) => go(e, pathOf.album(a.id))}>
              <Cover src={a.coverUrl} color={a.dominantColor} alt="" />
              <span class="name ellipsis">{a.title}</span>
              <span class="muted sub ellipsis">{a.artist}{a.year ? ` · ${a.year}` : ''}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if view === 'genres'}
    {#if catalog.genres === null}
      <Skeleton rows={4} />
    {:else if catalog.genres.length === 0}
      <p class="empty-state">
        Nessun genere. Aggiungili dal menu ⋯ di un brano («Generi…») o dalla pagina di un album; quelli nei tag
        dei file vengono importati da soli.
      </p>
    {:else}
      <ul class="genres">
        {#each catalog.genres as g (g.name)}
          <li>
            <a
              class="genre"
              href={pathOf.genre(g.name)}
              style:background={genreColor(g.name)}
              onclick={(e) => go(e, pathOf.genre(g.name))}
            >
              <span class="name">{g.name}</span>
              <span class="count">{pluralize(g.trackCount, 'brano', 'brani')}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
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
  .sort {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    font-size: var(--fs-s);
  }
  .sort select {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-s);
    padding: var(--space-1) var(--space-2);
    min-height: 36px;
  }
  .albums,
  .genres {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .albums {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-4) var(--space-3);
  }
  .album {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .album:active,
  .genre:active {
    opacity: 0.7;
  }
  .genres {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-3);
  }
  .genre {
    display: grid;
    align-content: space-between;
    min-height: 88px;
    padding: var(--space-3);
    border-radius: var(--radius-s);
    color: #fff;
  }
  .genre .name {
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .genre .count {
    font-size: var(--fs-s);
    opacity: 0.9;
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
