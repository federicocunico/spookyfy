# Proposal

## Why

Vogliamo un player musicale personale, completamente self-hosted, che su iPhone e Android si comporti come un'app nativa (audio in background, controlli in lockscreen, ascolto offline) senza passare da App Store, abbonamenti o servizi cloud di terzi. Il repository è vuoto: questa change costruisce l'MVP end-to-end (backend on-premise + PWA) su cui poi si appoggeranno lo Smart Storage Manager, le regole di eviction e i tag (vedi `openspec_spookyfy.md`).

## What Changes

- **Backend on-premise** (Node.js + TypeScript + SQLite), che serve sia l'API sia i file statici della PWA dalla stessa origine. Gira su hardware di ogni taglia: dal Raspberry Pi o mini-PC (requisito minimo supportato) fino a server più potenti, sfruttandone le risorse in più senza richiedere modifiche.
- **Login e registrazione in-app**: registrazione dall'app solo con un token di invito configurabile sul server (predefinito `spotifymerdacostosa2026`), username unici, password di almeno 8 caratteri con lettere, cifre e almeno un carattere speciale. Gestione account anche da riga di comando sul server. Sessione tramite cookie, protezione da brute force su login e token. Tutta l'API, compresi audio, copertine e WebSocket, richiede autenticazione.
- **Ingestione tramite `yt-dlp`**: ricerca su YouTube dall'app, download in coda sul server, conversione in MP3, scrittura dei tag ID3 (titolo, artista, copertina), estrazione del colore dominante della copertina, notifiche di avanzamento e completamento via WebSocket.
- **Streaming audio** con supporto HTTP Range (necessario per lo scrubbing e per `<audio>` su iOS) e servizio delle copertine.
- **Libreria musicale**: catalogo brani, ricerca locale, preferiti, playlist (crea/rinomina/elimina/aggiungi/rimuovi/riordina), storico ascolti per utente (registrato anche offline e sincronizzato dopo), base per le future regole di eviction.
- **PWA shell**: manifest installabile, Service Worker, Single Page Application con player persistente nel DOM radice, Bottom Tab Bar (Home, Cerca, La tua Libreria) con blur acrilico, design system "Spookyfy" (sfondo `#121212`, superfici `#181818`–`#282828`, accento Neon Orange `#FF5F1F`), zero layout shift.
- **Player audio**: singolo elemento `<audio>`, coda di riproduzione, shuffle/repeat, mini-player flottante (marquee, progress sottile), player a schermo intero (apertura con tap o swipe-up, sfondo sfumato dal colore della copertina, scrub bar ampia), integrazione MediaSession per lockscreen e cuffie, sblocco dell'audio solo su tap esplicito.
- **Storage offline**: toggle di download per brano, download di intere playlist con WakeLock attivo, richiesta di storage persistente all'avvio, ritorno trasparente allo streaming se l'OS ha eliminato la cache, download automatico offline dei brani appena ingeriti su richiesta del client.
- **Deploy**: istruzioni e file d'esempio per servizio systemd e Cloudflare Tunnel.

Fuori scope (change successive): grafico a ciambella dello Smart Storage Manager, regole di eviction automatiche configurabili, tag (`#focus`, `#workout`) e code generate da tag, upload di file locali, multi-tenant con librerie separate per utente.

## Capabilities

### New Capabilities

- `user-auth`: registrazione con token di invito, unicità dello username, requisiti della password, login, sessioni, logout, gestione account da CLI, protezione da brute force e CSRF.
- `media-ingestion`: ricerca remota su YouTube, coda di download sul server, conversione MP3, tag ID3, copertina e colore dominante, notifiche in tempo reale dei job.
- `audio-streaming`: distribuzione autenticata di file audio (con richieste Range) e copertine.
- `music-library`: catalogo brani, ricerca locale, preferiti, playlist, storico ascolti.
- `app-shell`: installabilità PWA, navigazione SPA, layout con tab bar, design system e regole di stabilità visiva.
- `audio-player`: riproduzione, coda, shuffle/repeat, mini-player, player a schermo intero, integrazione lockscreen/MediaSession.
- `offline-storage`: download locale di brani e playlist, persistenza dello storage, WakeLock durante i download massivi, fallback allo streaming quando la cache è stata eliminata.

### Modified Capabilities

Nessuna (progetto nuovo, non esistono spec).

## Impact

- **Codice**: nuovo monorepo con `apps/server` (API, job di ingestione, CLI), `apps/web` (PWA Svelte 5 + Vite) e `packages/shared` (tipi e schemi condivisi).
- **API**: nuova REST API sotto `/api/*` e un endpoint WebSocket `/api/ws`, tutti autenticati.
- **Dipendenze di sistema sul server**: Node.js 22 LTS, `yt-dlp`, `ffmpeg`, `cloudflared`.
- **Dati**: database SQLite e cartella media (MP3 + copertine) sul disco del server; serve un backup a carico dell'utente.
- **Rete**: nessuna porta aperta sul router; esposizione solo tramite Cloudflare Tunnel con TLS gestito da Cloudflare.
- **Legale/uso**: `yt-dlp` è usato a uso personale; il rispetto dei termini delle piattaforme sorgente resta responsabilità dell'utente.
