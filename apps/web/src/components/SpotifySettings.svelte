<script lang="ts">
import type { SpotifyLinkBody } from '@spookyfy/shared';
import { services } from '../lib/services.svelte';
import { spotifyErrorMessage } from '../lib/spotify/transport';
const { spotify, session, router } = services();
let busy = $state(false);
let error = $state('');
let consent = $state(false);
let authorizing = $state(false);
const hasScopes = (...scopes: string[]) =>
  spotify.status?.linkState === 'linked' && scopes.every((scope) => spotify.status?.scopes.includes(scope));
const libraryAuthorized = $derived(
  hasScopes('user-library-read', 'playlist-read-private', 'playlist-read-collaborative'),
);
const playbackAuthorized = $derived(
  hasScopes(
    'user-read-private',
    'user-read-email',
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
  ),
);
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
async function authorize(capability: SpotifyLinkBody['capability']) {
  authorizing = true;
  await run(() => spotify.link(capability));
  authorizing = false;
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
    {#if libraryAuthorized}
      <p class="authorized">Lettura libreria Spotify autorizzata.</p>
    {:else}
      <label><input type="checkbox" bind:checked={consent} /> Consento di collegare Spotify e leggere la libreria richiesta. Le modifiche e la riproduzione richiedono autorizzazioni separate.</label>
      <button class="btn btn-secondary" disabled={busy || !consent || session.status !== 'authenticated' || session.offlineMode} onclick={() => authorize('library')}>{spotify.status.linkState === 'unlinked' ? 'Collega Spotify' : 'Autorizza lettura libreria'}</button>
    {/if}
    {#if spotify.status.linkState === 'linked'}
      {#if hasScopes('user-library-modify')}
        <p class="authorized">Salvataggi Spotify autorizzati.</p>
      {:else}
        <button class="btn btn-secondary" disabled={busy || session.offlineMode} onclick={() => authorize('library-write')}>Autorizza salvataggi Spotify</button>
      {/if}
      {#if hasScopes('playlist-modify-private', 'playlist-modify-public')}
        <p class="authorized">Modifiche playlist Spotify autorizzate.</p>
      {:else}
        <button class="btn btn-secondary" disabled={busy || session.offlineMode} onclick={() => authorize('playlist-write')}>Autorizza modifiche playlist Spotify</button>
      {/if}
      {#if playbackAuthorized}
        <p class="authorized" role="status">Riproduzione Spotify autorizzata.</p>
        <p>Apri la libreria Spotify e attiva il player browser oppure scegli un dispositivo per ascoltare.</p>
      {:else}
        <button class="btn btn-secondary" disabled={busy || session.offlineMode} onclick={() => authorize('playback')}>Autorizza riproduzione Spotify</button>
        <p class="small muted">Per il player ufficiale Spotify richiede anche il permesso di leggere l’indirizzo email.</p>
      {/if}
    {/if}
    {#if spotify.status.reason}<p role="status">{spotify.status.message ?? spotifyErrorMessage(spotify.status.reason)}</p>{/if}
  {/if}
  {#if authorizing}<p role="status">Apertura di Spotify per autorizzare la funzione…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
<style>.spotify { display:grid; gap:1rem; padding:1rem; margin-top:1.5rem; border-radius:1rem; background:var(--surface-1); } label { display:flex; gap:.75rem; align-items:start; } .authorized { color:var(--text); font-weight:600; }</style>
