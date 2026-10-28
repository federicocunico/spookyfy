<script lang="ts">
import { FILE_ACCEPT, type ImportFileResult, importFiles } from '../lib/device/files';
import { services } from '../lib/services.svelte';
import Icon from './Icon.svelte';

/** Importa brani da file audio del telefono (app File, iCloud Drive, download). */
let { variant = 'button' }: { variant?: 'button' | 'icon' } = $props();
const { device, toasts, library } = services();
let input: HTMLInputElement | undefined = $state();
let busy = $state(false);

function summary(results: ImportFileResult[]): string {
  const imported = results.filter((r) => r.status === 'imported').length;
  const dup = results.filter((r) => r.status === 'duplicate').length;
  const rejected = results.filter((r) => r.status === 'rejected');
  const parts = [];
  if (imported) parts.push(imported === 1 ? '1 brano importato' : `${imported} brani importati`);
  if (dup) parts.push(dup === 1 ? '1 già presente' : `${dup} già presenti`);
  if (rejected.length) parts.push(`${rejected.length} non supportati (${rejected[0]!.reason})`);
  return parts.join(', ') || 'Nessun file importato';
}

async function onchange() {
  const files = [...(input?.files ?? [])];
  if (!device || files.length === 0) return;
  busy = true;
  try {
    const results = await importFiles(files, { library: device.library, processCover: device.processCover });
    const rejected = results.some((r) => r.status === 'rejected');
    if (rejected) toasts.error(summary(results));
    else toasts.show(summary(results));
    void library.loadHome().catch(() => {});
  } catch {
    toasts.error('Importazione dei file non riuscita');
  } finally {
    busy = false;
    if (input) input.value = '';
  }
}
</script>

<input
  bind:this={input}
  type="file"
  accept={FILE_ACCEPT}
  multiple
  class="visually-hidden"
  tabindex="-1"
  aria-hidden="true"
  data-testid="file-input"
  {onchange}
/>
{#if variant === 'icon'}
  <button class="icon-btn" aria-label="Importa da file" disabled={busy} onclick={() => input?.click()}>
    <Icon name="music" />
  </button>
{:else}
  <button class="btn btn-secondary" disabled={busy} onclick={() => input?.click()}>
    <Icon name="music" size={18} /> {busy ? 'Importazione…' : 'Importa da file'}
  </button>
{/if}
