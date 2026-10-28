<script lang="ts">
import { ApiError } from '../lib/api';
import { pathOf, safeNext } from '../lib/router.svelte';
import { services } from '../lib/services.svelte';

const { session, router, connection } = services();
let username = $state('');
let password = $state('');
let error = $state<string | null>(null);
let busy = $state(false);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  if (!username || !password) {
    error = 'Inserisci username e password';
    return;
  }
  busy = true;
  error = null;
  try {
    await session.login(username.trim(), password);
    router.navigate(safeNext(router.route.search), { replace: true });
  } catch (err) {
    error =
      err instanceof ApiError
        ? err.isNetwork
          ? 'Server non raggiungibile. Controlla la connessione.'
          : err.message
        : 'Accesso non riuscito';
  } finally {
    busy = false;
  }
}
</script>

<main class="auth">
  <div class="brand">
    <img src="/icons/icon-192.png" alt="" width="72" height="72" />
    <h1>Spookyfy</h1>
  </div>
  <form onsubmit={submit} novalidate>
    <div class="field">
      <label for="login-username">Username</label>
      <input
        id="login-username"
        class="input"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        bind:value={username}
      />
    </div>
    <div class="field">
      <label for="login-password">Password</label>
      <input
        id="login-password"
        class="input"
        type="password"
        autocomplete="current-password"
        bind:value={password}
        aria-invalid={error ? 'true' : undefined}
      />
    </div>
    {#if error}<p class="field-error" role="alert">{error}</p>{/if}
    <button class="btn btn-primary submit" type="submit" disabled={busy || connection.offline}>Accedi</button>
  </form>
  <p class="alt">
    Non hai un account?
    <a
      href={pathOf.register(safeNext(router.route.search))}
      onclick={(e) => {
        e.preventDefault();
        router.navigate(pathOf.register(safeNext(router.route.search)), { replace: true });
      }}>Crea un account</a
    >
  </p>
</main>

<style>
  .auth {
    max-width: 420px;
    margin: 0 auto;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: calc(var(--safe-top) + var(--space-6)) var(--space-5) calc(var(--safe-bottom) + var(--space-6));
  }
  .brand {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }
  .brand img {
    border-radius: 18px;
  }
  h1 {
    font-size: var(--fs-xxl);
    font-weight: 800;
    letter-spacing: -0.02em;
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
