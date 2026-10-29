<script lang="ts">
import Cover from '../components/Cover.svelte';
import Icon from '../components/Icon.svelte';
import TrackCollection from '../components/TrackCollection.svelte';
import { ApiError } from '../lib/api';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

let { id }: { id: string } = $props();
const { catalog, ui, toasts, router, connection, mode } = services();
// In modalità client l'album è sul dispositivo: modificabile anche offline.
const needsNetwork = mode === 'onpremise';

let notFound = $state(false);
$effect(() => {
  notFound = false;
  catalog.loadAlbum(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound = true;
    else toasts.error('Album non disponibile senza connessione');
  });
  void catalog.loadGenres().catch(() => {});
});

const album = $derived(catalog.details[id] ?? null);
const items = $derived(album?.tracks.map((t) => ({ key: t.id, itemId: t.id, track: t })) ?? null);
const kind = $derived(
  album
    ? ['Album', album.artist, album.year ? String(album.year) : null].filter(Boolean).join(' · ')
    : 'Album',
);

function edit() {
  if (album) ui.editAlbum = album;
}

function remove() {
  ui.confirm = {
    title: 'Eliminare l’album?',
    message: `«${album?.title ?? ''}» verrà eliminato. I brani restano nella libreria, nelle playlist e nei preferiti.`,
    confirmLabel: 'Elimina',
    danger: true,
    confirm: async () => {
      try {
        await catalog.deleteAlbum(id);
        toasts.show('Album eliminato');
        router.navigate(pathOf.albums(), { replace: true });
      } catch {
        toasts.error('L’album non è stato eliminato');
      }
    },
  };
}

async function reorder(trackId: string, toIndex: number) {
  try {
    await catalog.moveTrack(id, trackId, toIndex);
  } catch {
    toasts.error('Ordine non salvato');
  }
}
</script>

{#if notFound}
  <div class="page">
    <p class="empty-state">Album non trovato.</p>
  </div>
{:else}
  <TrackCollection
    title={album?.title ?? ''}
    {kind}
    tint={album?.dominantColor}
    {items}
    context={`album:${id}`}
    onreorder={reorder}
    emptyText="Questo album è vuoto. Aggiungi brani dal menu ⋯ di ogni brano, con «Aggiungi ad album»."
  >
    {#snippet cover()}
      <Cover src={album?.coverUrl ?? null} color={album?.dominantColor} alt="" eager shadow />
    {/snippet}
    {#snippet headerActions()}
      <button
        class="icon-btn"
        aria-label="Modifica album"
        disabled={!album || (needsNetwork && connection.offline)}
        onclick={edit}
      >
        <Icon name="edit" />
      </button>
      <button
        class="icon-btn"
        aria-label="Copertina dell’album"
        disabled={!album || (needsNetwork && connection.offline)}
        onclick={() => album && (ui.albumCover = album)}
      >
        <Icon name="image" />
      </button>
      <button
        class="icon-btn"
        aria-label="Elimina album"
        disabled={!album || (needsNetwork && connection.offline)}
        onclick={remove}
      >
        <Icon name="trash" />
      </button>
    {/snippet}
  </TrackCollection>
  {#if album && album.genres.length > 0}
    <ul class="genres" aria-label="Generi dell’album">
      {#each album.genres as g (g)}
        <li>
          <a
            class="chip"
            href={pathOf.genre(g)}
            onclick={(e) => {
              e.preventDefault();
              router.navigate(pathOf.genre(g));
            }}>{g}</a
          >
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .genres {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0 var(--space-4) var(--space-6);
  }
  .chip {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface-3);
    font-size: var(--fs-s);
    font-weight: 600;
  }
</style>
