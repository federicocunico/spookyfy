<script lang="ts">
import { services } from '../lib/services.svelte';
import Cover from './Cover.svelte';
import Sheet from './Sheet.svelte';

const { ui, player, spotify } = services();
</script>

{#if ui.queueOpen && spotify.occurrences.length}
  <Sheet label="Coda della raccolta Spookyfy" onclose={() => (ui.queueOpen = false)}>
    <h2>Raccolta Spookyfy</h2>
    <button onclick={() => spotify.resumeOccurrence()}>Riprendi raccolta</button>
    <ol>{#each spotify.occurrences as item, i (item.occurrenceId)}<li aria-current={i === spotify.occurrenceIndex ? 'true' : undefined}>{item.ref.provider === 'local' ? `File locale · ${item.local?.title ?? 'Non disponibile'}` : `Spotify · ${item.spotify?.name ?? 'Non disponibile'}`}</li>{/each}</ol>
    <button onclick={() => spotify.toggleOccurrenceShuffle()}>Casuale raccolta: {spotify.shuffle ? 'sì' : 'no'}</button>
    <button onclick={() => { spotify.repeat = spotify.repeat === 'off' ? 'all' : spotify.repeat === 'all' ? 'one' : 'off'; }}>Ripeti raccolta: {spotify.repeat}</button>
  </Sheet>
{:else if ui.queueOpen && player.current && !spotify.active}
  <Sheet label="Coda di riproduzione" onclose={() => (ui.queueOpen = false)}>
    <h2 class="title">In riproduzione</h2>
    <div class="item current">
      <Cover src={player.current.coverThumbUrl} color={player.current.dominantColor} size={40} />
      <span class="ellipsis">{player.current.title}</span>
    </div>
    <h2 class="title">Prossimi brani</h2>
    {#if player.upcomingTracks.length === 0}
      <p class="muted">La coda è vuota.</p>
    {/if}
    {#each player.upcomingTracks as t, i (`${t.id}-${i}`)}
      <button
        class="item"
        onclick={() => {
          player.jumpTo((player.queue?.position ?? 0) + i + 1);
          ui.queueOpen = false;
        }}
      >
        <Cover src={t.coverThumbUrl} color={t.dominantColor} size={40} />
        <span class="names">
          <span class="ellipsis">{t.title}</span>
          <span class="muted ellipsis artist">{t.artist}</span>
        </span>
      </button>
    {/each}
  </Sheet>
{/if}

<style>
  .title {
    font-size: var(--fs-m);
    font-weight: 700;
    margin: var(--space-3) 0 var(--space-2);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    text-align: left;
  }
  .current {
    color: var(--accent);
  }
  .names {
    min-width: 0;
    display: grid;
  }
  .artist {
    font-size: var(--fs-s);
  }
</style>
