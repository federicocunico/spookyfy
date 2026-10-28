# Tasks

## 1. Spike di fattibilità: YouTube da Vercel

- [ ] 1.1 Pubblicare su un progetto Vercel di prova una funzione minima con `youtubei.js` che esegue una ricerca, risolve un video e inoltra in streaming l'audio M4A con supporto Range; verificare che un brano da 8 MB arrivi completo (oltre il limite di 4,5 MB) e che una richiesta Range restituisca 206
- [ ] 1.2 Ripetere ricerca e download 20 volte in 24 ore dalle region `fra1` e `iad1` e registrare in `docs/spike-vercel-youtube.md` successi, errori anti-bot, tempi e dimensioni; verificare che il documento indichi la region scelta e se la ricerca dal gateway è affidabile, intermittente o bloccata

## 2. Fondamenta condivise

- [x] 2.1 Aggiungere a `packages/shared` il tipo `HealthDto` (status, mode, version, features) e i codici d'errore `YOUTUBE_BLOCKED`, `VIDEO_UNAVAILABLE`, `VIDEO_TOO_LONG`, `INSUFFICIENT_STORAGE`; verificare che server e web compilino importandoli
- [x] 2.2 Spostare `cleanMetadata` da `apps/server/src/ingest/metadata.ts` a `packages/shared` con i suoi test, e verificare che i test esistenti del server passino invariati
- [x] 2.3 Definire in `packages/shared` gli schemi Zod del formato di backup v1 (manifest, library) con test di validazione su un esempio valido, uno troncato e uno di versione non supportata

## 3. Server on-premise: modalità e ponte (`deployment-modes`, `onpremise-bridge`, `user-auth`)

- [x] 3.1 Estendere `GET /api/health` con modalità `onpremise`, versione e funzionalità e verificare con test che resti pubblica e non contenga dati utente
- [x] 3.2 Aggiungere la tabella `access_tokens` con migrazione Drizzle e un servizio per creare (token mostrato una sola volta, salvato come SHA-256), elencare e revocare; verificare con unit test creazione, revoca e assenza del token in chiaro nel DB
- [x] 3.3 Accettare `Authorization: Bearer` solo sulle rotte marcate per il ponte, esentare queste richieste dal controllo `Origin` (il token valido ha la precedenza anche se il browser allega un cookie) e rifiutare il token sulle rotte di gestione account e token; verificare con test di integrazione importazione con token da un'altra origine (anche con cookie presente), rifiuto di un token falso accompagnato da un cookie valido, rifiuto di creazione token con token e controllo `Origin` invariato per le richieste solo con cookie
- [x] 3.4 Configurare CORS con `BRIDGE_ALLOWED_ORIGINS` (vuota = disabilitato) solo sulle rotte con token, senza credenziali, con `Range` consentito e `Content-Range` esposto; verificare con test le risposte preflight per un'origine autorizzata e una non autorizzata
- [x] 3.5 Limitare a 20 ogni 15 minuti per IP le richieste con token non valido e verificare con test che la ventunesima riceva 429
- [x] 3.6 Aggiungere le rotte `GET/POST/DELETE /api/me/tokens`, i comandi CLI `token:create|token:list|token:revoke` e la sezione "Token di accesso" nelle impostazioni dell'app on-premise; verificare con test di integrazione, test della CLI e test di componente della sezione
- [x] 3.7 Documentare in `docs/bridge.md` configurazione del ponte, token e origini autorizzate, e verificare i comandi documentati eseguendoli

## 4. Gateway: struttura (`cloud-gateway`)

- [x] 4.1 Creare `apps/gateway` (TypeScript, handler Web `GET/POST(request)`, `lib/` condivisa, `vercel.json` con build della PWA in `public`, rewrite SPA, header `no-cache` per `sw.js`, `maxDuration` per funzione, region) e verificare che `vercel build` locale produca le 6 funzioni e i file statici
- [x] 4.2 Scrivere `scripts/count-functions.mjs` che fallisce oltre 12 funzioni, collegarlo al build e alla CI, e verificare con un test che con 13 file in `api/` il controllo fallisca indicando numero e limite
- [x] 4.3 Implementare la configurazione validata con Zod (`SESSION_SECRET`, `REGISTRATION_TOKEN`, `PUBLIC_ORIGIN`, credenziali KV) e un'interfaccia KV con implementazioni Upstash e in memoria; verificare con unit test l'implementazione in memoria (TTL, `SET NX`, `INCR`)
- [x] 4.4 Implementare `dev-server.ts` che esegue gli handler in Node con KV in memoria e client YouTube finto e serve la PWA, e verificare che `pnpm --filter @spookyfy/gateway dev` risponda su `/api/health` con modalità `client`

## 5. Gateway: account e sessioni (`cloud-gateway`)

- [x] 5.1 Implementare registrazione con token di invito, unicità con `SET NX`, regole condivise di username e password e hash Argon2id; verificare con test registrazione riuscita, token errato, token vuoto, `FEDE` dopo `fede`, registrazioni concorrenti
- [x] 5.2 Implementare login, logout, `me` e sessione JWT in cookie con rinnovo dopo un'ora, revoca dopo il logout e invalidazione con `sessionEpoch`; verificare con test e orologio simulato rinnovo, scadenza a 30 giorni, riuso del cookie dopo il logout, invalidazione dopo il cambio password
- [x] 5.3 Implementare limite ai tentativi su KV (login e token errato) e controllo `Origin`; verificare con test il sesto tentativo rifiutato anche se arriva a un'altra istanza simulata
- [x] 5.4 Implementare la CLI `user:create|user:passwd|user:list|user:delete` sul KV e verificare con test (KV in memoria) i casi di successo e di password non conforme

## 6. Gateway: YouTube (`cloud-gateway`)

- [x] 6.1 Implementare l'adattatore `youtubei.js` (ricerca, metadati, scelta del formato M4A, decifrazione) dietro un'interfaccia con implementazione finta, con la mappatura degli errori (`YOUTUBE_BLOCKED`, `VIDEO_UNAVAILABLE`, `VIDEO_TOO_LONG`, timeout); verificare con unit test sull'implementazione finta e su risposte registrate di YouTube
- [x] 6.2 Implementare `api/search.ts` e `api/meta/[id].ts` (autenticate, validazione query e id, metadati ripuliti, durata massima 20 minuti) e verificare con test di integrazione risultati, 400, 401, 422 e 503 con codice di blocco
- [x] 6.3 Implementare `api/audio/[id].ts` in streaming con inoltro di Range, lettura a blocchi da 8 MB e cache in memoria degli URL per 4 ore; verificare con test su un server googlevideo finto la risposta completa da 10 MB, la 206 con `Content-Range`, la 401 senza sessione e l'assenza di file scritti su disco
- [x] 6.4 Implementare `api/cover/[id].ts` e verificare con test tipo di contenuto, cache privata e 401 senza sessione

## 7. PWA: due modalità (`deployment-modes`)

- [x] 7.1 Estrarre l'interfaccia `Backend` da `src/lib/api.ts` lasciando `RemoteBackend` invariato, e verificare che tutti i test esistenti del web passino senza modifiche di comportamento
- [x] 7.2 Rilevare la modalità dalla health check all'avvio, salvarla per l'avvio offline e creare i servizi con il backend corrispondente; verificare con test l'avvio online nelle due modalità e quello offline in modalità client
- [x] 7.3 Adattare l'interfaccia alla modalità (azioni d'importazione da file, backup, ponte e spazio in modalità client; niente download toggle né eliminazione "per tutti gli account") e verificare con test di componente le due varianti della Libreria e del menu del brano

## 8. PWA: libreria sul dispositivo (`device-library`)

- [x] 8.1 Aggiungere la migrazione IndexedDB v2 con gli store `lib*`, `imports` e `settings`, e verificare con test la migrazione da un database v1 con dati esistenti
- [x] 8.2 Implementare `DeviceBackend` per catalogo (paginazione, ordinamenti), ricerca locale per prefisso senza accenti, modifica ed eliminazione dei brani; verificare con unit test gli stessi casi dei test del catalogo del server (120 brani, "nirv" → "Nirvana", "bjork" → "Björk", eliminazione con liberazione del file)
- [x] 8.3 Implementare preferiti, playlist (posizioni frazionarie, duplicati, nome 1–100) e ascolti locali con "ascoltati di recente"; verificare con unit test i casi delle spec, inclusi il riordino offline e A, B, A → A, B
- [x] 8.4 Aggiungere al Service Worker la rotta `CacheOnly` per `/local/audio/*` e `/local/cover/*` con risposte 206 e 404 se mancante, e verificare con test end-to-end su Chromium e WebKit una richiesta `Range: bytes=0-1` offline
- [x] 8.5 Mostrare spazio occupato, disponibile e numero di brani, e bloccare un'importazione senza spazio sufficiente; verificare con test di componente e unit test sulla stima

## 9. PWA: importazione sul dispositivo (`device-ingestion`)

- [x] 9.1 Implementare il gestore d'importazione con coda persistente, concorrenza 2, ripresa al ritorno in primo piano, WakeLock ed eventi `JobDto`; verificare con unit test coda, ripresa senza duplicati e annullamento
- [x] 9.2 Implementare l'importazione da YouTube tramite gateway (metadati, copertina elaborata su canvas con colore dominante, audio in streaming con avanzamento, verifica dimensione, deduplicazione per `youtube:<id>`); verificare con unit test su gateway finto il caso riuscito, l'interruzione senza file parziali e il video già presente
- [x] 9.3 Permettere la riproduzione durante l'importazione con sostituzione del brano provvisorio a importazione completata; verificare con unit test del player che la riproduzione non si interrompa e che il brano successivo usi la copia locale
- [x] 9.4 Mostrare gli errori specifici (blocco anti-bot con proposta di file e ponte, non disponibile, troppo lungo) e il "Riprova"; verificare con test di componente della vista Cerca
- [x] 9.5 Implementare l'importazione da file (selezione multipla, tag ID3 e MP4 con `music-metadata` caricato su richiesta, titolo dal nome file, copertina predefinita, rifiuto dei formati non riproducibili, deduplicazione per hash); verificare con unit test su fixture MP3 con tag, M4A senza tag e un FLAC
- [x] 9.6 Implementare il ponte on-premise (impostazioni con verifica della connessione, ricerca, importazione con polling dei job, copia di audio, copertine e metadati); verificare con test di integrazione contro il server on-premise reale avviato nei test con yt-dlp finto e origine autorizzata

## 10. PWA: perdita dei dati e backup (`device-library`, `library-backup`)

- [x] 10.1 Rilevare all'avvio e su `visibilitychange` i brani il cui file è stato eliminato dal sistema, marcarli come persi con "Riscarica" e proporre il ripristino da backup; verificare con test eliminando la cache
- [x] 10.2 Mostrare l'avviso specifico quando lo storage non è persistente in modalità client, e verificare con test di componente
- [x] 10.3 Implementare l'esportazione ZIP con `fflate` (metadati e copertine, parti audio da 300 MB generate in sequenza, stima di dimensione e parti, Web Share API con fallback al download); verificare con unit test contenuto del manifest, numero di parti e hash
- [x] 10.4 Implementare l'importazione di un backup (validazione, unione senza duplicati, brani "da riscaricare" senza audio, ascolti non duplicati, nessuna modifica su file danneggiato); verificare con unit test ripristino completo, backup leggero, doppia importazione e file troncato
- [x] 10.5 Registrare la data dell'ultimo backup e mostrare il promemoria dopo 20 brani o 30 giorni; verificare con test di componente

## 11. Deploy e documentazione

- [ ] 11.1 Aggiungere al README la sezione "Modalità client su Vercel" (creazione del progetto con Root Directory `apps/gateway`, integrazione Upstash, variabili d'ambiente, primo account, limiti del piano Hobby, rischio di blocco di YouTube e alternative) e verificare seguendola su un progetto Vercel reale
- [x] 11.2 Aggiornare `docs/verification-ios.md` e `docs/verification-android.md` con le verifiche della modalità client (importazione da YouTube e da file, ponte, modalità aereo, backup e ripristino, eliminazione dello storage)

## 12. Verifiche di integrazione

- [x] 12.1 Aggiungere un progetto Playwright "client" che usa il dev server del gateway (KV in memoria, YouTube finto) e verificare su Chromium e WebKit il percorso registrazione → ricerca → importazione con ascolto immediato → modalità aereo con libreria e seek → esportazione e reimportazione del backup
- [ ] 12.2 Eseguire la checklist manuale della modalità client su iPhone e Android con il gateway pubblicato su Vercel e registrarne l'esito
- [x] 12.3 Eseguire `openspec validate add-client-mode --strict` e verificare che non ci siano errori

## Workflow follow-up

- Archiviare `add-spookyfy-mvp` prima di questa change: il delta di `user-auth` richiede che la sua spec principale esista.
- Archiviare questa change dopo la revisione con `/opsx:archive`.
