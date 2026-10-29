<script lang="ts">
import type { GenreDetailDto } from '@spookyfy/shared';
import Cover from '../components/Cover.svelte';
import TrackCollection from '../components/TrackCollection.svelte';
import { ApiError } from '../lib/api';
import { genreColor } from '../lib/genre-color';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

let { name }: { name: string } = $props();
const { catalog, toasts, router, library } = services();

let genre = $state<GenreDetailDto | null>(null);
let notFound = $state(false);

function load() {
  catalog.loadGenre(name).then(
    (g) => {
      genre = g;
    },
    (err) => {
      if (err instanceof ApiError && err.status === 404) notFound = true;
      else toasts.error('Genere non disponibile senza connessione');
    },
  );
}
$effect(load);
// Un brano a cui viene tolto il genere esce dalla pagina.
$effect(() => library.onTrackChanged(() => load()));

const items = $derived(genre?.tracks.map((t) => ({ key: t.id, track: t })) ?? null);
const color = $derived(genreColor(name));
</script>

{#if notFound}
  <div class="page">
    <p class="empty-state">Nessun brano con il genere «{name}».</p>
  </div>
{:else}
  <TrackCollection
    title={genre?.name ?? name}
    kind="Genere"
    tint={color}
    {items}
    context={`genre:${name}`}
    emptyText="Nessun brano con questo genere."
  >
    {#snippet cover()}
      <div class="art" style:background={color}><span>{genre?.name ?? name}</span></div>
    {/snippet}
  </TrackCollection>
  {#if genre && genre.albums.length > 0}
    <section class="albums">
      <h2 class="section-title">Album</h2>
      <ul class="grid">
        {#each genre.albums as a (a.id)}
          <li>
            <a
              href={pathOf.album(a.id)}
              onclick={(e) => {
                e.preventDefault();
                router.navigate(pathOf.album(a.id));
              }}
            >
              <Cover src={a.coverThumbUrl} color={a.dominantColor} />
              <span class="name ellipsis">{a.title}</span>
              <span class="muted sub ellipsis">{a.artist}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .art {
    aspect-ratio: 1;
    width: 100%;
    display: grid;
    place-items: end start;
    padding: var(--space-4);
    border-radius: var(--radius-s);
    color: #fff;
    font-size: 1.5rem;
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .albums {
    padding: 0 var(--space-4) var(--space-6);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-4);
  }
  .grid a {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
  .sub {
    font-size: var(--fs-s);
  }
</style>
