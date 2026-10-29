<script lang="ts">
import { GENRES_PER_TRACK_MAX, GENRE_NAME_MAX, genreKey } from '@spookyfy/shared';
import Icon from './Icon.svelte';

/**
 * Generi come chip: Invio o virgola aggiungono il testo digitato; i suggerimenti
 * vengono dai generi in libreria (per prefisso) e da `extra` (es. ricerca online).
 */
let {
  id,
  value = $bindable(),
  suggest,
  extra = [],
}: {
  id: string;
  value: string[];
  suggest: (prefix: string, exclude: string[]) => string[];
  extra?: string[];
} = $props();

let text = $state('');
const full = $derived(value.length >= GENRES_PER_TRACK_MAX);
const suggestions = $derived.by(() => {
  const taken = new Set(value.map(genreKey));
  const p = genreKey(text);
  const fromExtra = extra.filter((g) => !taken.has(genreKey(g)) && genreKey(g).startsWith(p));
  const seen = new Set(fromExtra.map(genreKey));
  return [...fromExtra, ...suggest(text, value).filter((g) => !seen.has(genreKey(g)))].slice(0, 8);
});

function add(raw: string) {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, GENRE_NAME_MAX);
  text = '';
  if (!name || full || value.some((g) => genreKey(g) === genreKey(name))) return;
  value = [...value, name];
}

function onkeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    add(text);
  } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
    value = value.slice(0, -1);
  }
}
</script>

<div class="genres">
  {#if value.length > 0}
    <ul class="chips" aria-label="Generi scelti">
      {#each value as g (g)}
        <li class="chip">
          <span>{g}</span>
          <button type="button" aria-label={`Togli ${g}`} onclick={() => (value = value.filter((x) => x !== g))}>
            <Icon name="close" size={16} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <input
    {id}
    class="input"
    bind:value={text}
    {onkeydown}
    onblur={() => add(text)}
    maxlength={GENRE_NAME_MAX}
    disabled={full}
    placeholder={full ? `Massimo ${GENRES_PER_TRACK_MAX} generi` : 'Scrivi un genere e premi Invio'}
    autocomplete="off"
  />
  {#if suggestions.length > 0 && !full}
    <div class="suggestions" aria-label="Suggerimenti">
      {#each suggestions as s (s)}
        <!-- mousedown: il suggerimento si aggiunge prima che il campo perda il focus -->
        <button type="button" class="suggestion" onmousedown={(e) => e.preventDefault()} onclick={() => add(s)}>
          + {s}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .genres {
    display: grid;
    gap: var(--space-2);
  }
  .chips,
  .suggestions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .chip button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: inherit;
  }
  .suggestion {
    min-height: 36px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface-3);
    font-size: var(--fs-s);
  }
</style>
