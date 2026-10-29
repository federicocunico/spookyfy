# Tasks

## 1. Fondamenta condivise (`packages/shared`)

- [x] 1.1 Aggiungere `albumKey` (normalizzazione di D1) e `normalizeGenres` (divisione di valori multipli, codici numerici ID3 scartati, 1–40 caratteri, massimo 10, grafia esistente riusata); verificare con unit test su accenti, maiuscole, spazi, "Alternative; Indie", `(17)` e il caso "hip-hop" → "Hip-Hop"
- [x] 1.2 Aggiungere a `TrackDto` i campi `albumId` e `genres`, i DTO `AlbumSummaryDto`, `AlbumDto`, `GenreDto`, `LookupCandidateDto` e gli schemi zod dei corpi (album: titolo 1–200, anno 1000–2100; generi; `apply-candidate`; impostazioni `coverLookup`); verificare con unit test di validazione e con `pnpm typecheck` su tutto il monorepo
- [x] 1.3 Implementare in `src/lookup/` i provider MusicBrainz (release-group e recording, Cover Art Archive) e iTunes Search con `fetch` iniettato, unione, deduplicazione, ordinamento e massimo 10 candidati; verificare con unit test su risposte JSON registrate in fixture (album, brano senza album, risultato vuoto, errore 503 con ripiego su iTunes)
- [x] 1.4 Implementare la coda di frequenza (MusicBrainz a 1,1 s, User-Agent, timeout 8 s) e `isConfidentMatch` (diciture "Remastered", "Deluxe", ecc., "the" iniziale, punteggiatura); verificare con unit test a timer finti che 5 richieste ravvicinate siano distanziate e con una tabella di coppie album/candidato attese vere e false
- [x] 1.5 Implementare `fetchCoverImage(url)` con elenco chiuso di host, solo https, redirect verificati a ogni passo, solo `image/*`, limite di 10 MB; verificare con unit test su host non consentito, redirect verso host non consentito, tipo non immagine e immagine troppo grande
- [x] 1.6 Estendere lo schema del backup v1 con `albums` opzionale (titolo, artista, anno, origine, stato della ricerca, copertina nel ZIP, colore, `trackIds` ordinati) e `genres` opzionale sui brani, senza cambiare `BACKUP_VERSION`; verificare con unit test che un backup senza i campi nuovi resti valido e che uno con i campi nuovi venga letto

## 2. Server: album e generi nel catalogo (`album-catalog`, `genre-tags`)

- [x] 2.1 Aggiungere a `schema.ts` le tabelle `albums`, `genres`, `track_genres`, `app_settings` e le colonne `tracks.album_id` e `tracks.album_position`; generare la migrazione e rinominarla `drizzle/0004_albums_genres.sql` aggiornando `_journal`; verificare con il test delle migrazioni su un database con brani esistenti
- [x] 2.2 Implementare `findOrCreateAlbum` e `setTrackAlbum` (D2: allineamento di `album`, eliminazione degli album `auto` vuoti, unicità con importazioni concorrenti); verificare con unit test su creazione, spostamento fra album, rimozione, album automatico svuotato e album manuale svuotato
- [x] 2.3 Collegare l'importazione: album e artista dell'album dai metadati di yt-dlp, numero di traccia se presente, `lookup_status = pending`; verificare con test d'integrazione che due importazioni dello stesso disco producano un solo album e che un brano senza album non ne abbia
- [x] 2.4 Far passare `PATCH /api/tracks/:id` con il campo album per `setTrackAlbum`; verificare con test d'integrazione che "Nevermind (Remastered)" → "Nevermind" sposti il brano e che un campo vuoto lo tolga dall'album
- [x] 2.5 Implementare il raggruppamento idempotente all'avvio segnato in `app_settings`; verificare con test su un database con 3 brani di "OK Computer" e una playlist, eseguendo l'avvio due volte (un solo album, playlist invariate)
- [x] 2.6 Aggiungere `albumId`, `genres` e la copertina dell'album a `toTrackDto` (D3) e le rotte album di D7 (elenco ordinabile, dettaglio, creazione, modifica, eliminazione, aggiunta, rimozione, riordino); verificare con test d'integrazione che coprono gli scenari di `album-catalog`, compresi gli errori di validazione e un utente diverso che vede lo stesso album
- [x] 2.7 Aggiungere le rotte della copertina dell'album (`PUT` binario fino a 10 MB con `processCover`, `DELETE`, `GET` con `v=`), con file `covers/albums/<id>-<size>.jpg` eliminati insieme all'album; verificare con test che i brani dell'album espongano la nuova copertina e il nuovo colore e tornino alla propria dopo la rimozione o l'uscita dall'album, e che un PDF venga rifiutato
- [x] 2.8 Aggiungere i generi (`PUT /api/tracks/:id/genres`, `POST /api/albums/:id/genres`, `GET /api/genres`, `GET /api/genres/:name`) con eliminazione dei generi non più usati; verificare con test d'integrazione sugli scenari di `genre-tags` (grafia canonica, genere su tutto l'album, intersezione per l'album, genere sparito)
- [x] 2.9 Estendere la ricerca locale del server agli album (titolo, artista) e ai generi dei brani; verificare con test che "nevermi" restituisca l'album e "shoeg" il brano con genere "Shoegaze"
- [x] 2.10 Aggiungere la coda di riscrittura dei tag (TALB, TPE2, TRCK, TCON) in background con errori solo nel log; verificare con test che leggono i tag del file dopo lo spostamento in seconda posizione e che un errore di scrittura non annulli il catalogo

## 3. Server: ricerca online (`cover-lookup`)

- [x] 3.1 Aggiungere `GET/PATCH /api/settings` con `coverLookup` e la variabile `COVER_LOOKUP=off` che la forza spenta; verificare con test che con la ricerca spenta `/api/lookup/*` risponda 409 `lookup_disabled` e che il valore valga per tutti gli account
- [x] 3.2 Aggiungere `GET /api/lookup/albums`, `GET /api/lookup/image` e `POST /api/albums/:id/apply-candidate` (solo copertina o anche campi scelti, download tramite `fetchCoverImage`); verificare con test d'integrazione con `fetch` simulato: candidati ordinati, sola copertina applicata lasciando invariati gli altri campi, host non consentito rifiutato, errore di rete con messaggio
- [x] 3.3 Implementare il lavoratore della ricerca automatica (D6) avviato e fermato da `IngestService`: dal più recente, solo copertina con corrispondenza sicura, `done` senza corrispondenza, stop dopo 3 errori consecutivi, nessuna attività con la ricerca spenta; verificare con test sugli scenari "Corrispondenza sicura", "Nessuna corrispondenza sicura" e "Servizio irraggiungibile"
- [x] 3.4 Rendere configurabili gli URL di base dei provider (`LOOKUP_MUSICBRAINZ_URL`, `LOOKUP_ITUNES_URL`, `LOOKUP_IMAGE_HOSTS`) per i test end-to-end e documentare in `docs/guida.md` la ricerca online, i dati inviati, `COVER_LOOKUP=off` e le variabili; verificare con un test di configurazione e rileggendo la guida

## 4. Gateway (`cloud-gateway`)

- [x] 4.1 Aggiungere `api/lookup/[action].ts` (`albums`, `image`) riservata agli utenti autenticati, con `maxDuration` 20 s, voce in `vercel.json` e funzionalità `cover-lookup` nella health; verificare con test degli handler (401 senza sessione, candidati con `fetch` simulato, host non consentito rifiutato senza richiesta in uscita) e con `count-functions` che riporta 7 su 12
- [x] 4.2 Supportare gli stessi URL di base configurabili nel dev-server del gateway; verificare avviando il dev-server con un provider finto e chiamando la funzione

## 5. Libreria del dispositivo (modalità client)

- [x] 5.1 Aggiungere la migrazione IndexedDB 3 (`libAlbums` con indice unico di chiave, `albumId`, `albumPosition`, `genres` sui brani) con raggruppamento dei brani esistenti nella stessa transazione; verificare con unit test che aprono un database v2 popolato e controllano album e brani dopo l'aggiornamento
- [x] 5.2 Implementare in `DeviceLibrary` album (`findOrCreateAlbum`, `setTrackAlbum`, elenco, dettaglio, creazione, modifica, eliminazione, aggiunta, rimozione, riordino), generi (indice in memoria, brano, album, elenco, pagina) e ricerca estesa ad album e generi; verificare con unit test che replicano gli scenari di `album-catalog` e `genre-tags` usati per il server
- [x] 5.3 Salvare le copertine assegnate in `spk-device-covers-v1` sotto `/local/album-cover/<id>?size=&v=` elaborate con `processCover`, ed esporle sui brani in `toDto`; verificare con unit test su copertina assegnata, rimozione, brano tolto dall'album e file non immagine rifiutato, e con un test del Service Worker che serve la nuova rotta
- [x] 5.4 Leggere nell'importazione da file genere, numero di traccia e artista dell'album (music-metadata) e passarli alla libreria; verificare con unit test su un MP3 con "Alternative; Indie" e numeri di traccia importati in ordine inverso
- [x] 5.5 Aggiungere a `DeviceBackend` i namespace `albums`, `genres`, `lookup` (verso il gateway) e `settings` (interruttore in IndexedDB) con la stessa forma di `api.ts`; verificare con `pnpm typecheck` e con unit test che con l'interruttore spento non parta alcuna richiesta al gateway
- [x] 5.6 Pianificare nei servizi il lavoratore della ricerca automatica (alcuni secondi dopo l'apertura e a ogni nuovo album, stop dopo 3 errori, fermato all'uscita) e aggiornare i brani in coda nel player quando cambia la copertina; verificare con unit test a timer finti
- [x] 5.7 Esportare e ripristinare album, copertine assegnate e generi nel backup, con unione senza duplicati e raggruppamento dei backup vecchi; verificare con test di backup su "Ripristino con album", "Album già presente" e "Backup vecchio"

## 6. Interfaccia (`apps/web`)

- [x] 6.1 Aggiungere a `api.ts` (on-premise) i namespace `albums`, `genres`, `lookup` e `settings` e allo store `Library` lo stato di album e generi con aggiornamento dopo le modifiche; verificare con unit test dello store con backend finto
- [x] 6.2 Aggiungere le rotte `/album/:id` e `/genre/:name` al router con la scheda Libreria attiva, e i filtri "Album" e "Generi" in `LibraryView` (griglia di album ordinabile, elenco dei generi con conteggi, stati vuoti con spiegazione); verificare con test di componente e del router
- [x] 6.3 Creare `AlbumView` (`TrackCollection` con `kind="Album"`, riproduzione, casuale, riordino, durata totale, anno, generi) e `GenreView` (brani e album del genere, riproduzione e casuale); verificare con test di componente
- [x] 6.4 Creare le finestre di modifica dell'album (titolo, artista, anno, generi a chip con suggerimenti) e di scelta della copertina (dal dispositivo, ricerca online con caselle per i campi da applicare, rimozione, errori e assenza di connessione); verificare con test di componente sugli scenari "Solo copertina", "Senza connessione" e "File non valido"
- [x] 6.5 Estendere `TrackMenu` ("Aggiungi ad album…" con ricerca e "Nuovo album", "Vai all'album", "Generi…", "Cerca album online" per i brani senza album) e la finestra "Modifica informazioni" con il campo generi; verificare con test di componente
- [x] 6.6 Mostrare gli album fra i risultati locali di Cerca e l'interruttore "Cerca copertine online" con spiegazione nelle Impostazioni (nascondendo le azioni di ricerca quando è spento); verificare con test di componente
- [x] 6.7 Mettere in cache la copertina dell'album per i brani scaricati on-premise, anche quando cambia; verificare con un unit test dello store dei download
- [x] 6.8 Aggiornare `README.md` (funzionalità) e `docs/guida.md` (sezione "Album e generi": raggruppamento, copertine, ricerca online, privacy); verificare rileggendo che ogni azione descritta esista nell'interfaccia

## 7. Verifica end-to-end

- [x] 7.1 Aggiungere agli e2e un finto MusicBrainz/Cover Art Archive/iTunes (piccolo server locale) collegato a server e dev-server del gateway tramite gli URL di base; verificare che i test esistenti passino invariati
- [x] 7.2 Scrivere l'e2e on-premise: due brani dello stesso album raggruppati, copertina applicata automaticamente e visibile nel player, riordino, genere sull'album e ascolto per genere; verificare che passi su Chromium e WebKit
- [x] 7.3 Scrivere l'e2e in modalità client: importazione di file con album, genere e numero di traccia, scelta della copertina da un candidato, backup e ripristino con album e generi; verificare che passi su Chromium e WebKit
- [ ] 7.4 Eseguire lint, typecheck, test di tutti i pacchetti ed e2e completi, rigenerare gli screenshot del README se la Libreria è cambiata e verificare che la CI su `main` sia verde

## Workflow follow-up

- Archiviare prima `add-spookyfy-mvp` e `add-client-mode`, che creano le spec `library-backup` e `cloud-gateway` estese da questa change.
- Archiviare questa change dopo la revisione e verificare le spec risultanti in `openspec/specs/`.
