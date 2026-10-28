<script lang="ts">
import type { TrackDto } from '@spookyfy/shared';
import Cover from '../components/Cover.svelte';
import Icon from '../components/Icon.svelte';
import PlaylistCover from '../components/PlaylistCover.svelte';
import Skeleton from '../components/Skeleton.svelte';
import TrackRow from '../components/TrackRow.svelte';
import { greeting } from '../lib/format';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

const { library, player, router, downloads, connection } = services();

$effect(() => {
  void library.loadHome().catch(() => {});
});

function playFrom(list: TrackDto[], index: number, context: string) {
  player.playTracks(list, index, context);
}
</script>

<div class="page">
  <header class="top">
    <h1 class="page-title">{greeting()}</h1>
    <button class="icon-btn" aria-label="Impostazioni" onclick={() => router.navigate(pathOf.settings())}>
      <Icon name="settings" />
    </button>
  </header>

  <section aria-labelledby="recent-title">
    <h2 id="recent-title" class="section-title">Ascoltati di recente</h2>
    {#if library.recent === null}
      <Skeleton kind="card" rows={4} />
    {:else if library.recent.length === 0}
      <p class="muted small">Qui troverai i brani che ascolti più spesso.</p>
    {:else}
      <div class="carousel">
        {#each library.recent as t, i (t.id)}
          <button
            class="card"
            disabled={connection.offline && !downloads.isDownloaded(t.id)}
            onclick={() => playFrom(library.recent ?? [], i, 'recent')}
            aria-label={`Riproduci ${t.title} di ${t.artist}`}
          >
            <Cover src={t.coverUrl} color={t.dominantColor} radius="var(--radius-m)" />
            <span class="card-title ellipsis">{t.title}</span>
            <span class="card-sub ellipsis">{t.artist}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  {#if library.playlists && library.playlists.length > 0}
    <section aria-labelledby="playlists-title">
      <h2 id="playlists-title" class="section-title">Le tue playlist</h2>
      <div class="grid">
        {#each library.playlists.slice(0, 6) as p (p.id)}
          <a
            class="tile"
            href={pathOf.playlist(p.id)}
            onclick={(e) => {
              e.preventDefault();
              router.navigate(pathOf.playlist(p.id));
            }}
          >
            <PlaylistCover trackIds={p.coverTrackIds} size={56} />
            <span class="ellipsis">{p.name}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <section aria-labelledby="added-title">
    <h2 id="added-title" class="section-title">Aggiunti di recente</h2>
    {#if library.recentlyAdded === null}
      <Skeleton rows={5} />
    {:else if library.recentlyAdded.length === 0}
      <div class="empty-state">
        <p>La libreria è vuota.</p>
        <button class="btn btn-primary" onclick={() => router.navigate(pathOf.search())}>Cerca un brano</button>
      </div>
    {:else}
      {#each library.recentlyAdded as t, i (t.id)}
        <TrackRow track={t} onplay={() => playFrom(library.recentlyAdded ?? [], i, 'added')} />
      {/each}
    {/if}
  </section>
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
  .small {
    font-size: var(--fs-s);
  }
  .carousel {
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    margin: 0 calc(-1 * var(--space-4));
    padding: 0 var(--space-4);
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .carousel::-webkit-scrollbar {
    display: none;
  }
  .card {
    flex: none;
    width: 140px;
    display: grid;
    gap: var(--space-1);
    text-align: left;
    scroll-snap-align: start;
  }
  .card-title {
    margin-top: var(--space-1);
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .card-sub {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 56px;
    padding-right: var(--space-2);
    border-radius: var(--radius-s);
    background: var(--surface-3);
    overflow: hidden;
    font-size: var(--fs-s);
    font-weight: 700;
  }
  .tile:active {
    background: var(--surface-hover);
  }
</style>
