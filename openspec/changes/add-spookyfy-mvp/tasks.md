# Tasks

## 1. Scaffolding del monorepo

- [x] 1.1 Creare il workspace pnpm (`pnpm-workspace.yaml`, `package.json` root con script `dev`/`build`/`test`/`lint`, `.nvmrc` con Node 22, `.gitignore`, `.editorconfig`) e verificare che `pnpm install` termini senza errori
- [x] 1.2 Creare `packages/shared` (TypeScript strict, Zod, export di tipi e schemi) e verificare che `pnpm --filter shared build` produca le dichiarazioni `.d.ts`
- [x] 1.3 Creare `apps/server` (Fastify + TypeScript, `tsx` in sviluppo) con rotta `GET /api/health` e verificare che `pnpm --filter server dev` risponda `200` su `/api/health`
- [x] 1.4 Creare `apps/web` (Vite + Svelte 5 + TypeScript) con proxy di sviluppo `/api` → server (incluso WebSocket) e verificare che `pnpm --filter web dev` mostri la pagina iniziale
- [x] 1.5 Configurare Biome, Vitest (server e web) e `tsconfig` base condiviso, e verificare che `pnpm lint` e `pnpm test` passino sul codice di esempio
- [x] 1.6 Aggiungere un workflow CI (GitHub Actions: install, lint, typecheck, test, build) e verificare che giri verde su un push di prova

## 2. Fondamenta del server

- [x] 2.1 Implementare il caricamento della configurazione da variabili d'ambiente con schema Zod (`PORT`, `DATA_DIR`, `MEDIA_DIR`, `PUBLIC_ORIGIN`, `YTDLP_PATH`, `FFMPEG_PATH`, `INGEST_CONCURRENCY`, `INGEST_NICE`, `TRUST_CF_HEADERS`, `REGISTRATION_TOKEN`) e verificare con unit test che una configurazione non valida blocchi l'avvio con un messaggio chiaro
- [x] 2.2 Implementare il rilevamento del profilo hardware (core via `os.availableParallelism()`, RAM) con default di concorrenza `clamp(floor(core / 2), 1, 8)` e log del profilo al boot; verificare con unit test i valori per 4 core (→ 2), 1 core (→ 1) e 32 core (→ 8) e la precedenza di `INGEST_CONCURRENCY`
- [x] 2.3 Configurare better-sqlite3 (WAL, foreign keys) e Drizzle con le tabelle di D3 e la tabella FTS5 `tracks_fts` con trigger di sincronizzazione; verificare con un test che le migrazioni si applichino su un DB vuoto all'avvio e siano idempotenti
- [x] 2.4 Implementare la gestione errori uniforme (formato `{ error: { code, message } }`) e il logging strutturato (pino) senza dati sensibili; verificare con test che un errore di validazione restituisca 400 nel formato atteso
- [x] 2.5 Servire il build di `apps/web/dist` con fallback SPA a `index.html` per le rotte non `/api`, e verificare con test che `/playlist/abc` restituisca l'app shell mentre `/api/unknown` restituisca 404 JSON
- [x] 2.6 Creare l'helper di test che avvia il server su DB e cartelle temporanee (fixture riusabile per i gruppi successivi) e verificare che sia usato da almeno un test

## 3. Autenticazione (`user-auth`)

- [x] 3.1 Definire in `packages/shared` gli schemi Zod di password (8–128 caratteri, almeno una lettera, una cifra e un carattere speciale) e username (`^[A-Za-z0-9._-]{3,32}$`) con l'elenco dei requisiti non soddisfatti; verificare con unit test `Notte#2026` (valida), `ab#1`, `notte2026`, `notte#notte`, `fe` e `fede!` (non valide, con il requisito mancante corretto)
- [x] 3.2 Implementare hashing Argon2id e il servizio utenti (crea, cambia password, elenca, elimina con cascata sui dati personali) che applica gli schemi del task 3.1 e il vincolo `UNIQUE` su `username_normalized`; verificare con unit test ogni operazione e che `Fede` venga rifiutato se esiste `fede`
- [x] 3.3 Implementare la CLI `user:create|user:passwd|user:list|user:delete` con password da prompt nascosto o stdin, e verificare con test che `user:create` con la password `luna` fallisca elencando i requisiti mancanti senza creare l'account
- [x] 3.4 Implementare `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` con cookie `spk_session` (HttpOnly, Secure, SameSite=Lax, 30 giorni), token salvato come SHA-256, username case-insensitive e messaggio d'errore unico; verificare con test di integrazione login riuscito, credenziali errate e riuso del cookie dopo il logout
- [x] 3.5 Implementare `POST /api/auth/register` con `REGISTRATION_TOKEN` (default `spotifymerdacostosa2026`, vuoto = disabilitata, warning nel log se resta il default), confronto in tempo costante, ordine dei controlli formato → token → unicità, sessione avviata a registrazione riuscita e mappatura della violazione `UNIQUE` su `USERNAME_TAKEN`; verificare con test di integrazione registrazione riuscita, token errato, token personalizzato, registrazione disabilitata, username esistente con token errato (solo errore di token) e due registrazioni concorrenti con lo stesso username (un solo account creato)
- [x] 3.6 Implementare la validazione della sessione come hook globale (esclusi app shell, login e registrazione), rinnovo sliding con scrittura al massimo oraria e scadenza a 30 giorni; verificare con test usando un clock simulato i casi "rinnovata dall'uso" e "scaduta"
- [x] 3.7 Implementare i rate limit in memoria: login (5 tentativi/15 minuti per IP da `CF-Connecting-IP` + username) e registrazione con token errato (5/15 minuti per IP); verificare con test che il sesto tentativo venga rifiutato con 429 anche con credenziali o token corretti e che la finestra si liberi dopo 15 minuti
- [x] 3.8 Implementare il controllo `Origin` per i metodi non sicuri (registrazione inclusa) e verificare con test che una richiesta con Origin estraneo venga rifiutata con 403 e una con `PUBLIC_ORIGIN` accettata
- [x] 3.9 Documentare in `docs/auth.md` registrazione con token (come cambiarlo o disabilitarlo), requisiti di password e username, gestione account da CLI e politica di sessione, e verificare che i comandi documentati funzionino come scritti

## 4. Libreria (`music-library`)

- [x] 4.1 Definire in `packages/shared` gli schemi DTO di brano, playlist, preferito e ascolto, e verificare che server e web compilino importandoli
- [x] 4.2 Implementare `GET /api/tracks` (paginazione a cursore, ordinamento per data di aggiunta/titolo/artista) e `GET /api/tracks/:id`; verificare con test il caso di 120 brani e pagine da 50
- [x] 4.3 Implementare `GET /api/tracks?q=` con FTS5 (prefisso, case-insensitive, senza diacritici) e verificare con test che "nirv" trovi "Nirvana" e che una query senza corrispondenze restituisca un elenco vuoto
- [x] 4.4 Implementare `PATCH /api/tracks/:id` (titolo/artista/album con riscrittura dei tag ID3) e `DELETE /api/tracks/:id` (rimozione file e riferimenti); verificare con test che i tag ID3 del file riflettano la modifica e che dopo l'eliminazione i file non esistano più
- [x] 4.5 Implementare preferiti (`GET/PUT/DELETE /api/me/favorites/:trackId`) personali per utente e verificare con test che i preferiti di un utente non compaiano a un altro
- [x] 4.6 Implementare le playlist (CRUD, aggiunta/rimozione elementi, riordino con posizione frazionaria, nome 1–100 caratteri, 404 per playlist altrui) e verificare con test creazione, riordino, duplicati ammessi e accesso negato
- [x] 4.7 Implementare `POST /api/me/plays` in blocco con id generati dal client (`INSERT OR IGNORE`, orario originale) e statistiche per brano (conteggio, ultimo ascolto); verificare con test che un reinvio non duplichi gli ascolti
- [x] 4.8 Implementare `GET /api/me/recent-plays` (deduplicati) e `GET /api/tracks?sort=added` per la Home, e verificare con test la sequenza A, B, A → A, B

## 5. Streaming (`audio-streaming`)

- [x] 5.1 Implementare `GET /api/tracks/:id/audio` con Range (206, 416, 200 completo, ETag) e `Cache-Control: private, max-age=31536000, immutable`; verificare con test di integrazione byte 0-1, seek a metà, richiesta senza Range, intervallo oltre la fine e brano inesistente
- [x] 5.2 Implementare `GET /api/tracks/:id/cover?size=512|128` con gli stessi header e verificare con test le dimensioni delle immagini restituite
- [x] 5.3 Verificare con test che audio e copertine rispondano 401 senza sessione

## 6. Ingestione (`media-ingestion`)

- [x] 6.1 Implementare un wrapper per yt-dlp basato su `spawn` senza shell, con timeout, parsing del JSON e dell'avanzamento; verificare con unit test usando un eseguibile finto che simula output, errori e timeout
- [x] 6.2 Implementare `GET /api/search/remote?q=` (validazione 1–200 caratteri, 10 risultati, flag "già in libreria", cache 10 minuti, errore 503 su sorgente non disponibile) e verificare con test usando lo yt-dlp finto
- [x] 6.3 Implementare la pulizia dei metadati (titolo/artista da `track`/`artist` o da `title`/`uploader` senza suffissi come "(Official Video)" e "- Topic") con unit test su una tabella di casi reali
- [x] 6.4 Implementare l'elaborazione delle copertine con sharp (ritagli 512/128, colore dominante esadecimale) e la scrittura dei tag ID3; verificare con test su un'immagine e un MP3 di fixture
- [x] 6.5 Implementare `POST /api/ingest` (validazione `source_id`, deduplicazione su brano esistente e su job attivo) e `GET /api/jobs`, `POST /api/jobs/:id/retry`; verificare con test i casi nuova importazione, brano esistente, richieste concorrenti e id non valido
- [x] 6.6 Implementare il worker con concorrenza configurabile, directory temporanea per job, spostamento atomico e transazione finale, filtro durata massima 20 minuti, pulizia in caso di errore; verificare con test (yt-dlp finto) completamento, video non disponibile, video troppo lungo e limite di 2 job contemporanei
- [x] 6.7 Implementare la ripresa all'avvio (job `running` → `queued`, svuotamento `tmp`) e verificare con test che un job interrotto venga completato senza duplicare il brano
- [x] 6.8 Implementare `/api/ws` con autenticazione su upgrade, verifica Origin, eventi tipizzati da `packages/shared`, throttling dell'avanzamento a 1/s e ping ogni 30 s; verificare con test che un client senza sessione venga rifiutato e che arrivino gli eventi `queued → progress → completed`
- [x] 6.9 Eseguire un'importazione reale con yt-dlp e ffmpeg installati (test manuale o test d'integrazione opzionale con variabile d'ambiente) e verificare che l'MP3 risultante abbia titolo, artista e copertina leggibili da un lettore di tag

## 7. App shell e design system (`app-shell`)

- [x] 7.1 Definire i token di design (colori, spaziature, raggi, tipografia, z-index) come CSS custom properties, gli stili base e il font self-hosted con `font-display: swap`; verificare con un test che il contrasto del testo principale su `#121212` sia almeno 4.5:1
- [x] 7.2 Implementare il router History API con le rotte di D8, ripristino dello scroll per entry e redirect a `/login` preservando la destinazione, rotta `/register`; verificare con unit test navigazione, Indietro e apertura diretta di un URL
- [x] 7.3 Implementare il layout radice (`App.svelte` con contenitore viste, slot player, `TabBar`) con tab bar sfocata, voce attiva in accento e safe area; verificare visivamente in emulazione iPhone che la barra non si sovrapponga all'indicatore Home
- [x] 7.4 Implementare il client API tipizzato (fetch con gestione 401 → login, errori uniformi) e lo store di sessione, la schermata di login e quella di registrazione (username, password, conferma, token di invito, checklist dei requisiti in tempo reale con gli schemi di `packages/shared`, errori sotto il campo interessato); verificare con test di componente login riuscito, errore credenziali, redirect alla destinazione iniziale, pulsante disabilitato con conferma diversa, checklist per `notte2026` ed errore "username non disponibile" che mantiene i valori inseriti
- [x] 7.5 Configurare `vite-plugin-pwa` (injectManifest) con manifest (nome, icone incluse maskable e Apple touch, `display: standalone`, colori `#121212`), meta tag iOS e `viewport-fit=cover`; verificare con Lighthouse che l'app risulti installabile
- [x] 7.6 Implementare nel Service Worker il precache dell'app shell, il navigation fallback escluso `/api/*` e il flusso di aggiornamento con prompt che non interrompe la riproduzione; verificare che l'app si avvii offline dopo il primo caricamento e che una nuova build mostri l'avviso "Aggiorna"
- [x] 7.7 Implementare i componenti base riusabili con dimensioni riservate (riga brano, card, copertina con `aspect-ratio` e colore dominante come segnaposto, skeleton) e verificare con Lighthouse/Performance panel un CLS pari a 0 sulle viste principali
- [x] 7.8 Implementare lo store di connessione e il banner "Sei offline", con disabilitazione delle azioni che richiedono il server; verificare con test di componente che in stato offline la ricerca remota risulti non disponibile

## 8. Viste della libreria

- [x] 8.1 Implementare la vista Home (ascoltati di recente, aggiunti di recente, playlist) e verificare con test di componente il rendering con dati di esempio e con liste vuote
- [x] 8.2 Implementare la vista Cerca con ricerca locale immediata (debounce) e sezione risultati YouTube con azione "Aggiungi" e stato del job (in coda, percentuale, completato, errore con "Riprova"); verificare con test di componente i diversi stati del job ricevuti via WebSocket
- [x] 8.3 Implementare il client WebSocket con riconnessione a backoff (1 s → 30 s) e ricarica di `/api/jobs` alla riconnessione; verificare con unit test su un server WebSocket finto
- [x] 8.4 Implementare la vista La tua Libreria (Preferiti, playlist, tutti i brani, filtro Scaricati) e la vista playlist con riordino a trascinamento, rinomina, eliminazione e rimozione brani; verificare con test di componente riordino e rinomina
- [x] 8.5 Implementare il menu contestuale del brano (aggiungi a playlist, preferito, riproduci dopo, modifica metadati, elimina con conferma) e verificare con test di componente ogni azione
- [x] 8.6 Implementare la vista Impostazioni (account, logout, stato storage persistente e stima dello spazio) e verificare con test di componente il logout e la visualizzazione di "Storage protetto"

## 9. Player (`audio-player`)

- [x] 9.1 Implementare il motore audio con un unico `<audio>` montato nel layout radice, cambio di `src` sullo stesso elemento e primo `play()` solo da gesto utente; verificare con test che il ripristino all'avvio non chiami `play()`
- [x] 9.2 Implementare la coda (contesto di avvio, riproduci dopo, shuffle con ordine originale conservato, repeat a tre stati, regola "Precedente" dei 3 secondi, fine coda) come modulo puro e verificare con unit test tutti gli scenari della spec
- [x] 9.3 Implementare persistenza e ripristino di coda, brano e posizione (`localStorage`, throttle e `pagehide`) e verificare con test che dopo un ricaricamento il mini-player mostri l'ultimo brano in pausa alla posizione salvata
- [x] 9.4 Implementare l'integrazione MediaSession (metadati con artwork 128/512, handler play/pause/precedente/successivo/seekto, `setPositionState`) e verificare con unit test che i metadati e la posizione vengano aggiornati al cambio brano e dopo un seek
- [x] 9.5 Implementare il mini-player (miniatura, marquee solo in overflow, play/pausa, progress sottile) sopra la tab bar e verificare con test di componente che il titolo scorra solo quando non entra
- [x] 9.6 Implementare il player a schermo intero (copertina con ombra, gradiente dal colore dominante a `#121212`, controlli completi, preferito, toggle download) con apertura/chiusura tramite tap, swipe e Indietro e rispetto di `prefers-reduced-motion`; verificare con test e2e apertura con swipe e chiusura con Indietro
- [x] 9.7 Implementare la scrub bar con area di tocco ≥ 44 px, anteprima del tempo durante il trascinamento e seek al rilascio; verificare con test di componente che il seek avvenga solo al rilascio
- [x] 9.8 Implementare il conteggio del tempo effettivamente ascoltato, l'invio dell'ascolto alla soglia (30 s o metà durata) una volta per riproduzione e la coda `pendingPlays` offline con flush al ritorno online; verificare con unit test soglia, seek che non falsano il conteggio e invio differito
- [x] 9.9 Implementare il salto dei brani non riproducibili offline con avviso e verificare con test che, offline, la coda passi al successivo brano scaricato

## 10. Storage offline (`offline-storage`)

- [x] 10.1 Implementare il database IndexedDB (`tracks`, `downloads`, `playlists`, `favorites`, `pendingPlays`, `downloadQueue`) con versionamento e verificare con unit test (fake-indexeddb) apertura e migrazione
- [x] 10.2 Implementare nel Service Worker la rotta audio con `CacheOnly` + `RangeRequestsPlugin` sulla cache `spk-audio-v1` e passthrough di rete in assenza, più la rotta copertine `StaleWhileRevalidate`; verificare con test e2e Playwright su WebKit e Chromium che un brano in cache risponda 206 a `Range: bytes=0-1` e sia riproducibile con seek offline
- [x] 10.3 Implementare il download di un singolo brano (fetch completo con avanzamento, verifica dimensione, `cache.put` solo a completamento, copertina 512 inclusa, rimozione) e il toggle nuvola/spunta con avanzamento; verificare con test che un download interrotto non lasci copie parziali
- [x] 10.4 Implementare la sincronizzazione offline dei metadati (snapshot di brani, playlist e preferiti in IndexedDB) e la navigazione offline con brani non scaricati attenuati; verificare con test e2e in modalità offline la navigazione di una playlist parzialmente scaricata
- [x] 10.5 Implementare la richiesta `navigator.storage.persist()` dopo il login e la stima dello spazio; verificare con test che l'esito venga mostrato nelle impostazioni nei due casi concesso/negato
- [x] 10.6 Implementare la riconciliazione cache/indice all'avvio e su `visibilitychange` e verificare con test che, eliminando manualmente la cache, i brani risultino "non scaricati" e vengano riprodotti in streaming
- [x] 10.7 Implementare il download di playlist/preferiti con coda persistita, un brano alla volta, salto dei già scaricati, avanzamento complessivo, annullamento e ripresa al ritorno in primo piano; verificare con test i casi "20 brani di cui 5 già scaricati", annullamento e ripresa
- [x] 10.8 Implementare WakeLock durante la coda di download (acquisizione, riacquisizione su `visibilitychange`, rilascio a fine/annullamento), l'overlay nero "schermo scuro" e l'avviso se non supportato; verificare con unit test su `navigator.wakeLock` simulato acquisizione e rilascio
- [x] 10.9 Implementare il salvataggio offline automatico dei brani importati da questo dispositivo alla ricezione di `job.completed`, con streaming immediato disponibile; verificare con test che il brano risulti scaricato al termine senza interrompere la riproduzione in corso

## 11. Deploy e documentazione

- [x] 11.1 Aggiungere `deploy/spookyfy.service`, `deploy/yt-dlp-update.service` + `.timer`, `deploy/cloudflared/config.yml` d'esempio e `.env.example` (con `REGISTRATION_TOKEN` e il consiglio di cambiarlo); verificare con `systemd-analyze verify` e `cloudflared tunnel ingress validate`
- [x] 11.2 Scrivere `README.md` (requisiti, installazione su Raspberry Pi, mini-PC o server, configurazione, token di registrazione (cambiarlo, disabilitarlo) e primo utente, tunnel Cloudflare con Cache Rule di bypass su `/api/*`, dimensionamento con valori suggeriti per Raspberry Pi/mini-PC e per server più potenti, installazione della PWA su iOS/Android, backup con `VACUUM INTO`, nota sull'uso personale di yt-dlp) e verificare seguendo la procedura su una macchina pulita arm64 e su una x64

## 12. Verifiche di integrazione

- [x] 12.1 Scrivere un test e2e Playwright del percorso completo (registrazione con token → logout → login → ricerca remota con yt-dlp finto → importazione → riproduzione in streaming → download → riproduzione offline) e verificare che passi su WebKit e Chromium in CI
- [ ] 12.2 Eseguire la checklist manuale su iPhone reale (PWA installata via tunnel): installazione standalone, primo play da tap, lockscreen con copertina e controlli, avanzamento al brano successivo a schermo bloccato, cambio vista senza interruzioni, download di playlist con schermo acceso, modalità aereo, fallback dopo eliminazione della cache; registrare l'esito in `docs/verification-ios.md`
- [ ] 12.3 Eseguire la stessa checklist su Android (Chrome) e registrare l'esito in `docs/verification-android.md`
- [x] 12.4 Eseguire `openspec validate add-spookyfy-mvp --strict` e verificare che non ci siano errori

## Workflow follow-up

- Archiviare la change dopo la revisione (`/opsx:archive`), così le spec diventano le spec principali del progetto.
- Proporre le change successive: Smart Storage Manager (grafico a ciambella), regole di eviction personalizzate, tag e code generate dai tag.
