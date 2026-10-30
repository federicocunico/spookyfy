# Autenticazione

Spookyfy non ha registrazione pubblica: per creare un account dall'app serve il **token di invito** configurato sul server. In alternativa, l'amministratore crea gli account dalla riga di comando.

## Token di invito

| Variabile | Default | Effetto |
|---|---|---|
| `REGISTRATION_TOKEN` | `spotifymerdacostosa2026` | Token da inserire nella schermata "Crea un account". |
| `REGISTRATION_TOKEN=` (vuoto) | — | Registrazione dall'app **disabilitata**. |

- Il valore predefinito è pubblicato in questo repository: **cambialo in produzione**. Se resta quello predefinito, all'avvio il server scrive un avviso nel log.
- Per cambiarlo, modifica il file `.env` del server e riavvia il servizio (`sudo systemctl restart spookyfy`). Gli account già creati restano validi.
- Quando non servono nuove registrazioni, lascialo vuoto.
- Dopo 5 tentativi con token errato dallo stesso IP in 15 minuti, la registrazione da quell'IP viene bloccata per il resto della finestra.

## Requisiti

**Username**: da 3 a 32 caratteri, solo lettere, cifre, `.`, `_` e `-`. Unico senza distinzione fra maiuscole e minuscole (`Fede` e `fede` sono lo stesso account). Il login accetta lo username con qualsiasi combinazione di maiuscole.

**Password**: da 8 a 128 caratteri, con almeno una lettera, una cifra e un carattere speciale (qualsiasi carattere che non sia lettera o cifra, ad esempio `#`, `_`, `!` o uno spazio). Esempio valido: `Notte#2026`.

Le stesse regole valgono per la registrazione dall'app, per la CLI e per il cambio password. Le password sono salvate solo come hash Argon2id.

## Gestione account da riga di comando

Dalla cartella del progetto sul server:

```bash
# in sviluppo (sorgenti TypeScript)
pnpm --filter @spookyfy/server cli user:create fede
# in produzione (dopo pnpm build)
pnpm --filter @spookyfy/server cli:prod user:create fede
```

| Comando | Effetto |
|---|---|
| `user:create <username>` | Crea un account. Non richiede il token. |
| `user:passwd <username>` | Reimposta la password e chiude tutte le sessioni aperte dell'utente. |
| `user:list` | Elenca gli account con la data di creazione. |
| `user:delete <username>` | Elimina l'account con sessioni, preferiti, playlist e storico ascolti. I brani importati restano nella libreria condivisa. |

La password **non si passa mai come argomento** (finirebbe nella cronologia della shell): su terminale viene chiesta in modo nascosto, due volte. Negli script si può passare su stdin, una riga per password:

```bash
printf 'Luna_2026\n' | pnpm --filter @spookyfy/server cli user:create anna
```

La CLI legge la stessa configurazione del server (`DATA_DIR` nel file `.env`), quindi va eseguita sulla macchina e con l'utente del servizio.

## Sessioni

- Dopo login o registrazione il server imposta il cookie `spk_session` (`HttpOnly`, `Secure`, `SameSite=Lax`). Nel database c'è solo l'hash SHA-256 del token.
- La sessione dura **30 giorni dall'ultimo utilizzo**: ogni uso dell'app la estende (al massimo una scrittura sul DB all'ora). Dopo 30 giorni di inattività serve un nuovo login.
- "Esci" nelle impostazioni invalida la sessione sul server.
- Dopo 5 login falliti per lo stesso username dallo stesso IP in 15 minuti, ulteriori tentativi vengono rifiutati fino alla scadenza della finestra, anche con la password giusta.
- L'IP del client è letto dall'header `CF-Connecting-IP` impostato da Cloudflare Tunnel (`TRUST_CF_HEADERS=true`). Se il server non è dietro Cloudflare, imposta `TRUST_CF_HEADERS=false`.

## Protezione CSRF

Ogni richiesta che modifica dati (POST, PUT, PATCH, DELETE) deve avere l'header `Origin` uguale a `PUBLIC_ORIGIN`. I browser lo inviano automaticamente; le richieste da altri siti vengono rifiutate con `403`.

`COOKIE_SECURE=false` esiste solo per i test end-to-end su `http://localhost`: non usarlo in produzione.

## Collegamento Spotify facoltativo

Il login Spookyfy resta obbligatorio. Le rotte `/api/spotify/*` accettano soltanto sessioni cookie; i token del ponte non autorizzano il provider. Le mutazioni richiedono Origin esatto; la callback OAuth GET resta autenticata senza richiedere Origin. PKCE, state monouso e impronta della sessione proteggono il ritorno. Nel gateway il rinnovo JWT conserva l'identità logica della sessione; logout revoca l'intera famiglia per 30 giorni.

Refresh token e verifier sono cifrati con una chiave AES dedicata; non usare SESSION_SECRET. Lo scollegamento invalida tentativi e rinnovi concorrenti. La cancellazione account da CLI elimina anche il link. Nessun errore Spotify 401 viene esposto come 401 della sessione Spookyfy. Configurazione, rotazione e vincolo di policy: [Spotify](spotify.md).
