<script lang="ts">
import Icon from '../components/Icon.svelte';
import PlaylistCover from '../components/PlaylistCover.svelte';
import TrackCollection from '../components/TrackCollection.svelte';
import { ApiError } from '../lib/api';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

let { id }: { id: string } = $props();
const { library, ui, toasts, router, connection } = services();

let notFound = $state(false);
$effect(() => {
  notFound = false;
  library.loadPlaylist(id).then(
    (p) => {
      if (!p) notFound = true;
    },
    (err) => {
      if (err instanceof ApiError && err.status === 404) notFound = true;
    },
  );
});

const playlist = $derived(library.details[id] ?? null);
const summary = $derived(library.playlists?.find((p) => p.id === id) ?? null);
const items = $derived(
  playlist?.items.map((i) => ({ key: i.itemId, itemId: i.itemId, track: i.track })) ?? null,
);

function rename() {
  const current = playlist?.name ?? summary?.name ?? '';
  ui.prompt = {
    title: 'Rinomina playlist',
    label: 'Nome',
    value: current,
    confirmLabel: 'Salva',
    submit: (name) => library.renamePlaylist(id, name),
  };
}

function remove() {
  ui.confirm = {
    title: 'Eliminare la playlist?',
    message: `«${playlist?.name ?? ''}» verrà eliminata. I brani restano nella libreria.`,
    confirmLabel: 'Elimina',
    danger: true,
    confirm: async () => {
      try {
        await library.deletePlaylist(id);
        toasts.show('Playlist eliminata');
        router.navigate(pathOf.library(), { replace: true });
      } catch {
        toasts.error('La playlist non è stata eliminata');
      }
    },
  };
}

async function reorder(itemId: string, toIndex: number) {
  try {
    await library.moveItem(id, itemId, toIndex);
  } catch {
    toasts.error('Ordine non salvato');
  }
}
</script>

{#if notFound}
  <div class="page">
    <p class="empty-state">Playlist non trovata.</p>
  </div>
{:else}
  <TrackCollection
    title={playlist?.name ?? summary?.name ?? ''}
    tint={playlist?.items[0]?.track.dominantColor}
    {items}
    context={`playlist:${id}`}
    playlistId={id}
    onreorder={reorder}
    emptyText="Questa playlist è vuota. Aggiungi brani dal menu ⋯ di ogni brano."
  >
    {#snippet cover()}
      <PlaylistCover trackIds={playlist?.coverTrackIds ?? summary?.coverTrackIds ?? []} />
    {/snippet}
    {#snippet headerActions()}
      <button class="icon-btn" aria-label="Rinomina playlist" disabled={connection.offline} onclick={rename}>
        <Icon name="edit" />
      </button>
      <button class="icon-btn" aria-label="Elimina playlist" disabled={connection.offline} onclick={remove}>
        <Icon name="trash" />
      </button>
    {/snippet}
  </TrackCollection>
{/if}
