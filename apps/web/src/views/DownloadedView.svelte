<script lang="ts">
import type { TrackDto } from '@spookyfy/shared';
import Icon from '../components/Icon.svelte';
import TrackCollection from '../components/TrackCollection.svelte';
import { services } from '../lib/services.svelte';

const { library, downloads } = services();
let tracks = $state<TrackDto[] | null>(null);

// I metadati vengono dal database locale: la vista funziona anche offline.
$effect(() => {
  const ids = Object.entries(downloads.entries)
    .filter(([, e]) => e.status === 'downloaded')
    .map(([id]) => id);
  void library.knownTracks(ids).then((t) => {
    tracks = t.sort((a, b) => a.title.localeCompare(b.title, 'it'));
  });
});
const items = $derived(tracks?.map((t) => ({ key: t.id, track: t })) ?? null);
</script>

<TrackCollection
  title="Scaricati"
  kind="Sul dispositivo"
  tint="#24564f"
  {items}
  context="downloaded"
  emptyText="Nessun brano scaricato. Usa l'icona a nuvola per ascoltare anche offline."
>
  {#snippet cover()}
    <div class="dl"><Icon name="check" size={72} /></div>
  {/snippet}
</TrackCollection>

<style>
  .dl {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border-radius: var(--radius-s);
    background: var(--downloaded);
    color: var(--accent-ink);
  }
</style>
