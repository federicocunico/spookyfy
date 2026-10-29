<script lang="ts">
import { services } from '../lib/services.svelte';

/** Interruttore della ricerca online di copertine, con i dati inviati e i servizi usati. */
const { catalog, toasts, mode, connection } = services();
let busy = $state(false);

$effect(() => {
  void catalog.loadSettings().catch(() => {});
});

async function toggle(e: Event) {
  const on = (e.currentTarget as HTMLInputElement).checked;
  busy = true;
  try {
    await catalog.setCoverLookup(on);
    toasts.show(on ? 'Ricerca online di copertine attivata' : 'Ricerca online di copertine disattivata');
  } catch {
    toasts.error('Impostazione non salvata');
    (e.currentTarget as HTMLInputElement).checked = !on;
  } finally {
    busy = false;
  }
}
</script>

<section class="card" aria-labelledby="catalog-title">
  <h2 id="catalog-title">Copertine e album</h2>
  <label class="toggle">
    <input
      type="checkbox"
      role="switch"
      checked={catalog.settings?.coverLookup ?? false}
      disabled={busy || catalog.settings === null || catalog.settings.coverLookupLocked || (mode === 'onpremise' && connection.offline)}
      onchange={toggle}
    />
    <span>Cerca copertine online</span>
  </label>
  <p class="muted small">
    Per gli album senza copertina l’app cerca su MusicBrainz, Cover Art Archive e iTunes, inviando titolo,
    artista e album dei brani{mode === 'onpremise' ? ' dal server' : ' tramite il gateway'}. La copertina trovata
    viene applicata da sola solo se titolo e artista corrispondono; dalla pagina di un album puoi sceglierne
    un’altra.
    {#if mode === 'onpremise'}L’impostazione vale per tutti gli account di questo server.{/if}
  </p>
  {#if catalog.settings?.coverLookupLocked}
    <p class="muted small">Disattivata dalla configurazione del server (COVER_LOOKUP=off).</p>
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    margin-top: var(--space-5);
    padding: var(--space-4);
    border-radius: var(--radius-l);
    background: var(--surface-1);
  }
  h2 {
    font-size: var(--fs-l);
    font-weight: 700;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    font-weight: 600;
  }
  .toggle input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .small {
    font-size: var(--fs-s);
  }
</style>
