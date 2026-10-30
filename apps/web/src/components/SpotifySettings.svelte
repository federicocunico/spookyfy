<script lang="ts">
import { services } from '../lib/services.svelte';
import { spotifyErrorMessage } from '../lib/spotify/transport';
const { spotify, session, router } = services();
let busy = $state(false);
let error = $state('');
let consent = $state(false);
async function run(action: () => Promise<void>) {
  busy = true;
  error = '';
  try {
    await action();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Spotify non disponibile';
  } finally {
    busy = false;
  }
}
const outcome = new URLSearchParams(window.location.search).get('spotify');
</script>

<section class="spotify card" aria-label="Collegamento Spotify">
  <h2>Spotify</h2>
  <p>Collegamento facoltativo al tuo account Spookyfy. I file locali restano indipendenti.</p>
  {#if outcome}<p role="status">{outcome === 'linked' ? 'Spotify collegato.' : outcome === 'denied' ? 'Consenso Spotify negato. Il collegamento precedente resta valido.' : 'Collegamento non riuscito. Riprova dalle impostazioni.'}</p>{/if}
  {#if !spotify.status}
    <p>{spotify.error ?? 'Stato Spotify non disponibile'}</p>
    <button class="btn btn-secondary" onclick={() => run(() => spotify.refresh())} disabled={busy}>Verifica Spotify</button>
  {:else if spotify.status.mode === 'disabled' || spotify.status.mode === 'misconfigured'}
    <p>Spotify {spotify.status.mode === 'disabled' ? 'disattivato' : 'non configurato correttamente'}.</p>
    {#if spotify.status.message}<p>{spotify.status.message}</p>{/if}
    {#if spotify.status.linkState !== 'unlinked'}
      <button class="btn btn-secondary" disabled={busy} onclick={() => run(() => spotify.unlink())}>Scollega Spotify</button>
    {/if}
  {:else}
    <p>{spotify.status.linkState === 'linked' ? `Collegato: ${spotify.status.displayName ?? 'account Spotify'}` : spotify.status.linkState === 'reauth-required' ? 'Autorizza nuovamente Spotify' : 'Spotify non collegato'}</p>
    {#if spotify.status.linkState !== 'unlinked'}
      <p>{spotify.status.entitlement === 'premium' ? 'Premium verificato' : spotify.status.entitlement === 'non-premium' ? 'La riproduzione Spotify richiede Premium.' : 'Spotify richiede Premium; abbonamento non verificabile.'}</p>
      <button class="btn btn-secondary" onclick={() => router.navigate('/spotify')}>Apri libreria Spotify</button>
      <button class="btn btn-secondary" disabled={busy} onclick={() => run(() => spotify.unlink())}>Scollega Spotify</button>
    {/if}
    <label><input type="checkbox" bind:checked={consent} /> Consento di collegare Spotify e leggere la libreria richiesta. Le modifiche e la riproduzione richiedono autorizzazioni separate.</label>
    <button class="btn btn-secondary" disabled={busy || !consent || session.status !== 'authenticated' || session.offlineMode} onclick={() => run(() => spotify.link('library'))}>{spotify.status.linkState === 'unlinked' ? 'Collega Spotify' : 'Autorizza lettura libreria'}</button>
    {#if spotify.status.linkState === 'linked'}
      <button class="btn btn-secondary" disabled={busy} onclick={() => run(() => spotify.link('library-write'))}>Autorizza salvataggi Spotify</button>
      <button class="btn btn-secondary" disabled={busy} onclick={() => run(() => spotify.link('playlist-write'))}>Autorizza modifiche playlist Spotify</button>
      <button class="btn btn-secondary" disabled={busy} onclick={() => run(() => spotify.link('playback'))}>Autorizza riproduzione Spotify</button>
    {/if}
    {#if spotify.status.reason}<p role="status">{spotify.status.message ?? spotifyErrorMessage(spotify.status.reason)}</p>{/if}
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>.spotify { display:grid; gap:1rem; padding:1rem; margin-top:1.5rem; border-radius:1rem; background:var(--surface-1); } label { display:flex; gap:.75rem; align-items:start; }</style>
