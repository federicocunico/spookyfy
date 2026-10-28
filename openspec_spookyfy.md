# OpenSpec: Progetto "Spookyfy" (Self-Hosted PWA Music Player)

**Obiettivo:** Realizzare una Progressive Web App (PWA) musicale offline-first, esteticamente indistinguibile da un'app nativa, appoggiata a un backend 100% on-premise esposto tramite tunnel sicuro.

## 1. Architettura di Sistema
L'infrastruttura si basa su un paradigma decentralizzato dove il server domestico fa da sorgente "truth" e i dispositivi client fungono da nodi di caching intelligenti.

* **Backend (On-Premise):** 
  * Stack leggero (es. Node.js + Express o Go) in esecuzione su Raspberry Pi o mini-PC.
  * Ingestione tramite `yt-dlp` per la risoluzione e il download dei flussi audio.
  * Database (SQLite/PostgreSQL) per metadati, tag, playlist e statistiche di ascolto.
* **Networking:** Cloudflare Tunnels (Zero Trust) per esporre il backend su un dominio personalizzato con certificati SSL/TLS automatici, senza aprire porte sul router domestico.
* **Frontend (Client):** PWA sviluppata in React, Svelte o Vue.js, ottimizzata per schermi mobile, installabile tramite "Aggiungi a schermata Home".

---

## 2. Gestione Limitazioni PWA (Focus iOS & Android)
Le PWA su iOS presentano vincoli stringenti che l'architettura deve mitigare nativamente:

* **Background Audio & Lockscreen:** Uso esclusivo del tag HTML5 `<audio>`. Integrazione della **MediaSession API** per passare metadati (titolo, artista, copertina) e agganciare gli handler fisici (play/pausa/skip) nella lockscreen. La primissima interazione (play) deve essere un *tap* esplicito dell'utente per sbloccare l'engine audio di WebKit.
* **Persistenza dei Dati (Storage Eviction):** iOS tende a svuotare il `CacheStorage` delle PWA se il dispositivo è a corto di spazio. 
  * *Mitigazione:* Implementare `navigator.storage.persist()` all'avvio. Se i dati vengono comunque eliminati dall'OS, l'app degraderà in modo trasparente ritornando allo streaming dal backend on-premise al successivo ascolto.
* **Limiti di Download in Background:** Su iOS, lo scaricamento di un'intera playlist si interrompe se lo schermo si spegne. 
  * *Soluzione:* Implementare la **WakeLock API** per mantenere lo schermo acceso, con luminosità minima, durante i "Bulk Download" espliciti.
* **Navigazione Fluida (SPA):** Per simulare l'app nativa e non interrompere la riproduzione musicale cambiando pagina, l'app deve essere una Single Page Application. Il player audio vive nel DOM principale, mentre le viste (Ricerca, Libreria) vengono scambiate virtualmente.

---

## 3. Design System e UI/UX (Stile Spookyfy)
L'interfaccia deve comunicare un senso di reattività immediata (zero layout shift) e profondità visiva.

* **Tema e Palette:** 
  * Sfondo: `#121212` (OLED Black) per risparmio energetico e look premium.
  * Superfici in elevazione (card, player): `#181818` a `#282828`.
  * Accento: Un colore tematico per "Spookyfy" (es. Neon Orange `#FF5F1F` o Eerie Purple `#9D00FF`) per toggle, bottoni Play e focus state.
* **Navigazione:** Bottom Tab Bar fissa (Home, Cerca, La tua Libreria) con blur acrilico in background (CSS `backdrop-filter: blur(10px)`).
* **Mini-Player (Stato Minimizzato):** Barra flottante posizionata appena sopra la Bottom Tab Bar. Mostra copertina in miniatura, titolo a scorrimento (marquee), pulsante play/pausa e barra di progresso sottilissima alla base.
* **Full-Screen Player:** Si attiva con un tap o swipe-up sul mini-player.
  * Copertina gigante con ombreggiatura morbida.
  * Sfondo che estrae i colori predominanti della copertina applicando un gradiente sfocato.
  * Controlli completi: Scrub bar spessa e facile da toccare, Shuffle, Repeat, e un toggle rapido a forma di nuvola/spunta per il **Download in locale**.

---

## 4. Gestione Memoria e Libreria (Core Features)
Il vantaggio di avere il controllo totale è la gestione granulare dello spazio sul dispositivo.

* **Smart Storage Manager:** Una schermata dedicata nelle impostazioni che visualizza un grafico a ciambella dello spazio occupato ("Usato da Spookyfy" vs "Spazio Libero iOS").
* **Regole di Eviction Personalizzate:** L'utente può impostare routine di pulizia automatica (es. "Rimuovi i download dei brani non ascoltati negli ultimi 30 giorni", mantenendo però i brani nei preferiti).
* **Tagging e Organizzazione:** Oltre alle classiche playlist, supporto per i "Tag" (es. `#focus`, `#workout`). Cliccando un tag, si genera dinamicamente una coda di riproduzione filtrata.
* **Sincronizzazione Ibrida:** Quando un brano viene cercato (es. su YouTube) tramite l'app, il comando viene inviato al backend. Il backend scarica l'MP3, applica i tag ID3 (titolo, autore, thumbnail) e notifica via WebSocket il frontend, che può iniziare lo streaming istantaneo e contemporaneamente salvare il chunk in `CacheStorage` per l'ascolto offline.