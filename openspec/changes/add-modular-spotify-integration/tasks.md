# Tasks

## 1. Contratti e preparazione (`music-provider-isolation`, design D1–D2)

- [x] 1.1 Definire `MediaRef`, DTO Spotify, occurrence ID, capacità, errori e schemi delle nuove API in `packages/shared`, lasciando invariato `TrackDto`; verificare collisioni locale/Spotify e rifiuto dei payload misti con test unitari.
- [x] 1.2 Creare `packages/spotify` backend-only e aggiornare dipendenze workspace/script build del server e gateway; verificare build pulito e assenza di import del package server nel grafo web.
- [x] 1.3 Aggiungere configurazione Spotify opzionale con flag spenti e fake esplicito test/dev; verificare avvio server/gateway senza env, con env incomplete e fake rifiutato in produzione.
- [x] 1.4 Preparare fixture sintetiche e fetch/SDK finti per profilo con/senza product, account_id, playlist nuove, null/episodi, errori e timeout; verificare che i test non richiedano rete Spotify o credenziali personali.
- [x] 1.5 Eseguire baseline di player, queue, auth, libreria device e backup prima di modificarli e documentare i contratti/flag in `docs/spotify.md`, citando le reference D3–D8; verificare esiti registrati e corrispondenza tra nomi documentati e tipi.

## 2. OAuth, token e store (`spotify-account-linking`, design D3–D5)

- [x] 2.1 Implementare generazione/verifica PKCE e pending monouso con TTL, binding a utente e sessione iniziatrice, redirect consentito e gestione diniego; verificare state errato/scaduto/riusato, cambio sessione e redirect ostile con test del core.
- [x] 2.2 Implementare envelope AES-GCM con AAD/key ID e validazione chiavi dedicata; verificare cifratura, manomissione, scambio fra utenti e rotazione senza esporre segreti nelle risposte.
- [x] 2.3 Implementare lettura profilo e associazione tramite account_id unico, scope incrementali e protezione del link precedente; verificare collisione fra utenti, identità mancante e ricollegamento con account differente.
- [x] 2.4 Implementare token manager con scadenza, margine, refresh ruotato/omesso, autorizzazione di 6 mesi e invalid_grant; verificare rinnovo e passaggio a reauth senza invalidare Spookyfy con clock finto.
- [x] 2.5 Aggiungere store SQLite con migrazioni Drizzle additive, claim/CAS e generazioni; verificare migrazione di un DB popolato, univocità, callback concorrenti, unlink durante refresh e integrità di tracks/playlist esistenti.
- [x] 2.6 Aggiungere primitive atomiche di consume/CAS/lease per Redis TCP, Upstash e MemoryKv e store gateway; verificare due istanze concorrenti, lease scaduta, fencing e recovery dell'indice inverso con test per ciascun adapter.
- [x] 2.7 Documentare in `docs/spotify.md` custodia credenziali, scope, redirect e durata autorizzazioni; verificare che nessuna procedura richieda il linking personale prima dell'ultima fase.

## 3. API Spotify e resilienza (`spotify-library`, design D6–D7)

- [x] 3.1 Implementare client REST con host fissi, validazione risposte, AbortSignal e budget timeout; verificare 204, JSON inatteso, campi aggiuntivi/mancanti, annullamento e URL di paginazione ostile.
- [x] 3.2 Implementare ricerca per tipo, brani/album salvati e dettagli track/album/artist; verificare pagine da massimo 10 per ricerca, offset/cursor, null e assenza degli endpoint rimossi usando fetch finto.
- [x] 3.3 Implementare elenco/dettaglio playlist e `/items` con normalizzazione della shape corrente; verificare ordine, duplicati, metadata-only, 403 di lettura ed elementi non supportati senza fallback YouTube.
- [x] 3.4 Implementare salvataggi track/album tramite `/me/library`; verificare parametro URI, chunk massimo 40, scope e indipendenza dai preferiti locali.
- [x] 3.5 Implementare creazione e metadati playlist con default privato, add/remove/reorder con snapshot e gestione conflitti; verificare payload contro reference, duplicati, operazioni a chunk ed esito incerto senza retry distruttivi.
- [x] 3.6 Implementare mapping errori, retry limitati, cooldown condiviso, circuit breaker e quota exceeded; verificare 401 upstream, 403 ambiguo, Retry-After, quota senza durata e recupero con clock finto.
- [x] 3.7 Implementare comandi playback/dispositivi e stato remoto con payload enumerati; verificare device assente/restricted, comandi non consentiti e risposte 204 senza dichiarare un falso stato playing.
- [x] 3.8 Documentare matrice endpoint/scope e semantica errori/esito incerto in `docs/spotify.md`; verificare ogni metodo rispetto al link ufficiale corrente indicato nel design.

## 4. Rotte e ciclo di vita dei backend (design D2, D5–D7, D10)

- [x] 4.1 Esporre nel server Fastify le azioni tipizzate `/api/spotify/*` senza allargare il bridge; verificare cookie obbligatorio, Origin sulle mutazioni, callback GET protetta e token bridge rifiutato.
- [x] 4.2 Aggiungere `api/spotify/[action].ts`, handler condiviso, routing del dev-server e configurazione Vercel; verificare parità di contratti col server, allowlist azioni e conteggio funzioni 8/12.
- [x] 4.3 Esporre status e access token SDK effimero; verificare Premium/Free/unknown, `no-store`, token esclusi da status/errori e nessun contatto upstream con modulo spento.
- [x] 4.4 Integrare unlink/account deletion nei servizi e CLI di entrambi i backend, revocando pending/generazioni e pulendo indici; verificare callback/refresh tardivi, eliminazione utente e isolamento da altri account.
- [x] 4.5 Redigere URL callback, header e corpi sensibili nei log; verificare con logger catturato che code/state/token/verifier non compaiano nemmeno nei percorsi d'errore.
- [x] 4.6 Aggiornare esempi env, `docs/auth.md` e `docs/deploy-vercel.md` per modulo facoltativo, chiavi/rotazione e limiti reali; verificare che la configurazione di base documentata funzioni ancora senza Spotify.

## 5. Raccolte multisorgente e backup (`hybrid-playlists`, design D9–D10)

- [x] 5.1 Implementare servizio/API on-premise per raccolte ibride con tabelle additive e vincoli dei riferimenti; verificare ownership, ordine frazionario, duplicati, rimozione file e copia da playlist legacy senza modificarla.
- [x] 5.2 Implementare IndexedDB v4 e repository client segregato per user ID; verificare upgrade da v1/v2/v3, vecchie playlist e cache integre, operazioni offline e accesso negato fra utenti.
- [x] 5.3 Implementare copia esplicita da Spotify con riferimenti e rapporto degli elementi esclusi, senza download; verificare pagine parziali/interrotte evitando raccolte dichiarate complete e preservando ordine/duplicati.
- [x] 5.4 Estendere backup v1 con `hybridCollections` opzionale, validazione integrale, unione idempotente e restore remoto inerte; verificare backup vecchio, doppio import, account Spotify differente e file danneggiato senza mutazioni parziali.
- [x] 5.5 Implementare purge del solo link scollegato, riconciliazione generazioni e rimozione dei riferimenti remoti lasciando intatti quelli locali; verificare unlink, logout/cambio account, tab multiple e ripresa di un dispositivo inattivo.
- [x] 5.6 Documentare formato backup, compatibilità lettori vecchi, restore e rollback v4; verificare ZIP senza token/profili/artwork/audio Spotify e ripristino completo della parte locale.

## 6. Motori e coda (`spotify-playback`, `hybrid-playlists`, design D8)

- [x] 6.1 Introdurre adapter locale e controller facoltativo preservando il gesto sincrono e l'unico `<audio>`; verificare i test esistenti di play/seek/trim/coda/restore e sostituzione del brano in importazione con Spotify spento.
- [x] 6.2 Implementare loader SDK lazy, access token in memoria, listener e teardown; verificare ready/not_ready, caricamento fallito, auth/account error, annullamento/logout e assenza SDK nel bundle iniziale.
- [x] 6.3 Implementare device picker, trasferimento solo esplicito e trasporto rispettando disallows; verificare stato aggiornato dai segnali remoti, dispositivo perso e mancata riattivazione automatica del browser.
- [x] 6.4 Implementare handoff con generazioni, arresto confermato e recupero quando incerto; verificare locale→Spotify→locale, rifiuto pausa, eventi tardivi, richieste sovrapposte e assenza di doppio audio usando engine finti.
- [x] 6.5 Implementare coda a occorrenze per raccolte ibride simulate con shuffle/repeat e skip limitati; verificare duplicati, fine duplicata, tutti indisponibili con repeat e modifica esterna senza avanzamento spurio.
- [x] 6.6 Integrare needs-gesture, activateElement e restore in pausa; verificare gesture bloccata, resume manuale e nessun salto dell'elemento soltanto bloccato dall'autoplay.
- [x] 6.7 Collegare Media Session al motore attivo ed escludere Spotify da PlayReporter/trim/statistiche; verificare comandi lockscreen simulati, logout, errori e mancata registrazione di ascolti Spotify.
- [x] 6.8 Aggiornare le checklist `docs/verification-ios.md` e `docs/verification-android.md` distinguendo motori, background, PWA e limiti ancora da provare; verificare che i test simulati non siano descritti come prove su dispositivi fisici.

## 7. Interfaccia e composizione web (design D1–D2, D7, D10)

- [x] 7.1 Comporre il modulo opzionale in `createServices`, con trasporto che separa errori Spotify da sessione/connessione Spookyfy; verificare bootstrap senza Spotify e 401/timeout provider mentre locale/YouTube restano operativi.
- [x] 7.2 Aggiungere impostazioni linking/unlink/consenso e avvisi Premium/unknown/accesso/quote; verificare registrazione locale obbligatoria, diniego OAuth, scope incrementali e cleanup con test di componente.
- [x] 7.3 Aggiungere scheda ricerca Spotify con filtri tipo, cancellazione, paginazione e attribuzione; verificare risultati obsoleti scartati e indipendenza degli errori dalle altre sorgenti.
- [x] 7.4 Aggiungere viste Spotify per brani/album/playlist e dettagli artista/album, menu remoti e modifiche esplicite; verificare scope mancanti, playlist read-only, conflitto/esito incerto e assenza di azioni download/tag.
- [x] 7.5 Integrare raccolte ibride, aggiunta/copia/riordino e badge provider nelle viste playlist, mini/full player e coda; verificare ordine/duplicati, policy disattivata, missing item e distinzione da playlist native.
- [x] 7.6 Adattare download raccolte e indicazioni offline filtrando i soli file locali; verificare che SW, cache e richieste audio non ricevano contenuti Spotify e che il download riporti gli esclusi.
- [x] 7.7 Aggiornare README/guida e `docs/spotify.md` per flussi utente e limiti del rilascio; verificare percorsi UI, accessibilità di link/controlli, attribuzione e corrispondenza ai flag effettivi.

## 8. Verifica integrata dell'agente principale

- [x] 8.1 Rivedere personalmente codice e contratti dei subagent per OAuth, segreti, concorrenza, cleanup, ownership e dipendenze modulari; verificare gli scenari delle cinque spec e risolvere tutte le discrepanze prima della prova personale.
- [x] 8.2 Eseguire E2E Chromium/WebKit su server e client con provider/SDK finti: registrazione→link→ricerca→playlist nativa→raccolta ibrida→offline→backup→unlink; verificare persistenza locale e assenza di credenziali reali.
- [x] 8.3 Eseguire matrice regressioni con Spotify assente, config errata, 401, 403, 429/quota, 5xx, timeout e SDK bloccato; verificare login, YouTube, file, album/generi, playback, bridge e backup locali operativi.
- [x] 8.4 Eseguire `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm --filter @spookyfy/gateway count-functions` e `openspec validate add-modular-spotify-integration --strict`; verificare esiti e distinguere eventuali prerequisiti ambientali dai difetti del codice.
- [x] 8.5 Verificare build/deploy preview senza credenziali Spotify e rollback con flag spenti preservando IndexedDB v4; se si esegue un push, monitorare tutti i workflow scatenati fino a stato terminale e correggere i fallimenti prima di dichiarare la verifica conclusa.

## 9. Ultima fase: Spotify reale con il proprietario

- [ ] 9.1 Prima di attivare Spotify reale, risolvere e registrare in `docs/spotify.md` l'esito del vincolo di piattaforma sul wrapper/ibrido; verificare che nessuna capacità non ammessa venga abilitata. Se irrisolto, lasciare questa fase incompleta senza bloccare la parte locale.
- [ ] 9.2 Con il proprietario, predisporre app dashboard, allowlist, origini/redirect esatti e chiavi dedicate nei due ambienti richiesti; verificare configurazione senza stampare segreti e senza modificarne l'account Spookyfy.
- [ ] 9.3 Collegare l'account personale soltanto dopo 8 e 9.1–9.2; verificare callback, account_id, scope, Premium o unknown, rinnovo e unlink reale registrando l'esito senza identificatori/token sensibili.
- [ ] 9.4 Provare ricerca, playlist autorizzate e playback nei limiti ammessi usando una playlist di prova scelta esplicitamente; verificare nessuna modifica alle playlist personali preesistenti e cleanup della sola risorsa di prova.
- [ ] 9.5 Eseguire checklist fisiche desktop/iPhone/Android con PWA, blocco schermo, Connect e ritorno offline; verificare e documentare ogni capacità supportata, limitazione e mancata verifica senza equiparare mock a streaming reale.

## Workflow follow-up

- Eseguire l'apply solo dopo un nuovo messaggio dell'utente, come richiesto dalla skill propose invocata; nessuna implementazione fa parte della creazione di questi artefatti.
- All'avvio dell'apply l'agente principale stabilizza contratti e baseline, poi assegna sotto-task circoscritti a subagent specializzati con budget di contesto ridotto: `gpt-6-luna` per fixture/UI/adapter semplici, `gpt-6.1-sol` con effort moderato per unità OAuth/KV/player più complesse. La verifica trasversale resta all'agente principale con effort elevato, come richiesto dall'utente.
- Ownership suggerita: package Spotify/core; adapter backend e migrazioni; storage/UI web. Non più di tre subagent concorrenti; evitare edit contemporanei a shared, services, config e file build, integrandoli dall'agente principale dopo il contratto concordato.
- Ogni consegna di subagent include file cambiati, test eseguiti e limitazioni; l'agente principale non accetta soltanto il riepilogo e controlla diff e verifiche effettive.
- Archiviare la change solo dopo completamento delle attività effettivamente richieste; i vincoli reali irrisolti restano visibili, senza segnare conclusa la fase personale.
