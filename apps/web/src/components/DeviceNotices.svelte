<script lang="ts">
import { backupReminderDue, getSettings } from '../lib/device/backup';
import type { DeviceSettings } from '../lib/offline/db';
import { pathOf } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

/** Avvisi della modalità client: brani persi dal sistema e promemoria di backup. */
const { device, router, db } = services();
let settings = $state<DeviceSettings | null>(null);
let dismissed = $state(false);

$effect(() => {
  void db().then(async (d) => {
    await device?.library.ready();
    settings = await getSettings(d);
  });
});

const lost = $derived(device?.lost.ids.length ?? 0);
const remind = $derived(
  !dismissed &&
    settings !== null &&
    device !== null &&
    backupReminderDue(settings, device.library.usage().count, Date.now()),
);
</script>

{#if lost > 0}
  <div class="notice warn" role="status" data-testid="lost-banner">
    <p>
      {lost === 1 ? 'Un brano è stato eliminato' : `${lost} brani sono stati eliminati`} dal sistema per liberare spazio.
      Riscaricali dal menu ⋯ o ripristina un backup.
    </p>
    <button class="link" onclick={() => router.navigate(pathOf.settings())}>Ripristina backup</button>
  </div>
{/if}
{#if remind}
  <div class="notice" role="status" data-testid="backup-reminder">
    <p>La tua libreria esiste solo su questo telefono: esporta un backup per non perderla.</p>
    <div class="actions">
      <button class="link" onclick={() => (dismissed = true)}>Più tardi</button>
      <button class="link strong" onclick={() => router.navigate(pathOf.settings())}>Fai il backup</button>
    </div>
  </div>
{/if}

<style>
  .notice {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-m);
    background: var(--surface-3);
    font-size: var(--fs-s);
  }
  .warn {
    border-left: 3px solid var(--danger);
  }
  .actions {
    display: flex;
    gap: var(--space-4);
    justify-content: flex-end;
  }
  .link {
    justify-self: end;
    color: var(--text-2);
    font-weight: 700;
  }
  .strong {
    color: var(--accent);
  }
</style>
