<script lang="ts">
import { services } from '../lib/services.svelte';
const { spotify, toasts, ui, router } = services();
const expanded = $derived(router.overlay === 'player' && spotify.active);
async function run(action: () => Promise<void>) {
  try {
    await action();
  } catch (e) {
    toasts.error(e instanceof Error ? e.message : 'Spotify non disponibile');
  }
}
</script>
{#if spotify.status && (spotify.status.linkState === 'linked' || spotify.active)}
<section class="spotify-player" class:active={spotify.active} class:expanded aria-label="Player Spotify">
  {#if spotify.active}
    <button class="btn btn-secondary" onclick={() => expanded ? router.closeOverlay() : router.openOverlay('player')}>{expanded ? 'Chiudi player Spotify' : 'Apri player Spotify'}</button>
    <div class="now-playing">
      {#if spotify.current?.imageUrl}<a class="artwork-link" href={spotify.current.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Apri ${spotify.current.name} su Spotify`}><img class="artwork" src={spotify.current.imageUrl} alt={`Copertina di ${spotify.current.name} su Spotify`} width={expanded ? 224 : 48} height={expanded ? 224 : 48} /></a>{/if}
      <div class="track-labels">
        <a href={spotify.current?.externalUrl ?? 'https://open.spotify.com'} target="_blank" rel="noopener noreferrer">{spotify.current?.name ?? 'Player'} · Spotify</a>
        {#if spotify.current?.artists.length}<a class="artists" href={spotify.current.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Artisti su Spotify: ${spotify.current.artists.join(', ')}`}>{spotify.current.artists.join(', ')}</a>{/if}
        {#if expanded}<p>{spotify.remote?.device?.name ?? 'Dispositivo da scegliere'}</p>{/if}
      </div>
    </div>
    <button disabled={spotify.phase === 'playing' ? spotify.remote?.disallows.pausing : spotify.remote?.disallows.resuming} onclick={() => run(() => spotify.command({ action: spotify.phase === 'playing' ? 'pause' : 'resume' }))}>{spotify.phase === 'playing' ? 'Pausa Spotify' : 'Riprendi Spotify'}</button>
  {/if}
  {#if !spotify.active || expanded}
  <details><summary>Dispositivi e player Spotify</summary>
    <button class="btn btn-secondary" disabled={!spotify.status.capabilities.canStream} onclick={() => run(() => spotify.enableBrowser())}>Attiva player browser Spotify</button>
    <button class="btn btn-secondary" onclick={() => run(() => spotify.refreshDevices())}>Aggiorna dispositivi Spotify</button>
    {#if spotify.browserDevice}<button class="btn btn-secondary" onclick={() => run(() => spotify.transfer(spotify.browserDevice!))}>Usa questo browser</button>{/if}
    {#each spotify.devices as device (device.id ?? device.name)}<button class="btn btn-secondary" disabled={!device.id || device.isRestricted} onclick={() => run(() => spotify.transfer(device.id!))}>{device.name}{device.isActive ? ' (attivo)' : ''}{device.isRestricted ? ' (limitato)' : ''}</button>{/each}
    <button class="btn btn-secondary" onclick={() => spotify.disconnectBrowser()}>Disconnetti player browser</button>
    <a href="https://open.spotify.com" target="_blank" rel="noopener noreferrer">Apri Spotify</a>
  </details>
  {#if spotify.active}
    {#if spotify.occurrences.length}<button onclick={() => { ui.queueOpen = true; }}>Apri coda raccolta Spookyfy</button>{/if}
    <p role="status">{spotify.phase === 'needs-gesture' ? 'Premi Riprendi per consentire la riproduzione nel browser.' : spotify.phase}</p>
    <button aria-label="Precedente su Spotify" disabled={spotify.remote?.disallows.skipping_prev} onclick={() => run(() => spotify.command({ action: 'previous' }))}>Precedente</button>
    <button aria-label="Successivo su Spotify" disabled={spotify.remote?.disallows.skipping_next} onclick={() => run(() => spotify.command({ action: 'next' }))}>Successivo</button>
    <label>Posizione Spotify <input type="range" min="0" max={spotify.current?.durationMs ?? 0} value={spotify.remote?.positionMs ?? 0} disabled={spotify.remote?.disallows.seeking} onchange={(e) => run(() => spotify.command({ action: 'seek', positionMs: Number(e.currentTarget.value) }))} /></label>
    {#if spotify.occurrences.length}
      <button onclick={() => spotify.toggleOccurrenceShuffle()}>Casuale raccolta: {spotify.shuffle ? 'sì' : 'no'}</button>
      <button onclick={() => { spotify.repeat = spotify.repeat === 'off' ? 'all' : spotify.repeat === 'all' ? 'one' : 'off'; }}>Ripeti raccolta: {spotify.repeat}</button>
    {:else}
      <button disabled={spotify.remote?.disallows.toggling_shuffle} onclick={() => run(() => spotify.command({ action: 'shuffle', state: !spotify.remote?.shuffle }))}>Casuale Spotify: {spotify.remote?.shuffle ? 'sì' : 'no'}</button>
      <button disabled={spotify.remote?.disallows.toggling_repeat_context} onclick={() => run(() => spotify.command({ action: 'repeat', repeat: spotify.remote?.repeat === 'off' ? 'context' : spotify.remote?.repeat === 'context' ? 'track' : 'off' }))}>Ripeti Spotify: {spotify.remote?.repeat ?? 'off'}</button>
    {/if}
    <button onclick={() => run(() => spotify.refreshPlayback())}>Aggiorna stato Spotify</button>
  {/if}
  {/if}
  {#if spotify.error}<p role="alert">{spotify.error}</p>{/if}
</section>
{/if}
<style>
  .spotify-player {
    margin: 1rem;
    margin-bottom: calc(var(--tabbar-h) + var(--miniplayer-h) + var(--safe-bottom) + 2rem);
    padding: 1rem;
    border-radius: 1rem;
    background: var(--surface-1);
    overflow-wrap: anywhere;
  }
  .active {
    position: fixed;
    left: calc(var(--sidebar-w) + .5rem);
    right: .5rem;
    bottom: calc(var(--tabbar-h) + var(--safe-bottom) + .5rem);
    z-index: var(--z-miniplayer);
    max-height: 40dvh;
    margin: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    box-shadow: 0 0 2rem #0008;
  }
  .expanded {
    top: max(var(--safe-top), .5rem);
    max-height: none;
    z-index: var(--z-fullplayer);
  }
  .now-playing { display: flex; align-items: center; gap: .75rem; }
  .track-labels { display: grid; min-width: 0; }
  .track-labels a { justify-content: start; margin: 0; padding: 0; min-height: 44px; }
  .artists { color: var(--text-2); font-size: var(--fs-s); }
  .artwork-link { flex: 0 0 auto; margin: 0; padding: 0; }
  .artwork { object-fit: contain; border-radius: .25rem; }
  .expanded .now-playing { flex-direction: column; align-items: start; }
  summary {
    display: list-item;
    min-height: 44px;
    padding: .75rem .25rem;
    cursor: pointer;
    touch-action: manipulation;
  }
  button, a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    margin: .25rem;
    padding: .5rem;
  }
  a { color: var(--accent); }
  input[type='range'] { display: block; width: 100%; min-height: 44px; }
  :is(button, a, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
