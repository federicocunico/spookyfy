<script lang="ts">
import { services } from '../lib/services.svelte';
import Icon from './Icon.svelte';

const { connection } = services();
</script>

{#if connection.offline}
  <div class="banner" role="status" data-testid="offline-banner">
    <Icon name="offline" size={16} />
    <span>Sei offline: puoi ascoltare i brani scaricati</span>
  </div>
{/if}

<style>
  .banner {
    position: sticky;
    top: 0;
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: calc(var(--safe-top) + var(--space-1)) var(--space-4) var(--space-1);
    background: var(--surface-3);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
</style>
