# Test e verifica del deploy

Tre livelli, dal più veloce al più vicino al telefono vero:

| Cosa | Comando | Dove gira |
|---|---|---|
| Unit e integrazione | `pnpm test` | locale, CI |
| End-to-end locali (on-premise e client, Chromium e WebKit) | `pnpm test:e2e` | locale, CI |
| Verifica del deploy pubblicato: API | `pnpm verify:prod [URL]` | locale, CI dopo ogni deploy |
| Verifica del deploy pubblicato: browser (iPhone e Android) | `pnpm verify:prod:ui` | locale, CI dopo ogni deploy |

## End-to-end locali

```bash
pnpm test:e2e                                                         # tutto (build compreso)
pnpm --filter @spookyfy/e2e exec playwright test tests/auth.spec.ts   # solo registrazione e accesso
pnpm --filter @spookyfy/e2e exec playwright test --project client-webkit   # solo modalità client, WebKit
```

`e2e/tests/auth.spec.ts` gira in **entrambe le modalità** (server on-premise e gateway della modalità client) con Pixel 7 (Chromium) e iPhone 14 (WebKit). Prova:
- errori spiegati sotto i campi (username non valido, password debole, conferma diversa, token sbagliato, username già usato);
- token e username con spazi ai bordi, come dopo un incolla dal telefono;
- sessione dopo il ricaricamento, uscita, password errata, accesso con lo username in maiuscolo;
- rotte: app sui percorsi profondi, manifest, service worker, health, `401` senza sessione, `400` con errori per campo, `403` da un'origine estranea.

## Verifica del deploy pubblicato

Prima, una tantum, prendi le variabili di produzione (per eliminare gli account di prova alla fine):

```bash
vercel env pull apps/gateway/.env --environment=production --yes
```

Poi:

```bash
export VERIFY_REGISTRATION_TOKEN='il-token-di-invito'    # PowerShell: $env:VERIFY_REGISTRATION_TOKEN='…'
pnpm verify:prod                                          # https://spookyfy-ten.vercel.app
pnpm verify:prod https://<progetto>.vercel.app            # altro deploy
pnpm verify:prod:ui                                       # browser; altro URL con SPOOKYFY_URL=…
```

**`pnpm verify:prod`** (`apps/gateway/scripts/verify-deploy.ts`) controlla:
- **App**: pagina iniziale, percorsi profondi (`/login`, `/register`, `/settings`), script con cache immutabile, manifest, service worker;
- **API**: `/api/health` in modalità client, `401` senza sessione, `404` JSON per un'azione inesistente, `403 FORBIDDEN_ORIGIN` da un sito terzo e senza `Origin`, `400` con errori per campo, `401` con credenziali errate;
- **Account di prova** (solo con `VERIFY_REGISTRATION_TOKEN`): registrazione con il token seguito da spazi `201`, cookie `HttpOnly`/`Secure`/`SameSite=Lax`, `me`, username duplicato `409`, ricerca su YouTube, metadati (se YouTube li blocca è un avviso, non un errore), logout con revoca della sessione, nuovo login e, per ultimo, token errato `403`. Alla fine l'account `verify-…` viene eliminato da Redis.

Il token errato conta come tentativo fallito: dallo stesso IP si possono fare circa **5 verifiche ogni 15 minuti**, poi le registrazioni rispondono `429` finché la finestra non scade.

**`pnpm verify:prod:ui`** (`e2e/remote/registration.spec.ts`) fa lo stesso percorso dall'interfaccia, con iPhone 14 (WebKit) e Pixel 7 (Chromium): crea l'account, ricarica, cerca, esce e rientra. Gli account `verify-ui-…` vengono eliminati con la CLI del gateway.

Esce con codice 1 se qualcosa fallisce. Senza `REDIS_URL` gli account di prova restano e lo script stampa il comando per eliminarli (`pnpm --filter @spookyfy/gateway cli user:delete <nome>`).

### In CI

Dopo ogni deploy su `main`, il job `verify-production` richiama `.github/workflows/verify-production.yml`, che esegue entrambe le verifiche. Si può lanciare anche a mano: **Actions → Verifica produzione → Run workflow**, con un URL facoltativo. Serve il secret con il token di invito:

```bash
gh secret set VERIFY_REGISTRATION_TOKEN     # stesso valore di REGISTRATION_TOKEN su Vercel
```

Se cambi `REGISTRATION_TOKEN` su Vercel, aggiorna anche questo secret.

## Se la registrazione dal telefono non va

| Cosa vedi | Causa probabile | Cosa fare |
|---|---|---|
| «Origine della richiesta non consentita» | richiesta da un dominio diverso da quello dell'app | apri l'URL di produzione (`https://spookyfy-ten.vercel.app`), non un URL di deploy |
| Pagina di login di **Vercel** invece dell'app | URL di un singolo deploy (`spookyfy-xxxx-<team>.vercel.app`), protetto da Vercel Authentication | come sopra |
| «Token di invito non valido» | token diverso da `REGISTRATION_TOKEN` (fino al 29/10/2026 anche per uno spazio incollato in coda) | ricopia il token; verifica con `pnpm verify:prod` |
| Pulsante «Crea account» grigio | campo non valido: il motivo è scritto in rosso sotto il campo | correggi il campo indicato |
| «Server non raggiungibile» | telefono offline o `/api/health` non risponde | `curl https://<progetto>.vercel.app/api/health` |
| «Troppi tentativi» | 5 errori in 15 minuti dallo stesso IP (token di invito sbagliato o login fallito) | aspetta il tempo indicato |
| «Errore del server (HTTP 5xx)» | funzione in errore (es. Redis non raggiungibile) | log qui sotto |

Log delle funzioni (sul piano Hobby restano circa **un'ora**: guardali subito dopo il tentativo):

```bash
vercel logs --no-branch --environment production --since 1h
vercel logs --no-branch --environment production --since 1h --status-code 4xx -x
```
