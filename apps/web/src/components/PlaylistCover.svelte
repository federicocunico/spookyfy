<script lang="ts">
import { trackCoverUrl } from '@spookyfy/shared';
import Cover from './Cover.svelte';
import Icon from './Icon.svelte';

/** Collage 2×2 delle prime copertine (o una sola se i brani sono meno di 4). */
let { trackIds, size }: { trackIds: string[]; size?: number | string } = $props();
const width = $derived(typeof size === 'number' ? `${size}px` : (size ?? '100%'));
</script>

<div class="pc" style:width>
  {#if trackIds.length >= 4}
    <div class="grid">
      {#each trackIds.slice(0, 4) as id (id)}
        <Cover src={trackCoverUrl(id, 128)} radius="0" />
      {/each}
    </div>
  {:else if trackIds.length > 0}
    <Cover src={trackCoverUrl(trackIds[0]!, 512)} radius="0" />
  {:else}
    <div class="empty"><Icon name="music" size={32} /></div>
  {/if}
</div>

<style>
  .pc {
    flex: none;
    aspect-ratio: 1;
    border-radius: var(--radius-s);
    overflow: hidden;
    background: var(--surface-3);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .empty {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text-3);
  }
</style>
