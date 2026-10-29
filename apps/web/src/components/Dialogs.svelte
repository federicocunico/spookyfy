<script lang="ts">
import { genreKey, playlistNameSchema, updateTrackBodySchema } from '@spookyfy/shared';
import { ApiError } from '../lib/api';
import { services } from '../lib/services.svelte';
import GenreInput from './GenreInput.svelte';
import Icon from './Icon.svelte';
import Sheet from './Sheet.svelte';

/** Dialoghi globali: aggiunta a playlist, modifica metadati, richiesta testo, conferma. */
const { ui, library, catalog, toasts } = services();

// ---------- aggiungi a playlist ----------
$effect(() => {
  if (ui.addToPlaylist && library.playlists === null) void library.loadPlaylists().catch(() => {});
});

async function addTo(playlistId: string, name: string) {
  const track = ui.addToPlaylist;
  ui.addToPlaylist = null;
  if (!track) return;
  try {
    await library.addToPlaylist(playlistId, track);
    toasts.show(`Aggiunto a «${name}»`);
  } catch {
    toasts.error('Brano non aggiunto alla playlist');
  }
}

function newPlaylistFor() {
  const track = ui.addToPlaylist;
  ui.addToPlaylist = null;
  ui.prompt = {
    title: 'Nuova playlist',
    label: 'Nome della playlist',
    value: '',
    confirmLabel: 'Crea',
    submit: async (name) => {
      const p = await library.createPlaylist(name);
      if (track) await library.addToPlaylist(p.id, track);
      toasts.show(track ? `Aggiunto a «${p.name}»` : `Playlist «${p.name}» creata`);
    },
  };
}

// ---------- modifica metadati ----------
let edit = $state({ title: '', artist: '', album: '', genres: [] as string[] });
let editError = $state<string | null>(null);
let saving = $state(false);
$effect(() => {
  const t = ui.editTrack;
  if (t) {
    edit = { title: t.title, artist: t.artist, album: t.album ?? '', genres: [...t.genres] };
    editError = null;
    void catalog.loadGenres().catch(() => {});
  }
});

const sameGenres = (a: string[], b: string[]) =>
  a.length === b.length && a.every((g, i) => genreKey(g) === genreKey(b[i] ?? ''));

async function saveEdit(e: SubmitEvent) {
  e.preventDefault();
  const t = ui.editTrack;
  if (!t) return;
  const body = { title: edit.title, artist: edit.artist, album: edit.album.trim() || null };
  const parsed = updateTrackBodySchema.safeParse(body);
  if (!parsed.success) {
    editError = parsed.error.issues[0]?.message ?? 'Valori non validi';
    return;
  }
  saving = true;
  try {
    const updated = await library.updateTrack(t.id, parsed.data);
    if (!sameGenres(t.genres, edit.genres)) await catalog.setTrackGenres(updated, edit.genres);
    // Il campo album può aver spostato il brano: elenco degli album aggiornato.
    if ((t.album ?? '') !== (updated.album ?? '')) void catalog.loadAlbums().catch(() => {});
    ui.editTrack = null;
    toasts.show('Informazioni aggiornate');
  } catch (err) {
    editError = err instanceof ApiError ? err.message : 'Salvataggio non riuscito';
  } finally {
    saving = false;
  }
}

// ---------- richiesta testo (nuova playlist, rinomina) ----------
let promptValue = $state('');
let promptError = $state<string | null>(null);
$effect(() => {
  if (ui.prompt) {
    promptValue = ui.prompt.value;
    promptError = null;
  }
});

async function submitPrompt(e: SubmitEvent) {
  e.preventDefault();
  const p = ui.prompt;
  if (!p) return;
  const parsed = playlistNameSchema.safeParse(promptValue);
  if (!parsed.success) {
    promptError = parsed.error.issues[0]?.message ?? 'Valore non valido';
    return;
  }
  saving = true;
  try {
    await p.submit(parsed.data);
    ui.prompt = null;
  } catch (err) {
    promptError = err instanceof ApiError ? err.message : 'Operazione non riuscita';
  } finally {
    saving = false;
  }
}

async function doConfirm() {
  const c = ui.confirm;
  ui.confirm = null;
  await c?.confirm();
}
</script>

{#if ui.addToPlaylist}
  <Sheet label="Aggiungi a playlist" onclose={() => (ui.addToPlaylist = null)}>
    <h2 class="sheet-title">Aggiungi a playlist</h2>
    <button class="row new" onclick={newPlaylistFor}>
      <span class="plus"><Icon name="plus" /></span> Nuova playlist
    </button>
    {#each library.playlists ?? [] as p (p.id)}
      <button class="row" onclick={() => addTo(p.id, p.name)}>
        <span class="ellipsis">{p.name}</span>
        <span class="muted count">{p.trackCount}</span>
      </button>
    {/each}
  </Sheet>
{/if}

{#if ui.editTrack}
  <Sheet label="Modifica informazioni" onclose={() => (ui.editTrack = null)}>
    <form onsubmit={saveEdit} novalidate>
      <h2 class="sheet-title">Modifica informazioni</h2>
      <div class="field">
        <label for="edit-title">Titolo</label>
        <input id="edit-title" class="input" bind:value={edit.title} maxlength="300" />
      </div>
      <div class="field">
        <label for="edit-artist">Artista</label>
        <input id="edit-artist" class="input" bind:value={edit.artist} maxlength="300" />
      </div>
      <div class="field">
        <label for="edit-album">Album (facoltativo)</label>
        <input id="edit-album" class="input" bind:value={edit.album} maxlength="300" />
      </div>
      <div class="field">
        <label for="edit-genres">Generi</label>
        <GenreInput id="edit-genres" bind:value={edit.genres} suggest={(p, ex) => catalog.suggestGenres(p, ex)} />
      </div>
      {#if editError}<p class="field-error" role="alert">{editError}</p>{/if}
      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick={() => (ui.editTrack = null)}>Annulla</button>
        <button type="submit" class="btn btn-primary" disabled={saving}>Salva</button>
      </div>
    </form>
  </Sheet>
{/if}

{#if ui.prompt}
  <Sheet label={ui.prompt.title} onclose={() => (ui.prompt = null)}>
    <form onsubmit={submitPrompt} novalidate>
      <h2 class="sheet-title">{ui.prompt.title}</h2>
      <div class="field">
        <label for="prompt-input">{ui.prompt.label}</label>
        <input
          id="prompt-input"
          class="input"
          bind:value={promptValue}
          maxlength="100"
          aria-invalid={promptError ? 'true' : undefined}
          aria-describedby={promptError ? 'prompt-error' : undefined}
        />
        {#if promptError}<span id="prompt-error" class="field-error" role="alert">{promptError}</span>{/if}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick={() => (ui.prompt = null)}>Annulla</button>
        <button type="submit" class="btn btn-primary" disabled={saving}>{ui.prompt.confirmLabel}</button>
      </div>
    </form>
  </Sheet>
{/if}

{#if ui.confirm}
  <Sheet label={ui.confirm.title} onclose={() => (ui.confirm = null)}>
    <h2 class="sheet-title">{ui.confirm.title}</h2>
    <p class="muted message">{ui.confirm.message}</p>
    <div class="actions">
      <button class="btn btn-secondary" onclick={() => (ui.confirm = null)}>Annulla</button>
      <button class="btn btn-primary" class:danger={ui.confirm.danger} onclick={doConfirm}>
        {ui.confirm.confirmLabel}
      </button>
    </div>
  </Sheet>
{/if}

<style>
  .sheet-title {
    font-size: var(--fs-l);
    font-weight: 700;
    margin-bottom: var(--space-4);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    text-align: left;
  }
  .row .count {
    margin-left: auto;
    font-size: var(--fs-s);
  }
  .new {
    font-weight: 600;
  }
  .plus {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-s);
    background: var(--surface-hover);
  }
  .message {
    margin-bottom: var(--space-5);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
  .danger {
    background: var(--danger);
  }
</style>
