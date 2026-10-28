<script lang="ts">
import { services } from '../lib/services.svelte';

/**
 * Nuova versione dell'app pronta: la riproduzione continua; l'aggiornamento
 * avviene al prossimo avvio oppure ora, su conferma dell'utente.
 */
let { update }: { update: (() => void) | null } = $props();
const { player } = services();
let dismissed = $state(false);
</script>

{#if update && !dismissed}
  <div class="update" role="status" data-testid="update-prompt">
    <span>Nuova versione di Spookyfy disponibile</span>
    <div class="actions">
      <button class="later" onclick={() => (dismissed = true)}>Più tardi</button>
      <button
        class="now"
        onclick={() => {
          player.flush();
          update?.();
        }}
      >
        Aggiorna{player.playing ? ' (interrompe la musica)' : ''}
      </button>
    </div>
  </div>
{/if}

<style>
  .update {
    position: fixed;
    top: calc(var(--safe-top) + var(--space-2));
    left: var(--space-3);
    right: var(--space-3);
    z-index: var(--z-toast);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-m);
    background: var(--surface-3);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font-size: var(--fs-s);
  }
  .actions {
    display: flex;
    gap: var(--space-3);
  }
  button {
    min-height: 36px;
    font-weight: 700;
    font-size: var(--fs-s);
  }
  .later {
    color: var(--text-2);
  }
  .now {
    color: var(--accent);
  }
</style>
