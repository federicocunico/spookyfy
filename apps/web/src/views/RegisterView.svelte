<script lang="ts">
import { passwordSchema, usernameSchema } from '@spookyfy/shared';
import PasswordChecklist from '../components/PasswordChecklist.svelte';
import { ApiError } from '../lib/api';
import { pathOf, safeNext } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

const { session, router, connection } = services();
let username = $state('');
let password = $state('');
let confirm = $state('');
let token = $state('');
let errors = $state<Record<string, string>>({});
let general = $state<string | null>(null);
let busy = $state(false);

// Spazi ai bordi ignorati: la tastiera del telefono li aggiunge dopo un suggerimento.
const usernameCheck = $derived(usernameSchema.safeParse(username.trim()));
const usernameValid = $derived(usernameCheck.success);
/** Errore di formato mostrato mentre si scrive, così il pulsante disabilitato ha un perché. */
const usernameHint = $derived(
  username.trim().length > 0 && !usernameCheck.success
    ? (usernameCheck.error.issues[0]?.message ?? null)
    : null,
);
const passwordValid = $derived(passwordSchema.safeParse(password).success);
const mismatch = $derived(confirm.length > 0 && confirm !== password);
const canSubmit = $derived(
  usernameValid &&
    passwordValid &&
    confirm === password &&
    token.trim().length > 0 &&
    !busy &&
    !connection.offline,
);

/** Gli errori del server spariscono quando l'utente modifica il campo. */
function clearError(field: string) {
  if (errors[field]) errors = { ...errors, [field]: '' };
}

async function submit(e: SubmitEvent) {
  e.preventDefault();
  if (!canSubmit) return;
  busy = true;
  errors = {};
  general = null;
  try {
    await session.register({ username: username.trim(), password, token: token.trim() });
    router.navigate(safeNext(router.route.search), { replace: true });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.isNetwork) general = 'Server non raggiungibile. Controlla la connessione.';
      else if (Object.keys(err.fields).length > 0) {
        errors = Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0] ?? err.message]));
      } else general = err.message;
    } else general = 'Registrazione non riuscita';
  } finally {
    busy = false;
  }
}
</script>

<main class="auth">
  <h1>Crea un account</h1>
  <p class="muted intro">Serve il token di invito fornito da chi gestisce il server.</p>
  <form onsubmit={submit} novalidate>
    <div class="field">
      <label for="reg-username">Username</label>
      <input
        id="reg-username"
        class="input"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        maxlength="32"
        bind:value={username}
        oninput={() => clearError('username')}
        aria-invalid={errors.username || usernameHint ? 'true' : undefined}
        aria-describedby="reg-username-help"
      />
      {#if errors.username || usernameHint}
        <span id="reg-username-help" class="field-error" role="alert">{errors.username || usernameHint}</span>
      {:else}
        <span id="reg-username-help" class="muted hint">3–32 caratteri: lettere, cifre, punto, trattino, underscore</span>
      {/if}
    </div>
    <div class="field">
      <label for="reg-password">Password</label>
      <input
        id="reg-password"
        class="input"
        type="password"
        autocomplete="new-password"
        bind:value={password}
        oninput={() => clearError('password')}
        aria-invalid={errors.password ? 'true' : undefined}
        aria-describedby="reg-password-checklist"
      />
      <PasswordChecklist {password} id="reg-password-checklist" />
      {#if errors.password}<span class="field-error" role="alert">{errors.password}</span>{/if}
    </div>
    <div class="field">
      <label for="reg-confirm">Conferma password</label>
      <input
        id="reg-confirm"
        class="input"
        type="password"
        autocomplete="new-password"
        bind:value={confirm}
        aria-invalid={mismatch ? 'true' : undefined}
      />
      {#if mismatch}<span class="field-error" role="alert">Le password non coincidono</span>{/if}
    </div>
    <div class="field">
      <label for="reg-token">Token di invito</label>
      <input
        id="reg-token"
        class="input"
        autocapitalize="none"
        autocomplete="off"
        spellcheck="false"
        bind:value={token}
        oninput={() => clearError('token')}
        aria-invalid={errors.token ? 'true' : undefined}
      />
      {#if errors.token}<span class="field-error" role="alert">{errors.token}</span>{/if}
    </div>
    {#if general}<p class="field-error" role="alert">{general}</p>{/if}
    {#if connection.offline}
      <p class="field-error" role="alert">Server non raggiungibile: la registrazione richiede la connessione.</p>
    {/if}
    <button class="btn btn-primary submit" type="submit" disabled={!canSubmit}>Crea account</button>
  </form>
  <p class="alt">
    Hai già un account?
    <a
      href={pathOf.login(safeNext(router.route.search))}
      onclick={(e) => {
        e.preventDefault();
        router.navigate(pathOf.login(safeNext(router.route.search)), { replace: true });
      }}>Accedi</a
    >
  </p>
</main>

<style>
  .auth {
    max-width: 420px;
    margin: 0 auto;
    padding: calc(var(--safe-top) + var(--space-6)) var(--space-5) calc(var(--safe-bottom) + var(--space-6));
  }
  h1 {
    font-size: var(--fs-xxl);
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .intro {
    margin: var(--space-2) 0 var(--space-5);
  }
  .hint {
    font-size: var(--fs-xs);
  }
  .submit {
    width: 100%;
    margin-top: var(--space-3);
  }
  .alt {
    margin-top: var(--space-5);
    text-align: center;
    color: var(--text-2);
    font-size: var(--fs-s);
  }
  .alt a {
    color: var(--text);
    font-weight: 700;
    text-decoration: underline;
  }
</style>
