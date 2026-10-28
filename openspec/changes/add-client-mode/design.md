# Design

## Context

Motivazioni, fattibilità e perimetro sono in `proposal.md`; i comportamenti richiesti sono nelle spec di questa change. Stato attuale del codice, rilevante per l'approccio:

- `apps/web` parla con il backend solo tramite l'oggetto `api` (`src/lib/api.ts`), usato dagli store (`Library`, `Jobs`, `Session`, `PlayReporter`) e da poche viste (Cerca, Libreria). I brani sono `TrackDto` con `audioUrl` e `coverUrl`; il player usa sempre `track.audioUrl`. Il Service Worker serve dalla cache `spk-audio-v1` gli URL `/api/tracks/:id/audio` con risposte 206 (`createPartialResponse`). IndexedDB è alla versione 1, con migrazioni per versione già previste (`MIGRATIONS` in `src/lib/offline/db.ts`).
- `apps/server` espone `GET /api/health` (`{ status }`), autentica con cookie `spk_session` in un hook globale `onRequest` e controlla `Origin` su tutti i metodi non sicuri.
- `packages/shared` contiene già gli schemi di username, password e registrazione e i DTO; la pulizia dei metadati (`cleanMetadata`) è in `apps/server/src/ingest/metadata.ts`.

Vincoli esterni verificati (ottobre 2026): funzioni Vercel con risposta massima di 4,5 MB **salvo streaming**, durata massima 300 s su Hobby, 2 GB di memoria, bundle fino a 250 MB; nessun ffmpeg; IP di uscita AWS soggetti ai controlli anti-bot di YouTube.

## Goals / Non-Goals

**Goals:**

- Un solo build della PWA per entrambe le modalità, con scelta a runtime.
- Gateway senza stato, salvo un KV minimo per account e contatori: niente database, niente file.
- Riutilizzo massimo del codice esistente (DTO, viste, player, Service Worker), introducendo un'unica interfaccia di backend.
- Modalità on-premise invariata, salvo l'aggiunta del ponte (token di accesso e CORS).

**Non-Goals:**

- Sincronizzazione fra dispositivi, account condivisi o libreria condivisa in modalità client.
- Aggirare attivamente i controlli anti-bot di YouTube (cookie di account, proxy residenziali, PO token): esclusi su scelta esplicita.
- Transcodifica sul gateway; tag ID3 nei file importati da YouTube (i metadati vivono in IndexedDB).
- WebSocket sul gateway: l'avanzamento delle importazioni è calcolato dal client.

## Decisions

### D1. Modalità dichiarata dalla health check

`GET /api/health` risponde, sia sul server on-premise sia sul gateway, con `{ status, mode: 'onpremise' | 'client', version, features: string[] }` (tipo `HealthDto` in `packages/shared`). La PWA lo legge all'avvio, salva l'ultima modalità in `localStorage` per l'avvio offline e crea i servizi corrispondenti (D3).

*Alternative*: build separate con `VITE_MODE` (due artefatti da mantenere, impossibile riusare lo stesso build); rilevamento dall'hostname (fragile).

### D2. Gateway in `apps/gateway`: 6 funzioni su un budget di 12

Progetto Vercel con Root Directory `apps/gateway`, runtime Node.js 22, region `fra1` (più vicina all'Italia; la reputazione degli IP può variare per region e si può cambiare senza modifiche al codice). La PWA viene compilata nel build del gateway e servita come file statici (`outputDirectory: public`), con rewrite SPA verso `index.html` per tutto ciò che non è `/api/*` né un file esistente.

| # | Funzione | Metodi | `maxDuration` | Uso |
|---|---|---|---|---|
| 1 | `api/health.ts` | GET | 10 s | modalità e funzionalità (pubblica) |
| 2 | `api/auth/[action].ts` | GET/POST | 15 s | `login`, `logout`, `me`, `register` |
| 3 | `api/search.ts` | GET | 20 s | ricerca su YouTube |
| 4 | `api/meta/[id].ts` | GET | 20 s | metadati ripuliti e dimensione del flusso audio |
| 5 | `api/audio/[id].ts` | GET | 300 s | proxy audio in streaming con Range |
| 6 | `api/cover/[id].ts` | GET | 15 s | proxy della miniatura |

Il codice comune vive in `apps/gateway/lib/` (non conta come funzione). Uno script `scripts/count-functions.mjs` conta i file di `api/` che diventano funzioni ed è eseguito in CI e nel build: oltre 12 il build fallisce. Restano 6 slot liberi per evoluzioni future.

Gli handler sono scritti con la firma Web standard (`export async function GET(request: Request): Promise<Response>`), supportata dal runtime Node di Vercel, così che lo stesso codice giri anche in un piccolo server Node locale (`apps/gateway/dev-server.ts`) usato da sviluppo e test end-to-end, senza `vercel dev`.

*Alternative*: Edge runtime (niente moduli nativi come Argon2, limiti più stretti); un'unica funzione "catch-all" (meno chiara, `maxDuration` unico); framework (Next.js: superfluo, la PWA è già Svelte).

### D3. Un'interfaccia di backend, due implementazioni nel client

Si estrae da `src/lib/api.ts` l'interfaccia `Backend` (stessa forma dell'oggetto `api` attuale: `auth`, `tracks`, `favorites`, `plays`, `playlists`, `remote`) e se ne forniscono due implementazioni:

- `RemoteBackend`: l'attuale client HTTP verso l'on-premise, invariato.
- `DeviceBackend`: implementazione locale su IndexedDB per libreria, preferiti, playlist e ascolti; `auth` delega al gateway; `remote.search` al gateway (o al ponte); `remote.ingest`/`jobs`/`retry` usano il gestore di importazioni locale (D7), che produce `JobDto` con la stessa forma degli eventi del server.

`createServices` riceve la modalità e collega l'implementazione giusta; `Library`, `Jobs`, `PlayReporter`, viste e componenti restano invariati. In modalità client `Jobs` non usa il WebSocket ma riceve gli eventi dal gestore locale; `PlayReporter` scrive direttamente nello storico locale.

*Alternative*: due app separate (duplicazione); un Service Worker che emula l'API REST localmente (elegante ma difficile da testare e da debuggare, e il SW su iOS può essere terminato in ogni momento).

### D4. Dati locali: IndexedDB v2 e Cache Storage

Migrazione IndexedDB `2` (aggiunta, non distruttiva) con gli store `libTracks` (indici per `sourceKey` unico, `addedAt`, `title`, `artist`), `libFavorites`, `libPlaylists`, `libPlaylistItems` (indice `playlistId+position`, posizioni frazionarie come sul server), `libPlays` (indice `trackId`, `playedAt`), `imports` (coda persistente) e `settings` (ponte, data dell'ultimo backup). In modalità on-premise questi store restano vuoti.

I file vivono in Cache Storage (`spk-device-audio-v1`, `spk-device-covers-v1`) sotto URL sintetici della stessa origine, `/local/audio/<id>` e `/local/cover/<id>?size=512|128`, così `TrackDto.audioUrl`/`coverUrl` funzionano senza modifiche al player. Il Service Worker aggiunge una rotta `CacheOnly` per `/local/*` con risposte parziali (`createPartialResponse`) e `404` se manca la voce: il player tratta il 404 come brano perso (D9). Ogni brano viene registrato in `libTracks` solo dopo la scrittura del file in cache, nella stessa operazione logica, con ripulitura dei file orfani all'avvio.

Ricerca locale: normalizzazione (NFD senza diacritici, minuscole) su titolo, artista e album, con corrispondenza per prefisso delle parole, eseguita in memoria su un indice ricostruito all'avvio: adeguata fino a decine di migliaia di brani.

*Alternative*: OPFS per i file (supporto e quote su iOS meno prevedibili; perderemmo l'integrazione con il SW e le risposte 206); SQLite WASM (peso e complessità non giustificati).

### D5. Autenticazione sul gateway

- **KV**: Upstash Redis tramite l'integrazione di Vercel (`@upstash/redis`, via REST, adatto alle funzioni). Chiavi: `user:<username normalizzato>` → `{ id, username, passwordHash, createdAt, sessionEpoch }`; `revoked:<jti>` con TTL fino alla scadenza del token; `rl:login:<ip>|<user>` e `rl:reg:<ip>` con `INCR` + `EXPIRE 900`. La creazione usa `SET ... NX` per garantire l'unicità anche con registrazioni concorrenti.
- **Regole condivise**: schemi di username, password e registrazione e messaggi d'errore da `packages/shared`; token di invito da `REGISTRATION_TOKEN` (stesse regole e stesso confronto in tempo costante dell'on-premise); hash Argon2id con `@node-rs/argon2` (binario prebuilt `linux-x64-gnu`).
- **Sessione**: JWT HS256 (`jose`) firmato con `SESSION_SECRET`, claim `sub`, `usr`, `ep` (sessionEpoch), `jti`, scadenza 30 giorni, in cookie `spk_session` HttpOnly, Secure, SameSite=Lax. Rinnovo: se il token ha più di un'ora se ne emette uno nuovo. Verifica a ogni richiesta autenticata: firma e scadenza, poi una sola lettura `MGET user:<u> revoked:<jti>` per confrontare `ep` e revoca. Logout: `revoked:<jti>`. Cambio password o eliminazione: incremento di `sessionEpoch` o rimozione dell'utente.
- **CSRF**: stesso controllo `Origin` dell'on-premise contro `PUBLIC_ORIGIN`. IP del client da `x-forwarded-for` impostato da Vercel.
- **CLI**: `pnpm --filter @spookyfy/gateway cli user:create|user:passwd|user:list|user:delete`, che usa le credenziali REST del KV dal file `.env` locale.

*Alternative*: account da variabile d'ambiente (scartata: niente registrazione); Vercel Edge Config (pensato per letture, scritture lente); Postgres (eccessivo per due tipi di chiave).

### D6. YouTube sul gateway con `youtubei.js`

Client Innertube in puro JavaScript, senza binari né Python, usato per ricerca (`search`, solo video, senza dirette), metadati (`getBasicInfo`) e scelta del formato audio AAC/M4A (itag 140, 128 kbit/s), con decifrazione dell'URL del flusso. Il proxy audio richiama googlevideo **dalla stessa invocazione** che ha risolto l'URL (l'URL è legato all'IP), inoltra l'header `Range` del client e restituisce in streaming `200`/`206` con `Content-Type: audio/mp4`, `Content-Length`, `Content-Range`, `Accept-Ranges`. Per richieste senza Range il file viene letto a blocchi di 8 MB, perché YouTube rallenta le richieste singole molto grandi.

Per evitare di decifrare a ogni richiesta Range, l'URL risolto è tenuto in una cache in memoria dell'istanza per al massimo 4 ore (gli URL scadono dopo circa 6). Non è persistenza: un'istanza nuova risolve di nuovo. Nessun URL, metadato o file finisce nel KV.

I metadati vengono ripuliti con `cleanMetadata`, spostata da `apps/server` a `packages/shared` e usata da entrambi i backend. Errori mappati: verifica anti-bot o accesso richiesto → `YOUTUBE_BLOCKED` (503); video non disponibile → `VIDEO_UNAVAILABLE` (404); oltre 20 minuti o diretta → `VIDEO_TOO_LONG` (422); timeout → `REMOTE_SEARCH_UNAVAILABLE` (503). La versione di `youtubei.js` è fissata e aggiornata con un controllo programmato (Dependabot).

*Alternative*: binario standalone di yt-dlp nella funzione Python (più robusto nell'estrazione, ma bundle e avvio a freddo pesanti e conversione impossibile senza ffmpeg); YouTube Data API v3 per la ricerca (affidabile ma quota di circa 100 ricerche al giorno e non risolve l'audio).

### D7. Gestore delle importazioni sul dispositivo

Coda persistente in `imports` (stati `queued`, `running`, `completed`, `failed`, con avanzamento), concorrenza 2, ripresa al ritorno in primo piano e WakeLock con le stesse regole dei download di playlist (riuso di `WakeLockController`). Flusso di un'importazione da YouTube:

1. `GET /api/meta/:id` (metadati, dimensione prevista, controllo dello spazio con `navigator.storage.estimate()`);
2. `GET /api/cover/:id` → `createImageBitmap` → ritagli 512/128 su canvas (`toBlob` JPEG) e colore dominante (media su una miniatura 32×32 escludendo pixel quasi neri o bianchi);
3. `GET /api/audio/:id` letto in streaming con avanzamento, verifica della dimensione, scrittura in cache;
4. inserimento in `libTracks` ed evento `job.completed` per l'interfaccia.

Riproduzione durante l'importazione: il player riceve un `TrackDto` provvisorio con `audioUrl` puntato a `/api/audio/:id` (streaming dal gateway) che viene sostituito dal brano locale a importazione completata, come per il salvataggio automatico della modalità on-premise.

**Da file**: `<input type="file" accept="audio/mpeg,audio/mp4,audio/aac,.mp3,.m4a,.aac" multiple>`; tag letti con `music-metadata` (versione per browser, caricata solo su richiesta) per ID3 e atomi MP4 (titolo, artista, album, copertina); durata dai tag o da un elemento `<audio>`; rifiuto se `canPlayType` è vuoto. Il file viene messo in cache così com'è. La chiave di deduplicazione è `youtube:<id>` per YouTube e `file:<sha-256 dei primi 1 MB + dimensione>` per i file.

**Ponte**: impostazioni con URL e token (salvati in IndexedDB `settings`); richieste `fetch` con `Authorization: Bearer` e `credentials: 'omit'`; ricerca su `/api/search/remote`, importazione su `/api/ingest`, stato con polling di `/api/jobs` ogni 2 s (niente WebSocket cross-origin), poi download di metadati, audio MP3 e copertine. La chiave di deduplicazione resta `youtube:<sourceId>`.

### D8. Backup su file ZIP

Formato `spookyfy-backup` versione 1, generato e letto con `fflate` (ZIP in streaming, leggero):

- `spookyfy-backup-AAAA-MM-GG.zip`: `manifest.json` (versione, data, conteggi, elenco delle parti audio con hash), `library.json` (brani, preferiti, playlist con ordine, ascolti), `covers/<id>-512.jpg`;
- con audio: `spookyfy-backup-AAAA-MM-GG-audio-N.zip` di al massimo 300 MB ciascuna, generate una alla volta per contenere la memoria.

Su iOS i file si consegnano con la Web Share API (`navigator.share({ files })`, il foglio di condivisione permette "Salva su File"), con fallback al download. L'importazione accetta più file, verifica versione e hash, unisce per chiave di deduplicazione, rinumera le posizioni delle playlist e ignora gli ascolti già presenti (id univoci). La data dell'ultimo backup e il conteggio dei brani aggiunti da allora sono in `settings`, per il promemoria.

*Alternative*: un unico ZIP (rischio di esaurire la memoria del telefono oltre qualche centinaio di MB); JSON con audio in base64 (+33% e tutto in memoria).

### D9. Eliminazione dello storage da parte del sistema

All'avvio e su `visibilitychange` si confrontano `libTracks` con `spk-device-audio-v1`. I brani senza file vengono marcati `lost` (restano in libreria, attenuati, con "Riscarica" se la sorgente è YouTube) e l'app mostra un avviso con il numero di brani persi e l'invito a ripristinare un backup. Se anche IndexedDB è vuoto ma la modalità salvata è `client` e un backup risulta esportato in passato (indicatore in `localStorage`), l'app propone direttamente il ripristino.

### D10. Ponte sul server on-premise

- Tabella `access_tokens` (id, user_id, name, token_hash SHA-256, created_at, last_used_at) e migrazione Drizzle. Token `spk_<32 byte base64url>`, mostrato una sola volta.
- Rotte con sessione via cookie: `GET/POST /api/me/tokens`, `DELETE /api/me/tokens/:id`; CLI `token:create <username> <nome>`, `token:list <username>`, `token:revoke <id>`; sezione "Token di accesso" nelle impostazioni dell'app on-premise.
- L'hook `onRequest` accetta `Authorization: Bearer` solo per le rotte marcate `config.token: true` (ricerca remota, importazione, job e retry, `GET /api/tracks/:id`, audio, copertine). Le richieste con un token valido sono esentate dal controllo `Origin` (spec `user-auth` modificata) anche se il browser allega un cookie: il WebKit di Playwright lo fa nonostante `credentials: 'omit'`, e un sito terzo non può conoscere il token, quindi non c'è rischio CSRF. Un token non valido viene rifiutato senza ricadere sulla sessione; le richieste solo con cookie restano soggette al controllo.
- CORS con `@fastify/cors` limitato alle origini in `BRIDGE_ALLOWED_ORIGINS` (vuota = ponte disabilitato), `credentials: false`, header `Authorization` e `Range` consentiti, `Content-Range` e `Content-Length` esposti, solo sulle rotte con token.
- Limite di 20 token non validi ogni 15 minuti per IP, con lo stesso `FailureRateLimiter` dei login.

## Risks / Trade-offs

- [YouTube blocca gli IP di Vercel: ricerca e importazione dal gateway falliscono spesso o sempre] → errore specifico `YOUTUBE_BLOCKED`, importazione da file e ponte on-premise come alternative, region configurabile. La spike del task 1 misura il comportamento reale prima di costruire il resto: se il blocco è sistematico, la modalità client resta utile con file e ponte, e la ricerca dal gateway diventa una funzione secondaria.
- [`youtubei.js` si rompe quando YouTube cambia l'API interna] → versione fissata, aggiornamenti automatici, errori leggibili; la libreria già importata non ne risente.
- [iOS cancella lo storage della PWA: in modalità client si perde la libreria] → storage persistente, avvisi, rilevamento dei brani persi, backup con promemoria. Rischio residuo esplicitato all'utente.
- [Memoria del telefono durante backup grandi] → parti audio da 300 MB generate in sequenza; Web Share API su iOS.
- [Fair use e termini del piano Hobby di Vercel (uso personale, banda inclusa limitata)] → uso personale dichiarato nel README; il traffico audio passa dal gateway solo una volta per brano.
- [Doppio trasferimento quando si ascolta durante l'importazione] → accettato, come in on-premise.
- [Token del ponte salvato sul telefono] → token revocabile, limitato alle rotte d'importazione e lettura, mai inviato insieme ai cookie.
- [Consumo di comandi del KV (verifica sessione a ogni richiesta)] → una sola `MGET` per richiesta; il piano gratuito di Upstash è ampiamente sufficiente per uso personale.

## Migration Plan

1. Archiviare `add-spookyfy-mvp` (le sue spec diventano principali; `user-auth` viene poi modificata da questa change).
2. Le modifiche all'on-premise sono additive: la nuova tabella dei token si crea con la migrazione automatica all'avvio; senza `BRIDGE_ALLOWED_ORIGINS` il comportamento resta identico a prima.
3. Deploy del gateway: progetto Vercel (Root Directory `apps/gateway`), integrazione Upstash Redis, variabili `SESSION_SECRET`, `REGISTRATION_TOKEN`, `PUBLIC_ORIGIN`; primo account dalla CLI o dall'app con il token.
4. Rollback: il gateway è un deployment separato e si può rimuovere senza effetti sull'on-premise; sul telefono i dati della modalità client restano in IndexedDB e Cache Storage finché l'utente non li cancella.

## Open Questions

- Region Vercel definitiva (`fra1` come default): dipende dai risultati della spike sul blocco anti-bot e si cambia senza toccare codice né spec.
