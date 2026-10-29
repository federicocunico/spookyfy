# Design

## Context

Motivazioni e perimetro sono in `proposal.md`, i comportamenti nelle spec `album-catalog`, `genre-tags`, `cover-lookup`, `library-backup` e `cloud-gateway` di questa change. Stato attuale del codice, rilevante per l'approccio:

- **Server** (`apps/server`): la tabella `tracks` ha `album` come testo libero, `cover_path` come prefisso (`covers/<id>` → `<prefix>-512.jpg` e `-128.jpg`) e `dominant_color`; nessuna tabella di album, generi o impostazioni. Ultima migrazione: `drizzle/0003_auto_trim.sql`. Le copertine sono prodotte da `processCover` (sharp, `src/ingest/covers.ts`) e servite da `GET /api/tracks/:id/cover?size=`. Le importazioni vengono solo da YouTube (yt-dlp, che a volte fornisce `album`). `PATCH /api/tracks/:id` riscrive i tag con node-id3 (`updateTextTags`). Tutte le rotte sono autenticate da un hook globale, salvo `config.public`.
- **Client** (`apps/web`): `DeviceLibrary` su IndexedDB v2 (`libTracks`, `libPlaylists`, `libPlaylistItems`, …; migrazioni per versione in `src/lib/offline/db.ts`) e file in Cache Storage sotto `/local/*`, serviti dal Service Worker. L'importazione da file usa music-metadata e legge titolo, artista, album e copertina, ignorando generi e numero di traccia. Le copertine sono elaborate con canvas (`src/lib/device/cover.ts`). Le viste parlano con un'unica interfaccia di backend (`src/lib/api.ts` on-premise, `src/lib/device/backend.ts` in modalità client).
- **Gateway** (`apps/gateway`): 6 funzioni su 12, conteggio verificato in CI da `scripts/count-functions.mjs`; il proxy delle copertine esistente accetta solo ID di video YouTube.
- **Backup**: `BACKUP_VERSION = 1` come `z.literal`; gli schemi zod scartano le chiavi sconosciute.
- **Servizi esterni**: MusicBrainz chiede al massimo 1 richiesta al secondo per IP e un User-Agent con contatto; Cover Art Archive reindirizza ad archive.org; iTunes Search non richiede chiavi e restituisce copertine su `*.mzstatic.com`.

## Goals / Non-Goals

**Goals:**

- Un solo modello di album e generi, con la stessa forma dei DTO in entrambe le modalità, così che viste e componenti siano condivisi.
- Logica di ricerca online (provider, normalizzazione, punteggio, corrispondenza sicura) scritta una volta in `packages/shared` e usata da server e gateway.
- Nessuna modifica al player: la copertina dell'album arriva ai brani tramite i campi già esistenti del `TrackDto`.
- Migrazioni additive e idempotenti, senza perdita di dati e senza riscrivere tabelle esistenti.

**Non-Goals:**

- Album "di sola lettura" importati da MusicBrainz con elenco tracce completo o brani mancanti.
- Una tabella di artisti o la deduplicazione degli artisti.
- Correzione automatica di titoli o artisti dei brani dalla ricerca online (si applicano solo ai campi dell'album, su scelta).

## Decisions

### D1. Album come entità, brano con al massimo un album

Server, migrazione `0004_albums_genres.sql`:

- `albums`: `id`, `title`, `artist`, `year` (nullable), `title_key`, `artist_key` (forme normalizzate), `origin` (`auto` | `manual`), `cover_path` (nullable: solo copertine assegnate), `cover_color` (nullable), `cover_version` (intero), `lookup_status` (`pending` | `done`), `created_at`, `updated_at`; indice unico su `(title_key, artist_key)`.
- `tracks`: nuove colonne `album_id` (FK verso `albums`, `ON DELETE SET NULL`) e `album_position` (real, posizioni frazionarie come `playlist_items.position`).
- La colonna `tracks.album` resta e viene aggiornata nella stessa transazione di `album_id` (copia del titolo). Così ricerca, `TrackDto.album`, tag ID3 e codice esistente non cambiano.

Client, IndexedDB v3: store `libAlbums` (indice unico `key` = `title_key + '\u0000' + artist_key`, indice `addedAt`) con gli stessi campi; `LocalTrackRecord` riceve `albumId`, `albumPosition` e `genres: string[]`. Il campo `album` resta come sul server.

Normalizzazione delle chiavi (`albumKey` in `packages/shared`): NFD senza diacritici, minuscole, spazi compressi e rimossi ai bordi. È la stessa regola della ricerca locale; non toglie diciture come "Remastered", così due edizioni diverse restano due album (le diciture contano solo per la corrispondenza sicura, D6).

*Alternative*: album derivato al volo dal testo `tracks.album` (niente ordine, anno, copertina né album vuoti creati a mano); relazione molti-a-molti come le playlist (contraddice "un brano, un album" e complica la copertina sui brani); rimuovere `tracks.album` (in SQLite significa ricostruire la tabella, e il join servirebbe ovunque).

### D2. Un unico punto per assegnare un brano a un album

Server e `DeviceLibrary` hanno un'unica operazione `setTrackAlbum(trackId, albumId | null, position?)`, usata da importazione, modifica del campo album, aggiunta o rimozione dall'album e ripristino del backup. Mantiene `album`/`album_id` allineati, elimina gli album `auto` rimasti vuoti e, on-premise, accoda la riscrittura dei tag (D9). `findOrCreateAlbum(title, artist, origin)` usa l'indice unico per evitare duplicati anche con importazioni concorrenti (`INSERT … ON CONFLICT DO NOTHING` seguito da `SELECT`; nel client, l'indice unico dentro la transazione).

All'importazione: artista dell'album = `albumartist` se presente, altrimenti l'artista del brano; posizione = numero di traccia se presente (in modo che `1, 2, …` si ordinino correttamente anche se importati in disordine), altrimenti dopo l'ultimo.

### D3. Copertina dell'album sui brani tramite il DTO

`TrackDto` riceve `albumId: string | null` e `genres: string[]`. Quando l'album ha una copertina assegnata, `coverUrl`, `coverThumbUrl` e `dominantColor` del brano vengono calcolati da quelli dell'album, altrimenti restano quelli del brano. Player, sessione multimediale, liste e Service Worker continuano a leggere gli stessi campi.

- On-premise: `GET /api/albums/:id/cover?size=512|128&v=<cover_version>`; il parametro `v` cambia a ogni nuova copertina ed evita copertine vecchie nelle cache.
- Client: `/local/album-cover/<id>?size=512|128&v=<n>` in `spk-device-covers-v1`, servita dalla rotta `/local/*` del Service Worker. Senza copertina assegnata, l'album usa la copertina del primo brano (stessa logica sia per l'album sia per i brani).

Elaborazione delle immagini caricate: sul server `processCover` esistente (sharp), sul client `processCover` canvas esistente. Il caricamento sul server avviene con corpo binario `image/jpeg|png|webp` (limite 10 MB) su `PUT /api/albums/:id/cover`, senza dipendenze multipart.

*Alternative*: copiare la copertina dentro ogni brano (scritture moltiplicate, ripristino dell'originale difficile); far scegliere al player la copertina (logica duplicata in liste, player e sessione multimediale).

### D4. Generi

Server: `genres` (`id`, `name`, `key` unico) e `track_genres` (`track_id`, `genre_id`, chiave primaria composta, `ON DELETE CASCADE`). Un genere senza brani viene eliminato nella stessa transazione che lo stacca dall'ultimo brano. Client: i generi vivono nel record del brano (`genres: string[]`) e l'elenco dei generi è un indice in memoria ricostruito all'avvio e aggiornato a ogni modifica, come l'indice di ricerca.

La grafia canonica di un genere è quella del primo inserimento: `splitGenres` e `normalizeGenres(input, existing)` in `packages/shared` tolgono gli spazi superflui, dividono i valori multipli dei tag (`;`, `,`, NUL di ID3v2.4; non `/`, che compare in nomi come "R&B/Soul"), scartano i codici numerici ID3 (`(17)`, `17`) che non sanno tradurre, applicano i limiti (1–40 caratteri, massimo 10 per brano) e riusano la grafia esistente a parità di chiave.

Generi di un album: aggiungere o togliere un genere a un album è un'operazione in blocco sui brani; i generi mostrati per l'album sono l'intersezione dei generi dei suoi brani, calcolata alla lettura.

*Alternativa*: generi memorizzati sull'album ed ereditati dai brani (due fonti di verità e regole di precedenza da spiegare).

### D5. Provider di ricerca in `packages/shared/src/lookup/`

Modulo puro con `fetch` iniettato, usato dal server e dal gateway:

- **MusicBrainz**: `release-group` cercato per titolo e artista dell'album; se manca l'album, `recording` per titolo e artista del brano, risalendo ai release-group. Copertina da Cover Art Archive (`/release-group/<mbid>/front-500`, anteprima `front-250`); anno dalla prima data di uscita; generi dai `tags`/`genres` del risultato con almeno un voto.
- **iTunes Search** (riserva, o per completare i risultati se MusicBrainz ne restituisce meno di 3): `entity=album` o `entity=song`; copertina da `artworkUrl100` portata a 600×600; genere da `primaryGenreName`.
- I candidati (`LookupCandidateDto`: `id`, `source`, `title`, `artist`, `year`, `genres`, `coverUrl`, `thumbUrl`, `score`) vengono uniti, deduplicati per chiave titolo+artista e ordinati per punteggio, massimo 10.
- **Limite di frequenza**: una coda per istanza che distanzia le chiamate a MusicBrainz di 1,1 s; User-Agent `Spookyfy/<versione> (<URL del progetto>)`. Timeout 8 s per richiesta.

Le immagini non vengono mai chieste dal browser ai servizi esterni: il client riceve URL del proprio backend (`/api/lookup/image?url=…`). Il proxy accetta solo `https` su un elenco di host (`coverartarchive.org`, `archive.org` e sottodomini, `*.mzstatic.com`), segue i redirect manualmente verificando l'host a ogni passo, accetta solo `image/*` fino a 10 MB. In questo modo né il server né il gateway possono essere usati per raggiungere indirizzi arbitrari.

*Alternative*: Deezer (nessuna CORS, termini meno chiari per il riuso delle immagini; aggiungibile in seguito come terzo provider); Discogs (richiede token); chiamate dirette dal browser (iTunes non è affidabile via CORS, MusicBrainz non permette di impostare lo User-Agent, e l'IP dell'utente verrebbe esposto ai servizi).

### D6. Corrispondenza sicura e ricerca automatica

`isConfidentMatch(album, candidate)`: chiavi uguali dopo una normalizzazione più aggressiva di D1, che toglie punteggiatura, "the" iniziale e diciture fra parentesi o dopo un trattino come `remaster(ed)`, `deluxe`, `edition`, `expanded`, `anniversary`, `bonus`, `version`. Si applica il primo candidato, in ordine di punteggio, che corrisponde.

Ogni album nasce con `lookup_status = pending` se non ha copertina assegnata. Un lavoratore in background (server: avviato da `IngestService.start()` come la coda dell'auto-trim; client: pianificato dai servizi alcuni secondi dopo l'apertura e a ogni nuovo album) prende gli album `pending` dal più recente, uno alla volta:

- risultato con corrispondenza sicura → scarica la copertina, la salva come assegnata (D3), imposta `done`;
- nessuna corrispondenza → `done` senza modifiche (mai più cercato in automatico);
- errore di rete o di servizio → resta `pending`; dopo 3 errori consecutivi il lavoratore si ferma fino al prossimo avvio.

L'automatico applica **solo la copertina**: titolo, artista, anno e generi si cambiano solo su scelta dell'utente.

### D7. API

On-premise (tutte autenticate):

| Rotta | Uso |
|---|---|
| `GET /api/albums?sort=added\|title\|artist` | elenco (`AlbumSummaryDto`) |
| `POST /api/albums` | creazione manuale |
| `GET` / `PATCH` / `DELETE /api/albums/:id` | dettaglio con brani e generi (`AlbumDto`), modifica, eliminazione |
| `POST /api/albums/:id/tracks` | aggiunta di brani (`trackIds`, posizione opzionale) |
| `DELETE /api/albums/:id/tracks/:trackId` | rimozione dall'album |
| `POST /api/albums/:id/tracks/:trackId/move` | riordino (come gli elementi delle playlist) |
| `PUT` / `DELETE /api/albums/:id/cover`, `GET …/cover` | copertina assegnata: caricamento, rimozione, lettura |
| `POST /api/albums/:id/genres` | `{ add?: string[], remove?: string[] }` su tutti i brani |
| `PUT /api/tracks/:id/genres` | generi di un brano |
| `GET /api/genres`, `GET /api/genres/:name` | elenco con conteggi, pagina del genere |
| `GET /api/lookup/albums?album=&artist=&title=` | candidati (D5) |
| `POST /api/albums/:id/apply-candidate` | applica copertina e campi scelti di un candidato |
| `GET /api/lookup/image?url=` | proxy delle immagini (D5) |
| `GET` / `PATCH /api/settings` | impostazioni del server (`coverLookup`) |

`POST /api/albums/:id/apply-candidate` riceve il candidato (non solo l'ID) e i campi da applicare; il server riscarica la copertina tramite lo stesso controllo degli host del proxy. Per un brano senza album il client prima crea o trova l'album (`POST /api/albums`) e vi aggiunge il brano, poi applica il candidato.

Impostazioni on-premise: tabella `app_settings` (chiave/valore); `coverLookup` modificabile da qualsiasi utente autenticato, come il catalogo condiviso. La variabile d'ambiente `COVER_LOOKUP=off` la forza spenta (per chi non vuole alcuna chiamata esterna dal server). Con la ricerca spenta le rotte `/api/lookup/*` rispondono 409 `lookup_disabled` e il lavoratore non parte.

Client: l'interfaccia di backend riceve i namespace `albums`, `genres`, `lookup` e `settings` con la stessa forma; `DeviceBackend` li implementa su `DeviceLibrary` e chiede candidati e immagini al gateway; l'interruttore vive nello store `settings` di IndexedDB.

Gateway: una funzione `api/lookup/[action].ts` (`albums`, `image`), riservata agli utenti autenticati, `maxDuration` 20 s; health con la funzionalità `cover-lookup`. Totale 7 funzioni su 12.

### D8. Interfaccia

- **Libreria**: i filtri diventano "Playlist", "Album", "Generi", "Scaricati". "Album" mostra una griglia di copertine (2 colonne su telefono, a riempimento su PC) con ordinamento; "Generi" un elenco di generi con numero di brani e un colore derivato dal nome.
- **Rotte**: `/album/:id` e `/genre/:name` (nome codificato), con la scheda Libreria attiva.
- **Pagina album**: `TrackCollection` con `kind="Album"`, copertina dell'album, riordino tramite trascinamento come nelle playlist, azioni "Modifica", "Copertina", "Generi", "Elimina album". Il pulsante "Copertina" apre un pannello: "Scegli dal dispositivo", "Cerca online" (griglia di candidati con caselle "applica anche titolo, artista, anno, generi"), "Rimuovi copertina".
- **Menu del brano**: "Aggiungi ad album…" (selettore con ricerca e "Nuovo album"), "Vai all'album", "Generi…", "Cerca album online" per i brani senza album. La finestra "Modifica informazioni" riceve il campo generi a chip con suggerimenti.
- **Cerca**: i risultati locali mostrano una riga "Album" sopra i brani.
- **Impostazioni**: interruttore "Cerca copertine online" con il testo sui dati inviati e i servizi usati.

### D9. Tag dei file on-premise

La riscrittura dei tag (TALB, TPE2, TRCK, TCON con generi separati da `; `) avviene in una piccola coda in background, non nella richiesta: spostare un brano in un album cambia il numero di traccia di tutti i brani successivi. Gli errori vengono registrati nel log e non annullano il catalogo. La copertina incorporata nel file (APIC) resta quella originale.

### D10. Migrazione dei dati esistenti

- **Server**: dopo le migrazioni SQL, un passo idempotente all'avvio raggruppa i brani con `album` non vuoto e `album_id` nullo (normalizzazione in JS, D1), con `origin = auto`. È segnato in `app_settings` (`albums_grouped = 1`) per non ripeterlo.
- **Client**: l'aggiornamento di IndexedDB alla versione 3 crea `libAlbums` e, nella stessa transazione, raggruppa i brani esistenti e imposta `genres: []`.
- **Backup**: campi opzionali `albums` (con `trackIds` ordinati, copertina come percorso nel ZIP) e `genres` sui brani; `BACKUP_VERSION` resta 1, così le versioni precedenti dell'app leggono il backup ignorando i campi nuovi. Un backup senza `albums` viene raggruppato come alla migrazione.

## Risks / Trade-offs

- [MusicBrainz limita a 1 richiesta/s per IP; il gateway ha più istanze che condividono IP AWS] → coda per istanza, poche richieste per ricerca (1–2), ricerca automatica sequenziale; in caso di 503 si passa a iTunes e l'album resta `pending`.
- [Corrispondenze sbagliate applicate in automatico] → solo con titolo e artista equivalenti, solo copertina, mai su album con copertina già assegnata; l'utente può rimuoverla o sceglierne un'altra.
- [Proxy di immagini usabile per SSRF] → elenco chiuso di host, solo https, redirect verificati a ogni passo, solo `image/*`, limite di dimensione; test dedicati.
- [Brani scaricati offline on-premise con la copertina vecchia nella cache] → la copertina dell'album entra nella cache al momento del download e quando cambia la copertina di un album con brani scaricati; in mancanza, segnaposto come oggi.
- [Copertine iTunes e Cover Art Archive hanno licenze diverse] → uso personale, immagini salvate solo nel catalogo dell'utente, sorgente indicata sul candidato.
- [Rinumerazione delle tracce con tanti brani] → posizioni frazionarie: il riordino scrive una sola riga nel catalogo; la riscrittura dei tag è asincrona.
- [Raggruppamento per testo esatto: "Nevermind" e "Nevermind (Remastered)" diventano due album] → voluto (edizioni diverse); l'utente può spostare i brani o correggere il campo album.

## Migration Plan

1. Server: migrazione `0004` e raggruppamento all'avvio (automatici). Con `COVER_LOOKUP=off` nessuna chiamata esterna.
2. Client: aggiornamento IndexedDB alla versione 3 al primo avvio della nuova PWA.
3. Gateway: nuova funzione e route in `vercel.json`; nessuna nuova variabile d'ambiente.
4. Rollback: le colonne e le tabelle nuove sono additive; una versione precedente del server le ignora. Una PWA precedente non apre un IndexedDB v3 (errore di versione): il rollback del client richiede di ripristinare un backup, come per ogni migrazione IndexedDB.

## Open Questions

- Se aggiungere Deezer come terzo provider dipende dalla copertura reale di MusicBrainz e iTunes sulle librerie degli utenti; si può decidere dopo, senza cambiare spec né interfacce.
