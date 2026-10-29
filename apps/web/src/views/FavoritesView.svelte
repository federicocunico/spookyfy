<script lang="ts">
import { untrack } from 'svelte';
import Icon from '../components/Icon.svelte';
import TrackCollection from '../components/TrackCollection.svelte';
import { services } from '../lib/services.svelte';

const { library } = services();
$effect(() => {
  untrack(() => {
    void library.loadFavorites().catch(() => {});
  });
});
const items = $derived(library.favorites?.map((f) => ({ key: f.track.id, track: f.track })) ?? null);
</script>

<TrackCollection
  title="Brani che ti piacciono"
  tint="#4a3a80"
  {items}
  context="favorites"
  emptyText="Tocca il cuore su un brano per aggiungerlo qui."
>
  {#snippet cover()}
    <div class="fav"><Icon name="heart" size={72} /></div>
  {/snippet}
</TrackCollection>

<style>
  .fav {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border-radius: var(--radius-s);
    background: var(--accent);
    color: var(--accent-ink);
  }
</style>
