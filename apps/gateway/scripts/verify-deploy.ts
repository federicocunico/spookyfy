/**
 * Verifica di un deploy pubblicato della modalità client (PWA + API del gateway):
 * file statici, rotte, protezioni e, con il token di invito, il percorso completo di
 * un account di prova (registrazione → sessione → ricerca → logout → login), poi
 * eliminato dal database.
 *
 *   pnpm verify:prod                                   # https://spookyfy-ten.vercel.app
 *   pnpm verify:prod https://<progetto>.vercel.app
 *
 * Variabili (lette anche da apps/gateway/.env, creato da `vercel env pull`):
 *   VERIFY_REGISTRATION_TOKEN (o REGISTRATION_TOKEN)  token di invito: senza, niente account di prova
 *   REDIS_URL (o credenziali Upstash)                 per eliminare l'account di prova alla fine
 *   VERIFY_SKIP_YOUTUBE=1                             salta la ricerca su YouTube
 *
 * Esce con codice 1 se un controllo fallisce. Documentazione: docs/verifica-deploy.md.
 */
import { GatewayUsers } from '../lib/auth.js';
import { kvConfigFromEnv } from '../lib/config.js';
import { createKv, systemClock } from '../lib/kv.js';

const DEFAULT_URL = 'https://spookyfy-ten.vercel.app';
const base = new URL(process.argv[2] ?? process.env.SPOOKYFY_URL ?? DEFAULT_URL).origin;
const token = process.env.VERIFY_REGISTRATION_TOKEN || process.env.REGISTRATION_TOKEN || '';
const skipYoutube = process.env.VERIFY_SKIP_YOUTUBE === '1';

let failures = 0;
let warnings = 0;

class CheckError extends Error {}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new CheckError(message);
}

/** Esegue un controllo; se restituisce una stringa, è una nota mostrata accanto al ✓. */
async function check(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  const t0 = performance.now();
  try {
    const note = await fn();
    const ms = Math.round(performance.now() - t0);
    console.log(`  ✓ ${name} (${ms} ms)${typeof note === 'string' ? ` — ${note}` : ''}`);
    return true;
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message.replace(/\n/g, '\n      ')}`);
    return false;
  }
}

function warn(message: string) {
  warnings++;
  console.log(`  ! ${message}`);
}

interface Res {
  status: number;
  headers: Headers;
  text: string;
  // biome-ignore lint/suspicious/noExplicitAny: JSON di risposte arbitrarie, controllato campo per campo
  json: any;
}

/** Richiesta senza redirect automatici: un 302 verso il login di Vercel va visto. */
async function http(
  method: string,
  path: string,
  o: { body?: unknown; origin?: string | null; cookie?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.origin !== null && method !== 'GET') headers.origin = o.origin ?? base;
  if (o.cookie) headers.cookie = o.cookie;
  const r = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, headers: r.headers, text, json };
}

function expectStatus(r: Res, status: number, code?: string) {
  const got = `HTTP ${r.status}${r.json?.error ? ` ${r.json.error.code}: ${r.json.error.message}` : ''}`;
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location') ?? '';
    assert(
      false,
      `atteso HTTP ${status}, ricevuto redirect ${r.status} verso ${loc.slice(0, 80)}` +
        (loc.includes('vercel.com')
          ? '\n(Deployment Protection di Vercel: usa il dominio di produzione)'
          : ''),
    );
  }
  assert(
    r.status === status,
    `atteso HTTP ${status}${code ? ` ${code}` : ''}, ricevuto ${got}` +
      (r.status === 429
        ? '\n(limite anti-tentativi per questo IP: ogni verifica ne usa uno, aspetta e riprova)'
        : ''),
  );
  if (code) assert(r.json?.error?.code === code, `atteso codice ${code}, ricevuto ${got}`);
}

function sessionCookie(r: Res): string {
  const set = r.headers.getSetCookie().find((c) => c.startsWith('spk_session='));
  assert(set, 'nessun cookie di sessione nella risposta');
  return set.split(';')[0]!;
}

console.log(`Verifica di ${base}\n`);

console.log('App (PWA)');
let assetPath: string | undefined;
await check('pagina iniziale', async () => {
  const r = await http('GET', '/');
  expectStatus(r, 200);
  assert(r.headers.get('content-type')?.includes('text/html'), 'la pagina non è HTML');
  assert(/<title>Spookyfy<\/title>/.test(r.text), 'titolo Spookyfy assente: è il progetto giusto?');
  assetPath = r.text.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert(assetPath, 'nessuno script /assets/*.js nella pagina');
});
await check('percorsi profondi serviti dall’app (/login, /register, /settings)', async () => {
  for (const p of ['/login', '/register', '/settings']) {
    const r = await http('GET', p);
    expectStatus(r, 200);
    assert(r.text.includes('<title>Spookyfy</title>'), `${p} non restituisce l'app`);
  }
});
await check('script dell’app con cache immutabile', async () => {
  const r = await http('GET', assetPath!);
  expectStatus(r, 200);
  assert(r.headers.get('cache-control')?.includes('immutable'), 'cache-control senza immutable');
});
await check('manifest e service worker', async () => {
  const m = await http('GET', '/manifest.webmanifest');
  expectStatus(m, 200);
  assert(m.json?.name && m.json?.start_url && m.json?.icons?.length, 'manifest incompleto');
  const sw = await http('GET', '/sw.js');
  expectStatus(sw, 200);
  assert(/javascript/.test(sw.headers.get('content-type') ?? ''), 'sw.js non è JavaScript');
  return `display ${m.json.display}`;
});

console.log('\nAPI');
await check('GET /api/health: modalità client', async () => {
  const r = await http('GET', '/api/health');
  expectStatus(r, 200);
  assert(r.json?.status === 'ok' && r.json?.mode === 'client', `risposta inattesa: ${r.text.slice(0, 200)}`);
  return `versione ${r.json.version ?? '?'}`;
});
await check('GET /api/auth/me senza sessione → 401', async () => {
  expectStatus(await http('GET', '/api/auth/me'), 401, 'UNAUTHENTICATED');
});
await check('azione inesistente /api/auth/nessuna → 404 JSON', async () => {
  const r = await http('GET', '/api/auth/nessuna');
  expectStatus(r, 404, 'NOT_FOUND');
});
await check('GET /api/search senza sessione → 401', async () => {
  expectStatus(await http('GET', '/api/search?q=test'), 401, 'UNAUTHENTICATED');
});
await check('registrazione da un sito terzo → 403 FORBIDDEN_ORIGIN', async () => {
  const r = await http('POST', '/api/auth/register', { body: {}, origin: 'https://evil.example' });
  expectStatus(r, 403, 'FORBIDDEN_ORIGIN');
});
await check('registrazione senza Origin → 403 FORBIDDEN_ORIGIN', async () => {
  expectStatus(await http('POST', '/api/auth/register', { body: {}, origin: null }), 403, 'FORBIDDEN_ORIGIN');
});
await check('registrazione vuota → 400 con errori per campo', async () => {
  const r = await http('POST', '/api/auth/register', { body: {} });
  expectStatus(r, 400, 'VALIDATION_FAILED');
  const fields = Object.keys(r.json.error.fields ?? {}).sort();
  assert(fields.join() === 'password,token,username', `campi: ${fields.join()}`);
});
await check('login errato → 401 INVALID_CREDENTIALS', async () => {
  const r = await http('POST', '/api/auth/login', {
    body: { username: `verify-nessuno-${Date.now().toString(36)}`, password: 'Sbagliata#2026' },
  });
  expectStatus(r, 401, 'INVALID_CREDENTIALS');
});

console.log('\nAccount di prova');
if (!token) {
  warn(
    'VERIFY_REGISTRATION_TOKEN non impostata: percorso con account saltato (vedi docs/verifica-deploy.md)',
  );
} else {
  const username = `verify-${Date.now().toString(36)}`;
  const password = `Verifica#${Math.random().toString(36).slice(2, 10)}1`;
  let created = false;
  let cookie = '';

  const ok = await check(
    `registrazione di ${username} (token con spazi, come da tastiera) → 201`,
    async () => {
      const r = await http('POST', '/api/auth/register', {
        body: { username, password, token: ` ${token} ` },
      });
      expectStatus(r, 201);
      created = true;
      const set = r.headers.getSetCookie().find((c) => c.startsWith('spk_session=')) ?? '';
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax'])
        assert(set.includes(flag), `cookie di sessione senza ${flag}`);
      cookie = sessionCookie(r);
    },
  );
  if (ok) {
    await check('sessione: GET /api/auth/me → 200', async () => {
      const r = await http('GET', '/api/auth/me', { cookie });
      expectStatus(r, 200);
      assert(r.json?.username === username, `username ${r.json?.username}`);
    });
    await check('stesso username in maiuscolo → 409 USERNAME_TAKEN', async () => {
      const r = await http('POST', '/api/auth/register', {
        body: { username: username.toUpperCase(), password, token },
      });
      expectStatus(r, 409, 'USERNAME_TAKEN');
    });
    if (skipYoutube) warn('ricerca su YouTube saltata (VERIFY_SKIP_YOUTUBE=1)');
    else {
      let firstId: string | undefined;
      await check('ricerca su YouTube → risultati', async () => {
        const r = await http('GET', '/api/search?q=nirvana', { cookie });
        expectStatus(r, 200);
        assert(r.json?.items?.length > 0, 'nessun risultato');
        firstId = r.json.items[0].sourceId;
        return `${r.json.items.length} risultati`;
      });
      if (firstId) {
        // Limite noto: da Vercel YouTube spesso rifiuta metadati e audio (docs/deploy-vercel.md).
        const r = await http('GET', `/api/meta/${encodeURIComponent(firstId)}`, { cookie });
        if (r.status === 200) console.log('  ✓ metadati da YouTube disponibili: «Aggiungi» funziona');
        else if (r.json?.error?.code === 'YOUTUBE_BLOCKED')
          warn(
            'metadati e audio bloccati da YouTube su questi IP (limite noto: usa «Importa da file» o il ponte)',
          );
        else {
          failures++;
          console.log(`  ✗ metadati da YouTube: HTTP ${r.status} ${r.text.slice(0, 200)}`);
        }
      }
    }
    await check('logout → 204 e sessione revocata', async () => {
      expectStatus(await http('POST', '/api/auth/logout', { body: {}, cookie }), 204);
      expectStatus(await http('GET', '/api/auth/me', { cookie }), 401);
    });
    await check('login con username in maiuscolo → 200', async () => {
      const r = await http('POST', '/api/auth/login', {
        body: { username: username.toUpperCase(), password },
      });
      expectStatus(r, 200);
      sessionCookie(r);
    });
    // Per ultimo: conta come tentativo fallito (5 ogni 15 minuti per IP).
    await check('token di invito errato → 403 INVALID_REGISTRATION_TOKEN', async () => {
      const r = await http('POST', '/api/auth/register', {
        body: { username: `${username}-x`, password, token: `${token}-sbagliato` },
      });
      expectStatus(r, 403, 'INVALID_REGISTRATION_TOKEN');
    });
  }

  if (created) {
    const kv = kvConfigFromEnv(process.env);
    if (!kv) {
      warn(
        `account ${username} non eliminato: manca REDIS_URL. Eliminalo con\n` +
          `      pnpm --filter @spookyfy/gateway cli user:delete ${username}`,
      );
    } else {
      await check(`eliminazione di ${username} dal database`, async () => {
        const store = createKv(kv);
        try {
          await new GatewayUsers(store, systemClock).delete(username);
        } finally {
          await (store as { close?: () => Promise<void> }).close?.();
        }
      });
    }
  }
}

console.log(
  `\n${failures ? `✗ ${failures} controlli falliti` : '✓ tutto in ordine'}${warnings ? `, ${warnings} avvisi` : ''}`,
);
process.exit(failures ? 1 : 0);
