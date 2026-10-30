# Proposal

## Why

Spookyfy gestisce oggi musica importata e file offline, ma non permette di collegare un account Spotify e usarne libreria, playlist e riproduzione. Serve un'integrazione opzionale, isolata dai servizi esistenti, che conservi il valore della libreria personale anche quando Spotify cambia API, rifiuta l'accesso o non è raggiungibile.

## What Changes

- Linking OAuth Spotify esclusivamente da un account Spookyfy già creato e autenticato; nessun login o registrazione tramite Spotify. Disconnessione e ricollegamento nelle impostazioni.
- Modulo Spotify comune ai backend on-premise e gateway Vercel, con credenziali protette, contratti validati, timeout e gestione indipendente di errori, quote e riconnessione.
- Sezione Spotify per ricerca di brani/album/artisti/playlist, brani salvati, album e playlist accessibili; creazione, modifica e gestione playlist proprie tramite API. Ricerca locale e YouTube restano disponibili separatamente.
- Riproduzione Spotify tramite Web Playback SDK e comandi Spotify Connect, con controlli comuni e capacità dichiarate per ambiente. Avviso Premium dopo il linking quando verificabile; stato esplicito di verifica incerta quando Spotify non espone l'abbonamento.
- Playlist ibride Spookyfy con riferimenti ordinati a file locali e brani Spotify, senza scaricare audio Spotify, convertire Spotify in YouTube o caricare file personali su Spotify. Le playlist native Spotify restano una risorsa distinta.
- Estensioni additive a SQLite, IndexedDB e backup, con isolamento per account dei dati Spotify. Nessuna migrazione dei file locali al provider esterno.
- Implementazione e verifiche con provider e SDK finti; configurazione reale, OAuth personale e prove con l'account del proprietario soltanto nell'ultima fase.

### Vincoli di fattibilità e rilascio

La [Developer Policy, § III.5, III.7 e III.11](https://developer.spotify.com/policy) limita integrazioni con altri servizi, transizioni/mix audio e repliche dell'esperienza Spotify. La fattibilità tecnica non dimostra che il wrapper richiesto sia ammesso: wrapper integrato e funzioni ibride sono progettati e verificati in ambiente simulato, ma restano disattivati nel rilascio reale fino a un chiarimento/autorizzazione applicabile di Spotify. Anche il linking in questa applicazione va rivalutato nel contesto complessivo prima dell'attivazione. Questa è una dipendenza esterna, non una promessa di compatibilità ottenibile con un flag.

La base API segue la documentazione disponibile al 29 ottobre 2026: [migrazione Development Mode](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [identità stabile di maggio](https://developer.spotify.com/documentation/web-api/references/changes/may-2026), [quote di luglio](https://developer.spotify.com/documentation/web-api/references/changes/july-2026). Premium serve per lo streaming; non tutte le API hanno lo stesso requisito. Visibilità delle playlist e disponibilità delle funzioni dipendono anche da scope, modalità dell'app e dispositivi.

## Capabilities

### New Capabilities

- `music-provider-isolation`: identità e capacità delle sorgenti, composizione opzionale, degradazione e conservazione del comportamento locale.
- `spotify-account-linking`: OAuth successivo alla registrazione, associazione stabile, custodia dei token, stato Premium e disconnessione.
- `spotify-library`: ricerca Spotify, consultazione della libreria e gestione esplicita delle playlist native tramite API.
- `spotify-playback`: streaming ufficiale, controllo dispositivi, trasporto, limiti del browser e recupero dai guasti.
- `hybrid-playlists`: collezioni Spookyfy multisorgente, ordine/duplicati, persistenza, backup e riproduzione condizionata.

### Modified Capabilities

Nessuna spec principale esiste attualmente (`openspec list --specs`: elenco vuoto). Le nuove capacità estendono i comportamenti descritti nelle change `add-spookyfy-mvp`, `add-client-mode` e `add-albums-and-genres` senza modificare i loro artefatti. Il design esplicita i limiti Spotify rispetto a offline, continuità in background, statistiche e UI dei brani locali.

## Impact

Coinvolti `packages/shared`, un nuovo package backend `packages/spotify`, registrazione rotte/configurazione/auth e migrazioni di `apps/server`, handler/KV/dev-server/configurazione di `apps/gateway`, servizi/player/ricerca/playlist/impostazioni/storage/backup di `apps/web`, test ed E2E, documentazione e build del workspace. Il gateway mantiene il budget di 12 funzioni serverless. Le API locali e i vecchi backup restano compatibili; i riferimenti remoti usano nuove API/tipi espliciti. Sono esclusi download Spotify, podcast/audiolibri, raccomandazioni, audio analysis, replica completa del catalogo e sincronizzazione automatica bidirezionale delle playlist.
