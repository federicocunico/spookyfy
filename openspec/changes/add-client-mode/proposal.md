# Proposal

## Why

La modalità attuale di Spookyfy (vedi change `add-spookyfy-mvp`) richiede un server sempre acceso con spazio disco, yt-dlp e un tunnel. Serve una seconda modalità a costo zero e senza infrastruttura da gestire: il backend gira su Vercel (piano Hobby, massimo 12 serverless functions) e fa solo da autenticatore e da tramite senza stato verso YouTube, mentre il telefono su cui è installata la PWA scarica, conserva e gestisce tutto (libreria, playlist, preferiti, ascolti, file audio).

**Fattibilità (verificata).** La modalità è realizzabile, con un rischio principale e alcuni vincoli tecnici:

- **Rischio principale: YouTube blocca spesso gli IP dei datacenter** (Vercel gira su AWS). Il messaggio "Sign in to confirm you're not a bot" colpisce in modo sistematico gli IP cloud e, secondo le fonti del 2026, i PO token non bastano più ad aggirarlo. L'importazione da YouTube in questa modalità è quindi **best-effort**: la change aggiunge due alternative affidabili, l'importazione di file audio presenti sul telefono e un "ponte" opzionale verso un server on-premise (IP domestico).
- Gli URL dei flussi audio di YouTube sono firmati per l'IP che li ha ottenuti: il telefono non può scaricarli direttamente da un URL risolto su Vercel. Una funzione Vercel deve fare da proxy dei byte.
- Le risposte delle funzioni Vercel hanno un limite di 4,5 MB, che **non vale per le risposte in streaming**; la durata massima su Hobby è 300 s. Un brano (4–10 MB, massimo 20 minuti) passa in streaming entro questi limiti.
- Su Vercel non c'è ffmpeg: si usa direttamente il formato audio AAC/M4A già fornito da YouTube, riproducibile nativamente da iOS e Android, senza conversione né tag ID3.
- Un'autenticazione con registrazione e unicità degli username richiede un minimo di memoria: si usa un KV gratuito (Redis Upstash dal marketplace di Vercel) **solo** per account e contatori anti-brute-force. Nessun dato musicale o personale d'ascolto vive sul server.
- Su iOS lo storage di una PWA può essere eliminato dal sistema: in questa modalità significherebbe perdere la libreria. Mitigazioni: storage persistente (già presente), avviso esplicito ed export/import della libreria su file.

## What Changes

- **Due modalità di backend, una sola PWA.** Il backend dichiara la propria modalità (`onpremise` o `client`) e le funzionalità disponibili; la PWA si adatta a runtime, senza build separate.
- **Nuovo pacchetto `apps/gateway`** per Vercel: funzioni stateless per stato del servizio, autenticazione, ricerca su YouTube, metadati di un video, proxy audio in streaming, proxy delle copertine. Budget dichiarato e verificato in CI: al massimo 12 funzioni (ne servono 6). La PWA viene servita come file statici dallo stesso progetto Vercel.
- **Account sul gateway** con le stesse regole dell'on-premise (registrazione con token di invito, username unici case-insensitive, password ≥ 8 con lettera, cifra e carattere speciale, sessioni da 30 giorni con rinnovo, limite ai tentativi), con sessione firmata senza stato in un cookie e account e contatori in un KV minimo. Gestione account da CLI verso il KV.
- **Libreria sul dispositivo** (modalità client): catalogo, metadati, copertine, file audio, preferiti, playlist, coda e storico ascolti salvati solo sul telefono; ricerca locale; eliminazione dei brani; visualizzazione dello spazio occupato.
- **Importazione sul dispositivo** da tre sorgenti: YouTube tramite il gateway (con avanzamento e riproduzione immediata), file audio scelti dal telefono, server on-premise configurato come ponte.
- **Backup**: esportazione della libreria in un file (con o senza audio) e importazione su questo o un altro dispositivo.
- **Server on-premise**: risposta di stato con la modalità; nuovi **token di accesso personali** e CORS limitato alle origini autorizzate, per permettere a un'app in modalità client di usare il server come ponte d'importazione. **BREAKING (solo comportamento interno)**: le richieste che usano un token d'accesso sono esentate dal controllo `Origin` riservato alle sessioni via cookie.

Fuori scope: sincronizzazione automatica fra dispositivi, condivisione della libreria fra account in modalità client, upload dei file audio sul cloud, piani Vercel a pagamento, modalità ibrida automatica (passaggio da una modalità all'altra della stessa installazione).

## Capabilities

### New Capabilities

- `deployment-modes`: dichiarazione della modalità del backend, adattamento della PWA, applicabilità dei requisiti per modalità.
- `cloud-gateway`: funzioni serverless stateless su Vercel: budget di funzioni, autenticazione con KV minimo, ricerca, metadati, proxy audio e copertine, assenza di dati musicali sul server.
- `device-library`: libreria completamente sul dispositivo: catalogo, file audio, preferiti, playlist, ascolti, ricerca, spazio occupato, rischio di eliminazione da parte del sistema.
- `device-ingestion`: importazione di brani sul dispositivo da YouTube (via gateway), da file locali e tramite ponte on-premise.
- `library-backup`: esportazione e importazione della libreria del dispositivo.
- `onpremise-bridge`: token di accesso personali e CORS sul server on-premise per l'uso come ponte d'importazione.

### Modified Capabilities

- `user-auth`: il controllo dell'header `Origin` vale per le richieste autenticate con cookie di sessione; le richieste con token di accesso personale ne sono esentate. Le risorse private accettano anche il token di accesso.

## Impact

- **Prerequisito**: la change `add-spookyfy-mvp` va archiviata prima di questa, così le sue spec diventano le spec principali modificate qui (`user-auth`).
- **Codice**: nuovo `apps/gateway` (funzioni Vercel, CLI account su KV); in `apps/web` un livello di astrazione del backend con due implementazioni (remota on-premise e locale sul dispositivo), nuove viste per importazione da file, backup e configurazione del ponte; in `apps/server` token d'accesso, CORS e modalità nella health check; in `packages/shared` schemi e tipi per gateway e backup.
- **Dipendenze nuove**: `youtubei.js` (client Innertube in JavaScript, senza binari) per ricerca, metadati e flussi audio sul gateway; client Redis REST di Upstash; libreria JWT; lettore di tag audio lato client (o parser minimo) per l'importazione da file.
- **Servizi esterni**: progetto Vercel (Hobby), database Redis gratuito (Redis Cloud Free dal Marketplace Vercel, o Upstash), variabili d'ambiente per segreto di sessione, token di invito e credenziali KV.
- **Costi e limiti**: traffico audio contato nel trasferimento dati incluso nel piano Hobby (uso personale, non commerciale); durata massima 300 s per richiesta.
- **Legale/uso**: come per l'on-premise, l'uso di contenuti di YouTube resta responsabilità dell'utente; in modalità client il proxy avviene sull'account Vercel dell'utente.
