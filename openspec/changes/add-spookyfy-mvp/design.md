# Design

## Context

Repository vuoto (solo scaffolding OpenSpec): nessun vincolo di codice esistente. Motivazioni e perimetro in `proposal.md`; i comportamenti richiesti sono nelle spec della change (`user-auth`, `media-ingestion`, `audio-streaming`, `music-library`, `app-shell`, `audio-player`, `offline-storage`).

Vincoli che guidano il design:

- **Hardware**: qualunque macchina Linux arm64 o x64, dal Raspberry Pi 4/5 o mini-PC (profilo minimo supportato, che il design deve continuare a servire bene) fino a server più potenti. Le scelte di base (un processo Node, SQLite, nessun servizio esterno obbligatorio) funzionano bene su entrambi i profili; ciò che dipende dalle risorse (concorrenza dei job, priorità dei processi figli, cache) si adatta automaticamente all'hardware ed è configurabile.
- **Rete**: esposizione solo tramite Cloudflare Tunnel (`cloudflared`); TLS terminato da Cloudflare; IP del client nell'header `CF-Connecting-IP`. Cloudflare supporta WebSocket e richieste Range attraverso il tunnel.
- **Client prioritario**: Safari iOS in PWA standalone (WebKit), poi Chrome Android. WebKit impone: audio sbloccato solo da gesto utente, nessun Background Sync / Background Fetch, eviction possibile dello storage, `<audio>` che usa richieste Range anche per risorse servite dal Service Worker.
- **Uso**: pochi utenti (famiglia), libreria fino a qualche migliaio di brani.

## Goals / Non-Goals

**Goals:**

- Un solo deploy (un processo, una origine) facile da mantenere, identico su Raspberry Pi e su server più potenti.
- Uso delle risorse proporzionato all'hardware: leggero sul profilo minimo, più parallelo dove ci sono core e RAM in più.
- Comportamento "nativo" su iOS: lockscreen, background, nessuna interruzione cambiando vista.
- Offline-first per i brani scaricati, con degrado silenzioso allo streaming.
- Codice condiviso per tipi e schemi fra server e client, per evitare drift dell'API.

**Non-Goals:**

- Scalabilità orizzontale, più istanze del server, storage oggetti remoto.
- Transcodifica adattiva o più bitrate: un solo MP3 per brano.
- Sincronizzazione in background a app chiusa (non possibile su iOS).
- Smart Storage Manager con grafico, regole di eviction automatiche, tag: change successive. Questa change però registra già storico ascolti e stato dei download, che quelle feature useranno.

## Decisions

### D1. Monorepo pnpm con tre pacchetti

```
apps/server     Fastify + TypeScript, job di ingestione, CLI utenti
apps/web        Svelte 5 + Vite, PWA
packages/shared schemi Zod + tipi DTO + nomi eventi WebSocket
```

Tooling: pnpm workspaces, TypeScript strict, Vitest in entrambi i progetti, Biome per lint e formattazione, Playwright per pochi test end-to-end (WebKit e Chromium). Node 22 LTS.

*Alternative*: repo separati (più attrito per tipi condivisi); Nx/Turborepo (sovradimensionati per due app).

### D2. Backend: Fastify + better-sqlite3 + Drizzle

- **Fastify** invece di Express: validazione JSON schema nativa, plugin ufficiali per cookie, rate limit, static, WebSocket, e overhead basso (conta sul profilo minimo, non penalizza i server grandi).
- **SQLite** in modalità WAL via `better-sqlite3` (sincrono, veloce, nessun processo separato). Anche su un server potente resta adeguato al carico previsto (pochi utenti, scritture rare, migliaia di brani); l'accesso ai dati passa per Drizzle così che un futuro passaggio a PostgreSQL resti possibile senza riscrivere i servizi. **Drizzle ORM** per schema tipizzato e migrazioni SQL versionate, eseguite automaticamente all'avvio.
- **FTS5** per la ricerca locale (tabella virtuale `tracks_fts` su titolo/artista/album, tokenizer `unicode61 remove_diacritics 2`, query per prefisso `term*`).
- Il server serve anche il build statico della PWA con fallback SPA (`index.html` per ogni rotta non `/api`), così app e API condividono l'origine: niente CORS, cookie `SameSite=Lax` sufficiente, `<audio>` autenticato senza header custom.

*Alternative*: PostgreSQL (servizio in più da gestire, pesante sul profilo minimo e senza benefici per il carico previsto); Go (scartato in favore di un unico linguaggio, come concordato).

### D3. Modello dati (sintesi)

| Tabella | Contenuto chiave |
|---|---|
| `users` | id, username (come digitato), username_normalized (minuscolo, `UNIQUE`), password_hash, created_at |
| `sessions` | id, user_id, token_hash (SHA-256), created_at, last_used_at, expires_at |
| `tracks` | id (ULID), source (`youtube`), source_id (unico), title, artist, album, duration_ms, size_bytes, dominant_color, audio_path, cover_path, added_by, added_at |
| `ingest_jobs` | id, source_id, status (`queued`/`running`/`completed`/`failed`), progress, error, track_id, requested_by, created_at, updated_at |
| `favorites` | user_id, track_id, created_at |
| `playlists` | id, owner_id, name, created_at, updated_at |
| `playlist_items` | id, playlist_id, track_id, position (frazionaria, `REAL`), added_at |
| `plays` | id (generato dal client, UUID), user_id, track_id, played_at |

- `plays.id` generato dal client rende idempotente l'invio offline (`INSERT OR IGNORE`).
- `playlist_items.position` frazionaria: riordino con un solo `UPDATE` (media fra i vicini), rinumerazione rara quando la precisione si esaurisce.
- File media in `MEDIA_DIR/audio/<trackId>.mp3` e `MEDIA_DIR/covers/<trackId>-{512,128}.jpg`.

### D4. Autenticazione

- Password con **Argon2id** (`@node-rs/argon2`, binari prebuilt per arm64 e x64, nessuna compilazione).
- **Politica password e username in `packages/shared`**: un unico schema Zod usato dal server (registrazione, CLI, cambio password) e dal client (checklist dei requisiti in tempo reale). Password: 8–128 caratteri (il massimo evita hash costosi su input enormi), almeno una lettera (`\p{L}`), una cifra (`\p{N}`) e un carattere non alfanumerico. Username: `^[A-Za-z0-9._-]{3,32}$`.
- **Registrazione con token di invito** (`POST /api/auth/register`): il token arriva da `REGISTRATION_TOKEN` (default `spotifymerdacostosa2026`; stringa vuota = registrazione disabilitata). Ordine dei controlli: rate limit → validazione formato → token → unicità → creazione + sessione. Il token viene confrontato in tempo costante (`crypto.timingSafeEqual` sugli SHA-256 dei due valori, così anche lunghezze diverse non rivelano nulla). Controllando il token prima dell'unicità, solo chi ha il token può scoprire se uno username esiste.
- **Unicità**: il vincolo `UNIQUE` su `username_normalized` è la garanzia vera (gestisce le registrazioni concorrenti); il controllo preventivo serve solo a dare un messaggio chiaro, e la violazione del vincolo viene tradotta nello stesso errore `USERNAME_TAKEN`.
- Token di sessione casuale da 32 byte nel cookie `spk_session` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d`); nel DB solo lo SHA-256. Rinnovo "sliding": `last_used_at`/`expires_at` aggiornati al massimo una volta ogni ora per evitare scritture ad ogni richiesta.
- Messaggio d'errore unico per utente inesistente / password errata; hash fittizio verificato anche per utenti inesistenti per uniformare i tempi.
- Rate limit in memoria: login per chiave `(CF-Connecting-IP, username)` e registrazione con token errato per chiave `CF-Connecting-IP`, entrambi 5 tentativi / 15 minuti. In memoria è accettabile: un solo processo, e un riavvio che azzera i contatori non è un rischio rilevante.
- CSRF: oltre a `SameSite=Lax`, hook globale che per metodi non sicuri (POST/PUT/PATCH/DELETE) confronta `Origin` con `PUBLIC_ORIGIN` configurato.
- WebSocket: autenticato in fase di upgrade leggendo lo stesso cookie, con verifica dell'`Origin`.
- CLI: `pnpm --filter server cli user:create|user:passwd|user:list|user:delete`, password letta da prompt nascosto o stdin (mai come argomento, per non finire nella shell history). Stessa politica di password e username della registrazione, senza token.

*Alternative*: JWT stateless (revoca e logout più complicati, nessun vantaggio con un solo server); Cloudflare Access (scartato su richiesta: login in-app); inviti monouso generati dall'amministratore (più sicuri, ma si è scelto un token fisso configurabile, più semplice da condividere in famiglia).

### D5. Ingestione con yt-dlp

- **Ricerca**: `yt-dlp --flat-playlist -J "ytsearch10:<query>"` con timeout 15 s; la query viene passata come argomento di `execFile`/`spawn` senza shell (niente injection). Risultati arricchiti con il flag "già in libreria" tramite lookup su `tracks.source_id`. Cache in memoria dei risultati per 10 minuti per query identiche.
- **Validazione**: `source_id` deve rispettare `^[A-Za-z0-9_-]{11}$`; l'URL viene costruito dal server (`https://www.youtube.com/watch?v=<id>`), mai accettato dal client.
- **Download**: `yt-dlp -f bestaudio -x --audio-format mp3 --audio-quality 0 --write-thumbnail --convert-thumbnails jpg --match-filter "duration <= 1200" --no-playlist --newline --progress-template ...` in una directory temporanea per job (`MEDIA_DIR/tmp/<jobId>`). L'avanzamento viene letto da stdout e inoltrato con throttling a 1 evento/s.
- **Metadati**: titolo/artista ricavati dal JSON di yt-dlp (`track`/`artist` se presenti, altrimenti `title`/`uploader` ripuliti da suffissi comuni come "(Official Video)", "- Topic"). L'utente può correggerli dopo (spec `music-library`).
- **Copertina e colore**: `sharp` genera ritagli quadrati 512 e 128 px e calcola il colore dominante (`stats().dominant`), salvato come esadecimale nel brano: il client ottiene il colore insieme ai metadati, senza calcoli su canvas e senza layout shift.
- **Tag ID3**: `node-id3` scrive titolo, artista, album e copertina (APIC) dopo la conversione; le modifiche successive ai metadati riscrivono i tag.
- **Atomicità**: tutto avviene nella directory temporanea; solo alla fine i file vengono spostati con `rename` nella posizione definitiva e il brano viene inserito nella stessa transazione che marca il job `completed`. In caso di errore la directory temporanea viene eliminata.
- **Coda**: tabella `ingest_jobs` come fonte di verità + worker in-process con concorrenza `INGEST_CONCURRENCY`. Se non impostata, il default è calcolato dall'hardware: `clamp(floor(os.availableParallelism() / 2), 1, 8)`, quindi 2 su un Raspberry Pi a 4 core e fino a 8 su un server grande. All'avvio i job `running` tornano `queued` e la cartella `tmp` viene svuotata.
- **Priorità dei processi figli**: yt-dlp/ffmpeg partono con `nice` configurabile (`INGEST_NICE`, default 10), così su macchine piccole lo streaming resta fluido durante le conversioni; su server grandi si può portare a 0.
- **Aggiornamento di yt-dlp**: yt-dlp si rompe spesso quando YouTube cambia; il binario viene installato fuori da npm (pip/standalone) e documentato un timer systemd settimanale `yt-dlp -U`. Il path è configurabile (`YTDLP_PATH`).

*Alternative*: librerie Node per YouTube (fragili e meno mantenute di yt-dlp); BullMQ/Redis (un servizio in più senza necessità); `--embed-metadata --embed-thumbnail` di yt-dlp (meno controllo sui metadati ripuliti e sulla riscrittura dopo le modifiche).

### D6. Eventi in tempo reale

`@fastify/websocket` su `/api/ws`. Messaggi JSON tipizzati in `packages/shared`:
`job.queued | job.progress | job.completed | job.failed`, con payload `{ jobId, sourceId, status, progress?, error?, track? }`. Gli eventi sono inviati a tutti gli utenti connessi (la libreria è condivisa); il client decide cosa fare in base a `requestedBy`. Il client si riconnette con backoff esponenziale (1 s → 30 s) e, alla riconnessione, ricarica `GET /api/jobs`. Ping/pong ogni 30 s per tenere aperta la connessione attraverso il tunnel (idle timeout Cloudflare 100 s).

*Alternativa*: Server-Sent Events (più semplice, ma su iOS standalone il comportamento in background è equivalente e i WebSocket sono richiesti dal brief).

### D7. Streaming e caching HTTP

- `GET /api/tracks/:id/audio` servito con `@fastify/send`/`send` (Range, 206, 416, ETag) dopo la verifica di sessione; `Cache-Control: private, max-age=31536000, immutable`.
- `GET /api/tracks/:id/cover?size=512|128` con lo stesso header.
- Cloudflare: gli header `private` impediscono il caching sull'edge; documentata comunque una Cache Rule "bypass" su `/api/*`.

### D8. Frontend: Svelte 5 + Vite, SPA senza SvelteKit

- Svelte 5 (runes) + Vite + TypeScript. Nessun SvelteKit: le viste sono poche, serve un controllo totale sul DOM radice (il player non deve mai essere smontato) e un Service Worker personalizzato.
- **Router minimale** basato su History API (`pushState`/`popstate`) con tabella di rotte: `/`, `/search`, `/library`, `/library/downloaded`, `/playlist/:id`, `/favorites`, `/settings`, `/login`, `/register`. Il player a schermo intero è uno stato sovrapposto con una entry di history propria, così Indietro lo chiude. Le posizioni di scorrimento sono salvate per entry.
- **Struttura del DOM**: `App.svelte` contiene il router delle viste, `MiniPlayer`, `FullPlayer`, `TabBar` e l'unico `<audio>`; le viste cambiano dentro un contenitore, l'audio resta.
- **Stato**: store a runes per sessione, player, coda, download, connessione; la cache dati API è un semplice "stale-while-revalidate" in memoria più IndexedDB per i dati offline (D10).
- **Design system**: token CSS custom properties (`--bg: #121212`, `--surface-1: #181818`, `--surface-2: #202020`, `--surface-3: #282828`, `--accent: #FF5F1F`, testo `#FFFFFF`/`#B3B3B3`), font di sistema (`-apple-system, Inter fallback` self-hosted) per evitare FOIT. Tab bar con `backdrop-filter: blur(10px)` (+ `-webkit-`), `env(safe-area-inset-*)`, `viewport-fit=cover`. Accento Neon Orange scelto fra le due opzioni del brief (più leggibile su `#121212`, coerente con il tema "spooky"); essendo un token si cambia in un punto.
- **Zero layout shift**: righe a altezza fissa, `aspect-ratio` sulle copertine, skeleton, `font-display: swap` con metriche compatibili; `dominant_color` usato come colore di sfondo delle copertine prima che l'immagine arrivi.
- **Gesti**: swipe-up/down del player con Pointer Events e `transform: translateY` (GPU), soglia di velocità/distanza; rispetto di `prefers-reduced-motion`.
- **Marquee**: animazione CSS attivata solo se `scrollWidth > clientWidth` (misura con `ResizeObserver`).

*Alternative*: React (bundle più pesante), SvelteKit in modalità SPA (routing e SW più vincolati).

### D9. Motore audio e MediaSession

- Un solo `HTMLAudioElement` creato una volta; il cambio brano modifica `src` sullo stesso elemento (necessario su iOS per l'avanzamento in background e la lockscreen). Nessun Web Audio API (su iOS interrompe il background).
- La prima `play()` è chiamata solo dentro l'handler di un tap; lo stato ripristinato all'avvio imposta `src` e `currentTime` senza `play()`.
- `navigator.mediaSession.metadata` con artwork 128 e 512; handler `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`; `setPositionState` su `loadedmetadata`, `seeked`, `ratechange` e pause/play. Niente `seekbackward/seekforward`, così iOS mostra Precedente/Successivo invece dei salti di 10 s.
- Coda: array di track id + indice + permutazione per shuffle (Fisher–Yates sulla parte restante; l'ordine originale è conservato per lo "unshuffle"). Stato salvato in `localStorage` (throttle 5 s e su `pagehide`).
- Soglia ascolto: accumulo del tempo effettivamente riprodotto (non della posizione), così i seek non falsano il conteggio; evento inviato una volta per riproduzione, con UUID generato dal client.
- Risoluzione della sorgente: `src` è sempre l'URL di rete `/api/tracks/:id/audio`; è il Service Worker a servirlo dalla cache se presente (D10). Questo rende il fallback "cache eliminata → streaming" automatico e senza ramificazioni nel player. Offline, prima di caricare un brano il player verifica la presenza in cache e salta quelli assenti.

### D10. Service Worker, cache audio e dati offline

- `vite-plugin-pwa` in modalità **injectManifest** con SW scritto a mano usando i moduli Workbox:
  - precache dell'app shell (con `cleanupOutdatedCaches`) e navigation fallback a `index.html` esclusi `/api/*`;
  - rotta per `/api/tracks/*/audio`: `CacheOnly` sulla cache `spk-audio-v1` con **`RangeRequestsPlugin`** (WebKit chiede sempre `Range: bytes=0-1` e poi intervalli: il SW deve rispondere 206 ritagliando la risposta in cache), e passthrough di rete se il brano non è in cache;
  - rotta per le copertine: `StaleWhileRevalidate` su `spk-covers-v1` con limite di voci per le non scaricate;
  - aggiornamento con `registerType: 'prompt'`: il nuovo SW resta in attesa e l'app propone "Aggiorna" quando non c'è riproduzione in corso (spec `app-shell`).
- **Download di un brano**: `fetch` senza Range della risorsa audio, lettura dello stream per l'avanzamento (Content-Length), `cache.put` solo a risposta completa (dimensione verificata contro `size_bytes`); altrimenti nulla viene salvato. La copertina 512 viene salvata nella stessa operazione.
- **Indice locale (IndexedDB, libreria `idb`)**: store `tracks` (metadati dei brani noti), `downloads` (trackId → stato, dimensione, data), `playlists`/`favorites` (snapshot dell'ultimo caricamento online), `pendingPlays` (ascolti da inviare), `downloadQueue` (coda dei download di playlist, per la ripresa).
- **Riconciliazione**: all'avvio e su `visibilitychange` l'app confronta `downloads` con `caches.match` e marca come non scaricati i brani mancanti (eviction dell'OS). Lo stesso controllo avviene prima della riproduzione offline.
- **Storage persistente**: `navigator.storage.persist()` al primo avvio dopo il login (su iOS è concesso alle PWA installate), `navigator.storage.estimate()` per le impostazioni.
- **Download di playlist**: coda persistita in IndexedDB, un brano alla volta (meglio per il Pi e per la ripresa). Mentre la coda non è vuota e la pagina è visibile si mantiene un `WakeLock('screen')`, riacquisito su `visibilitychange`. La "modalità schermo scuro" è un overlay `#000` con solo l'avanzamento: le API web non possono regolare la luminosità, ma su OLED il nero puro è l'equivalente pratico della "luminosità minima" del brief.
- **Salvataggio automatico dopo l'importazione**: alla ricezione di `job.completed` per un job con `requestedBy` = utente corrente e richiesto da questa istanza (id job tenuti in memoria/IndexedDB), l'app accoda il download del brano; se l'utente preme Play prima, lo streaming parte dalla rete in parallelo. Si accetta il doppio trasferimento per quel primo ascolto: fare il "tee" delle richieste Range dell'`<audio>` non produrrebbe un file completo e affidabile.

*Alternative*: salvare l'audio in IndexedDB come Blob e usare `URL.createObjectURL` (perde il fallback automatico via SW e complica la lockscreen su iOS); OPFS (supporto e quote su iOS meno prevedibili di CacheStorage per questo uso).

### D11. Deploy

- Build: `pnpm build` produce `apps/web/dist` (servito da Fastify) e `apps/server/dist`.
- Configurazione via variabili d'ambiente validate con Zod all'avvio: `PORT` (default 8787, bind su `127.0.0.1`), `DATA_DIR`, `MEDIA_DIR`, `PUBLIC_ORIGIN`, `YTDLP_PATH`, `FFMPEG_PATH`, `INGEST_CONCURRENCY` (default calcolato dall'hardware, D5), `INGEST_NICE`, `TRUST_CF_HEADERS`, `REGISTRATION_TOKEN` (default `spotifymerdacostosa2026`, vuoto = registrazione disabilitata; se resta il default il server lo segnala con un warning nel log all'avvio). Al boot il server registra nel log il profilo rilevato (core, RAM, concorrenza scelta).
- Stessa build e stesse istruzioni per arm64 e x64; il README include una sezione "dimensionamento" con i valori suggeriti per mini-PC/Raspberry Pi e per server più potenti.
- `deploy/spookyfy.service` (systemd, utente dedicato, `Restart=on-failure`), `deploy/cloudflared/config.yml` d'esempio (ingress `spookyfy.<dominio>` → `http://127.0.0.1:8787`), `deploy/yt-dlp-update.timer`.
- Backup: documentato il backup di `DATA_DIR` (SQLite con `VACUUM INTO`) e di `MEDIA_DIR`.

## Risks / Trade-offs

- [yt-dlp smette di funzionare per cambi lato YouTube] → aggiornamento automatico settimanale, errori leggibili nei job, retry manuale; la libreria già importata non ne risente.
- [iOS elimina CacheStorage nonostante `persist()`] → riconciliazione all'avvio e fallback trasparente allo streaming tramite SW (D10); la futura change sullo Storage Manager renderà visibile lo stato.
- [Bug storici di WebKit con `<audio>` servito da Service Worker e Range] → `RangeRequestsPlugin` + test end-to-end Playwright su WebKit; verifica manuale su iPhone reale prevista nei task. Piano B già individuato: per i brani in cache usare un Blob URL (perdendo il fallback automatico).
- [WakeLock non disponibile o non funzionante in PWA standalone su alcune versioni di iOS] → feature detection, avviso all'utente, coda persistita e ripresa automatica al ritorno in primo piano.
- [Doppio download per i brani appena importati] → accettato: avviene una sola volta per brano e solo per i brani richiesti da quel dispositivo.
- [Sul profilo minimo (Raspberry Pi) le conversioni ffmpeg possono rallentare lo streaming] → concorrenza dei job derivata dai core disponibili e configurabile, processi figli con `nice`.
- [Su server potenti il default automatico potrebbe essere troppo prudente o troppo aggressivo] → limite superiore a 8, override con `INGEST_CONCURRENCY`/`INGEST_NICE` documentato nel README.
- [Libreria condivisa: un utente può modificare o eliminare brani usati da altri] → accettato per un uso familiare; eventuali permessi più fini in una change futura.
- [Rate limit in memoria si azzera al riavvio] → impatto trascurabile; Argon2id rende comunque costoso il brute force.
- [Il token predefinito è scritto nel repository: chiunque legga il codice può registrarsi su un'istanza che non l'ha cambiato] → configurabile con `REGISTRATION_TOKEN`, warning nel log se resta il default, README che consiglia di cambiarlo e di svuotarlo quando non servono nuove registrazioni.
- [Token condiviso: una volta diffuso non si può revocare per singola persona] → si cambia il valore e si riavvia il servizio; gli account già creati restano validi e si eliminano da CLI se serve.
- [Uso di yt-dlp e termini di servizio delle piattaforme] → strumento per uso personale; responsabilità dell'utente, indicata nel README.

## Migration Plan

Progetto nuovo, nessuna migrazione di dati. Deploy iniziale:

1. Installare Node 22, pnpm, ffmpeg, yt-dlp e cloudflared sul server.
2. Clonare il repo, `pnpm install && pnpm build`, configurare il file d'ambiente.
3. Impostare `REGISTRATION_TOKEN`, poi creare il primo account dall'app con il token (oppure con la CLI).
4. Installare il servizio systemd e il tunnel Cloudflare.
5. Aprire l'URL da Safari iOS e aggiungere alla schermata Home.

Rollback: le migrazioni del DB sono solo additive in questa change; tornare a una versione precedente significa fermare il servizio, ripristinare il backup di `DATA_DIR` e riavviare la build precedente.
