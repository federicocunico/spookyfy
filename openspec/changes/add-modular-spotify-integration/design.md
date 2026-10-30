# Design

## Context

Motivazione e perimetro: [proposal.md](proposal.md). Rilevazioni dal repository al 29 ottobre 2026:

| Area | Stato osservato e conseguenza |
|---|---|
| Composizione | `apps/web/src/lib/services.svelte.ts` compone backend on-premise e client. Il ramo client imposta il player come offline per consentire soltanto file disponibili: Spotify non può ereditare quel controllo. |
| Contratti | `TrackDto` in `packages/shared/src/library.ts` presuppone file, dimensione, URL audio, statistiche e album locali. Non rappresenta un brano Spotify. |
| Player | `player.svelte.ts` usa un singolo `<audio>` persistente, trim, coda e `PlayReporter`. `App.svelte` monta l'audio una sola volta: preservare questo percorso sincrono per iOS. |
| Server | Fastify, SQLite/Drizzle, sessioni cookie e token bridge limitati alle rotte ammesse. `playlist_items.track_id` è una FK obbligatoria verso file del catalogo condiviso. |
| Gateway | Sessioni JWT e account in Redis/Upstash. `Kv` offre SET NX ma non consume/CAS atomici. Attualmente 7 funzioni serverless su 12, con controllo CI esplicito. |
| Dispositivo | IndexedDB v3, playlist con soli `trackId`, cache audio e backup v1. Le librerie di file sono del dispositivo; non introdurre lì dati personali Spotify non isolati per utente. |
| Trasporto web | Il client API comune aggiorna lo stato di connessione e invalida la sessione su 401. I 401 Spotify non possono attraversare questo percorso come errori di autenticazione Spookyfy. |
| Specifiche | Nessuna main spec; tre change precedenti descrivono il comportamento implementato. Non archiviarle né riscriverle incidentalmente. |

## Goals / Non-Goals

**Goals:** isolare identità, credenziali, errori e media; condividere il codice Spotify fra i due backend; migrazioni additive; test completi senza account reale; contratti piccoli adatti a implementazione delegata.

**Non-Goals:** uniformare ogni backend in un framework di plugin, modificare l'autenticazione Spookyfy, trasferire la libreria personale nel cloud, ottenere permessi Spotify tramite una scelta tecnica. Le limitazioni di rilascio nella proposta restano dipendenze esplicite.

## Decisions

### D1. Contratti browser separati dal package Spotify backend

In `packages/shared/src/providers.ts`: union discriminata `MediaRef = { provider: 'local', trackId } | { provider: 'spotify', uri }`, DTO remoti, disponibilità, errori e schemi delle nuove API. Chiavi canoniche per coda e mappe includono il provider; l'identità di ogni occorrenza resta distinta dall'identità del brano.

`SpotifyTrackDto` espone URI, titolo, artisti, album, durata, immagini, URL Spotify e disponibilità; non espone `audioUrl`, dimensione file, trim, albumId locale, `playCount` o tag modificabili. `LocalPlayable` avvolge `TrackDto` senza cambiarne il contratto. Le capacità separano `canBrowse`, `canEditLibrary`, `canEditPlaylist`, `canStream`, `canDownload`, `canEditTags`.

Nuovo `packages/spotify` (`@spookyfy/spotify`), importato solo da server/gateway: OAuth, validazione risposte, endpoint tipizzati, cifratura, rinnovo e classificazione errori. Dipendenze iniettate: `fetch`, clock, store, crypto e configurazione. Nessun SDK Spotify Node non verificato: il REST adapter piccolo rende espliciti gli endpoint correnti. Browser: solo `apps/web/src/lib/spotify/*`, caricato dinamicamente. Aggiornare gli script che oggi compilano solo shared affinché le dipendenze workspace siano compilate in ordine anche nel build Vercel.

Alternativa scartata: rendere facoltativi i campi di `TrackDto` e infilare Spotify nelle tabelle `tracks`; allargherebbe invarianti di download, bridge, catalogo e player a tutta l'app.

### D2. Configurazione opzionale e limiti di rilascio

Config del modulo separata dalla validazione obbligatoria del server/gateway: `SPOTIFY_ENABLED=false`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI`, chiavi di cifratura con identificatore/versione e flag separato `SPOTIFY_HYBRID_PLAYBACK_ENABLED=false`. PKCE non richiede di distribuire un client secret. Configurazione mancante/invalida produce `disabled`/`misconfigured` del solo modulo; nessun arresto delle funzioni base. Anche l'endpoint di stato funziona senza contattare Spotify.

Il provider finto è ammesso esclusivamente in test/dev espliciti; non è un fallback silenzioso in produzione. L'attivazione reale resta successiva alla risoluzione del vincolo della [Developer Policy](https://developer.spotify.com/policy) segnalato nella proposta. Nessun flag sostituisce quella risoluzione. Non effettuare OAuth personale o creare/configurare l'app del proprietario durante lo sviluppo.

### D3. OAuth PKCE mediato dal backend, dopo il login locale

Usare [Authorization Code con PKCE S256](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow). Flusso:

1. `POST /api/spotify/link` richiede cookie di sessione Spookyfy vivo e Origin valido; i token bridge non bastano. Genera `state` casuale e verifier; pending server-side di 10 minuti con hash di state, identità utente, impronta della sessione iniziatrice, verifier protetto, redirect esatto, scope e generazione del collegamento.
2. Il backend restituisce l'URL di autorizzazione; il browser naviga a Spotify. URL di ritorno all'app fisso, senza redirect arbitrari.
3. `GET /api/spotify/callback` resta una rotta autenticata via cookie SameSite=Lax. La callback esterna GET non richiede Origin; ciò non comporta eccezioni globali ai controlli sulle mutazioni. Verifica utente e stessa sessione, consuma atomicamente pending, poi scambia il codice. Stato errato/scaduto/riusato o sessione cambiata: nessuna associazione.
4. Legge `GET /me`, verifica `account_id`, poi salva in modo atomico il collegamento e l'indice inverso; conflitto con un altro utente: errore generico. Mancanza di `account_id`: contratto incompatibile, nessuna deduzione da email o `id`. L'uso del campo stabile è esplicitamente raccomandato dalla [reference profilo](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile).
5. Redirect 303 a impostazioni con un codice esito non sensibile; niente token nell'URL. Rifiuto, errore o nuova autorizzazione incompleta conservano il link precedente. Ricollegare un account diverso richiede prima lo scollegamento esplicito del precedente; un rinnovo scope deve confermare la medesima identità.

Il redirect deve rispettare i [requisiti Spotify](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri): HTTPS, eccezione HTTP per IP loopback esplicito, mai `localhost`, corrispondenza con dashboard. In sviluppo usare `127.0.0.1` anche per l'origine dell'app e per i cookie; niente preview domain dinamici accettati automaticamente.

Alternativa: PKCE nel browser con refresh token persistente. Scartata per protezione credenziali, multi-device e requisito di associazione a un account locale.

### D4. Scope incrementali, stato Premium ed entitlements separati

Scope secondo la [reference ufficiale](https://developer.spotify.com/documentation/web-api/concepts/scopes): linking/profilo `user-read-private`; consultazione `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`; scrittura su scelta dell'utente `playlist-modify-private`, `playlist-modify-public`, `user-library-modify`; playback `streaming`, `user-read-playback-state`, `user-modify-playback-state`, con `user-read-currently-playing` soltanto per API che lo richiedono. Non richiedere history, top, follow o upload immagini. Verificare gli eventuali requisiti aggiuntivi correnti del SDK prima di allargare gli scope; mai usare l'email come identità.

Verifica del 30 ottobre 2026: il [tutorial ufficiale del player SDK](https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player) richiede anche `user-read-email`. Si aggiunge esclusivamente al consenso incrementale di playback, senza leggere o conservare l'email come dato applicativo. Le capacità di riproduzione richiedono tutti gli scope SDK e di controllo; un collegamento precedente con permessi parziali conserva la lettura della libreria e deve completare il consenso di playback. Le impostazioni distinguono permessi già concessi, autorizzazione in corso ed errori e indicano il passo successivo per scegliere il player.

DTO di stato separa:

- link: `unlinked | linked | reauth-required`;
- entitlement: `premium | non-premium | unknown`, con fonte e momento della verifica;
- capacità operative e motivo: policy, config, scope, allowlist/accesso, quota, rete, browser o dispositivo.

La [migrazione Development Mode](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) rimuove `product`: campo assente significa `unknown`. Se presente e riconosciuto, usarlo senza assumerne disponibilità. Dopo il linking mostrare subito lo stato; quando il rilascio reale è ammesso, la verifica SDK opt-in può confermare l'entitlement senza avviare audio. `account_error` è il segnale specifico di non Premium; una risposta 403 generica non lo è. Se la verifica non è possibile, avviso «Spotify richiede Premium; abbonamento non verificabile» e possibilità di provare esplicitamente.

Il proprietario dell'app Development Mode deve mantenere Premium e gli utenti devono essere allowlisted, fino a 5 secondo la [pagina quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). Non attribuire il guasto globale dell'app developer al piano del singolo utente. Il changelog più recente prevale sui limiti app di febbraio: [luglio 2026](https://developer.spotify.com/documentation/web-api/references/changes/july-2026) porta a 25 Client ID e quote condivise per account developer.

### D5. Store sicuri e concorrenza distribuita

`SpotifyStore` separa dominio e persistenza di link, tentativi e coordinamento. Server: tabelle SQLite `spotify_links` (user FK unica, account_id unico, envelope token, scope, expiry, authorization time, version/generation) e `spotify_oauth_attempts`. Gateway: documento KV con dati partizionati logicamente per user ID immutabile, controllo di unicità account_id e pending con scadenza. Non usare username o stato OAuth come identità del proprietario.

Decisione consolidata durante l'implementazione: una CAS su un unico documento gateway mantiene atomici proprietà degli account, link, pending, generazioni e lease, senza un indice inverso separato che possa rimanere orfano dopo un crash. Le implementazioni Redis TCP e Upstash eseguono lo stesso script EVAL. Per l'uso personale con pochi utenti questa soluzione riduce le finestre di inconsistenza; un'eventuale estensione a molti utenti richiederà partizionamento senza perdere le garanzie. Le scadenze OAuth vengono validate e i pending scaduti puliti alle scritture, senza un worker serverless permanente.

Token cifrati AES-256-GCM, nonce nuovo, AAD con user/provider/versione, chiave dedicata da env e key ID per rotazione. Non riciclare la chiave sessioni. Access token persistente eventualmente cifrato nello stesso envelope; refresh token mai al browser. Endpoint token SDK: cookie-only, Origin valido, `Cache-Control: no-store`, `Vary: Cookie`, access token e scadenza soltanto; resta in memoria.

Rinnovo anticipato con margine 60 s, single-flight per istanza e lease/CAS atomici nello store condiviso. Estendere l'astrazione KV con primitive atomiche mirate implementate per Redis TCP, Upstash REST e MemoryKv, non con sequenze GET/SET. Lease con owner e scadenza, rilascio compare-owner, fencing/versione su ogni scrittura: una risposta tardiva non deve resuscitare un link scollegato. Indice inverso e link scritti/rimossi coerentemente; recovery di claim incompleto verificata nei test. SQLite usa transazioni brevi per claim/CAS senza mantenerle aperte durante richieste esterne.

La [documentazione refresh](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens) indica durata refresh di 6 mesi non estesa dai rinnovi: salvare l'istante di autorizzazione, gestire scadenza e `invalid_grant` come reauth. Conservare il refresh precedente se il rinnovo non ne restituisce uno, sostituirlo atomicamente se arriva. Unlink incrementa la generazione prima del cleanup, invalida pending e rinnovi; eliminazione account passa dallo stesso cleanup, inclusi i comandi CLI dei due backend.

Alternativa: lock solo in memoria; non sufficiente fra più istanze serverless.

### D6. REST adapter e superficie applicativa chiusa

Tutte le rotte sotto `/api/spotify` richiedono sessione locale; proxy con elenco di azioni, mai URL/metodo upstream arbitrari. Una funzione gateway `api/spotify/[action].ts` per l'intera superficie (ID/query nel body o nei parametri), quindi 8 funzioni complessive; router dev e Vercel identici. Fastify espone gli stessi contratti applicativi. Le raccolte ibride in modalità client restano nel dispositivo, senza nuove funzioni cloud.

| API applicativa proposta | Responsabilità |
|---|---|
| `GET status`, `POST link`, `GET callback`, `DELETE link` | Stato, OAuth e disconnessione |
| `POST token` | Access token effimero esclusivamente per SDK |
| `GET search`, `GET library`, `GET detail` | Ricerca paginata e letture tipizzate track/album/artist/playlist |
| `PUT/DELETE saved` | Salvataggio/rimozione espliciti di track/album |
| `POST/PATCH playlist`, `GET/POST/PUT/DELETE playlist-items` | Playlist native: creazione/dettaglio, metadati, lettura e modifiche elementi |
| `GET devices`, `GET playback`, `POST playback` | Device picker, stato e comandi enum validati |

Upstream documentati, ricontrollati prima dell'implementazione del relativo metodo:

- `GET /search` con `limit <= 10`, paginazione indipendente per tipo e offset; `GET /me/tracks`, `/me/albums`, `/me/playlists`, dettaglio track/album/artist e relativi album/brani supportati. Non richiedere browse, recommendations, artist top tracks o audio features rimossi per la modalità prevista. Gestire metadata playlist senza elementi come accesso limitato, non elenco vuoto (migrazione collegata in D4).
- [Playlist items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items): `/playlists/{id}/items`, con payload di lettura `items[].item` e campi null/mancanti gestiti; endpoint vecchi `/tracks` non sono fallback automatici. Compatibilità con una diversa shape legacy, se utile, solo tramite normalizzatore testato e mai tentativi indiscriminati su endpoint ritirati.
- [Creazione playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist): `POST /me/playlists`; inviare sempre `public: false` salvo scelta esplicita. Modifiche agli elementi con snapshot/versione quando previsto; chunk secondo limiti correnti di ciascun endpoint. Nessun retry cieco di create/add/remove/reorder dopo un timeout; registrare esito incerto e rileggere.
- [Libreria](https://developer.spotify.com/documentation/web-api/reference/save-library-items): `PUT/DELETE /me/library`, URI nel parametro documentato, massimo 40 per richiesta; non copiare payload di vecchi tutorial. Valgono gli scope per tipo di entità.
- [Avvio playback](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback): comandi `/me/player/*`, URI/context e device validati. 204 senza body è un successo; 204 di lettura stato è assenza di stato, non playback garantito.

`fetch` con AbortSignal, timeout 8 s per tentativo e budget complessivo 12 s (gateway handler 15–20 s). Una sola ripetizione di una lettura per 401 dopo refresh o guasto transitorio, entro budget; mutazioni solo se la semantica ne rende certa la sicurezza. Validazione Zod tollerante ai campi aggiuntivi e rigorosa sugli invarianti. Seguire paginazione solo su endpoint/host ufficiale consentito, preferibilmente ricostruendo offset/cursor; limiti contro loop e richieste illimitate. Cache di letture personali in memoria per sessione, breve e invalidata su mutazione: nessuna copia completa della libreria al bootstrap.

### D7. Errori e circuit breaker confinati

Errori applicativi: `SPOTIFY_NOT_CONFIGURED`, `SPOTIFY_POLICY_DISABLED`, `SPOTIFY_REAUTH_REQUIRED`, `SPOTIFY_PREMIUM_REQUIRED`, `SPOTIFY_SCOPE_REQUIRED`, `SPOTIFY_ACCESS_RESTRICTED`, `SPOTIFY_RATE_LIMITED`, `SPOTIFY_QUOTA_EXCEEDED`, `SPOTIFY_DEVICE_UNAVAILABLE`, `SPOTIFY_UNSUPPORTED`, `SPOTIFY_UNAVAILABLE`, `SPOTIFY_CONTRACT_CHANGED`, `SPOTIFY_MUTATION_UNCERTAIN`.

Solo un errore di sessione Spookyfy usa il suo 401. Errori upstream convertiti in codici provider e status applicativo appropriato. Un trasporto web Spotify dedicato riusa la validazione sessione quando necessaria, ma non segna offline l'intera app su guasto Spotify; `Api.auth.me` conserva la propria autorità.

Rispettare [Retry-After](https://developer.spotify.com/documentation/web-api/concepts/rate-limits), senza tenere aperta una richiesta serverless durante l'attesa. Lo stato di cooldown condiviso applicabile al developer/client evita tempeste fra utenti e istanze. `reason=QUOTA_EXCEEDED` (D4, changelog luglio) è distinto da rate limit; senza retry time nessun polling aggressivo, solo nuova prova esplicita e limitata. Tre guasti upstream consecutivi aprono un circuito per 30 s con una sola sonda di recupero; un 403 su una funzione ne limita la capacità senza disabilitare le altre. Nessuna scorciatoia verso YouTube quando Spotify fallisce.

Log solo operazione, status, durata e motivo normalizzato. Redigere token, codici OAuth, query callback e corpi sensibili: il logger Fastify corrente oscura gli header ma non basta per gli URL callback. Metriche tecniche del servizio senza statistiche di ascolto.

### D8. Player a due motori con percorso locale preservato

Introdurre `PlaybackController` sopra `LocalAudioEngine` (adapter dell'attuale `Player`) e `SpotifyEngine` (SDK + API). Con Spotify inattivo, ogni gesto locale passa subito al motore esistente, senza `await`, ricaricare `<audio>` o introdurre dipendenze dalla rete. Le code puramente locali continuano a usare il comportamento verificato; il controller usa occurrence ID per quelle multisorgente.

Il [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) crea un dispositivo Connect browser; caricarlo da `https://sdk.scdn.co/spotify-player.js` solo quando richiesto. `getOAuthToken` usa l'endpoint effimero; registrare e rimuovere listener, gestire ready/not_ready e teardown. Niente SDK nel bundle iniziale o caricamento su login. CSP/Permissions Policy e CORS vanno verificate negli ambienti effettivi senza aprire origini arbitrarie.

Macchina a stati: `idle → preparing → playing | paused | needs-gesture | unavailable`; handoff `stopping-old → starting-new` con generation ID per ignorare promesse ed eventi superati. Confermare pausa/stop prima di cambiare motore; se non confermato restare in pausa, proporre disconnect del player browser e ripresa esplicita locale. Con dispositivo esterno irraggiungibile, indicare all'utente di arrestarlo/confermare il recupero, senza ricreare il device o trasferire playback automaticamente.

Per Spotify puro usare contesto/coda nativa e rispettare `disallows`. Per coda ibrida simulata e futura autorizzata controllare una singola occorrenza alla volta: niente remote context che anticipi un altro brano. Fine Spotify dedotta da transizione coerente dell'URI/stato, posizione e durata, non da un generico evento paused; deduplicare i segnali e non usare timer per fingere una fine. Riconciliare modifiche fatte in un client esterno prima di avanzare. Se non è determinabile in modo affidabile, mettere in pausa invece di saltare elementi.

Applicare shuffle/repeat alla coda proprietaria, skip non disponibili con scansione limitata al numero di occorrenze. `needs-gesture` non equivale a brano non disponibile: non saltarlo. Persistenza del controller contiene soltanto riferimenti e posizione, partizionati per utente; ripristino sempre in pausa, metadati Spotify ricaricati dopo verifica del link. L'attuale `PlayReporter`, analisi silenzio e trim si applicano solo ai file locali.

Un solo proprietario della Media Session: controller, SDK con `enableMediaSession: false`. Metadati e azioni seguono il motore attivo. La [reference SDK](https://developer.spotify.com/documentation/web-playback-sdk/reference) distingue `account_error`, `authentication_error`, `initialization_error` e `autoplay_failed`; `activateElement()` va chiamato nel gesto prima di attendere rete. Il [tutorial mobile](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started) descrive il gesto necessario nei trasferimenti: non promettere transizioni automatiche/background su iOS PWA senza prova reale. Volume iOS resta sotto controllo fisico.

Alternativa: riscrivere il player locale in un motore async universale. Scartata per rischio di regressioni autoplay, lockscreen e importazione con sostituzione del brano provvisorio.

### D9. Raccolte ibride additive e backup

Non indebolire `playlist_items.track_id`. Nuove tabelle `hybrid_playlists` e `hybrid_playlist_items` con owner, occurrence ID, posizione frazionaria, riferimento discriminato e check di validità. Riferimento locale con FK verso tracks; remoto con URI e identità del link, mai FK a tracks. Niente scrittura delle playlist ibride nel Redis gateway.

Client: IndexedDB v4 con nuovi store per raccolte/occorrenze indicizzate per user ID e playlist. Nessuna riscrittura di `libTracks`, `libPlaylists` o cache audio. Letture, modifiche, restore e purge richiedono owner corrente; il recupero offline dell'utente ricordato non autorizza richieste reali. Le playlist legacy possono essere copiate esplicitamente in nuove raccolte ibride, senza perdere l'originale. Nell'UI «Playlist Spookyfy» e «Playlist Spotify» sono distinte.

Backup: estensione opzionale versionata internamente al formato v1 (`hybridCollections` con `version: 1`), tutti i nuovi campi opzionali per conservare il lettore vecchio e importare i vecchi file. Include soli riferimenti Spotify/contesto minimo necessario per la riconciliazione e occorrenze, niente token, profilo o artwork Spotify. Il lettore nuovo valida l'intera estensione prima di modificare il DB e segnala ai client vecchi che la parte ibrida non è supportata nella documentazione del formato. L'import non copia l'owner del backup: assegna all'utente locale corrente, ma i riferimenti remoti sono inerti fino al consenso e conferma dello stesso account Spotify stabile; una corrispondenza con altro account non viene assunta. Ri-importazione idempotente per raccolte/occorrenze.

Per un backup locale completo on-premise, documentare che il DB include envelope cifrati: non condividere il backup né la chiave. La funzione di export portabile esclude sempre credenziali Spotify. Il ripristino su una nuova installazione richiede reauth, senza riattivare automaticamente token ripristinati.

Alternativa: aggiungere campi opzionali alle vecchie righe playlist e URL audio sintetici; costringerebbe bridge e vecchi client a interpretare media che non possono riprodurre.

### D10. Cleanup, cache e UX

Unlink backend elimina token, pending e indice inverso; client abortisce fetch, distrugge SDK, cancella stato in memoria e riferimenti persistenti del link. Server elimina in transazione gli item remoti mantenendo playlist e posizione relativa degli item locali. Dispositivi client inattivi riconciliano link/generazione alla prima connessione prima di visualizzare metadati remoti; notificare le tab aperte con BroadcastChannel. Logout cancella memoria/token/metadati personali e smonta il modulo, pur conservando il collegamento backend e le raccolte personali segregate, da riaprire solo con lo stesso account. Account deletion esegue cleanup definitivo.

`sw.ts` non deve intercettare/cachare le API Spotify né SDK/token; copertine remote con attribuzione e link, senza riuso nel catalogo album locale o trasformazioni. Download di raccolte ibride filtra solo i file locali e mostra il numero di esclusi. Offline rimangono disponibili riferimenti minimi e file locali; nessuna promessa di Spotify offline.

UI nuova nelle impostazioni per link/stato/scope/unlink; ricerca con schede sorgente e richieste cancellabili; sezione Spotify per libreria e playlist; menu specifici, device picker e badge di provenienza. Riutilizzare lo stile dell'app, ma non la logica di download/modifica dei tag di `TrackMenu` per il DTO remoto.

## Risks / Trade-offs

- [Uso integrato potenzialmente incompatibile con Spotify] → funzioni reali disattivate, dipendenza esterna esplicita; nessuna promessa di rilascio completo prima della risoluzione.
- [API/documenti non sempre allineati fra modalità] → contratti su fixture sintetiche per modalità corrente, campi opzionali, reference specifica per operazione, nessun fallback su API ritirate.
- [Limiti browser/DRM/background] → motore locale preservato, ripresa con gesto, Connect o link esterno; checklist fisica separata dagli E2E simulati.
- [Mutazioni remote senza idempotency key] → esito incerto visibile e riconciliazione; niente retry automatico che duplichi playlist o occorrenze.
- [Token/cleanup fra istanze e tab] → CAS, generazioni e lease verificati, purge al logout/unlink, nessun caching dei token.
- [Regressioni indirette] → test prima della modifica sul percorso locale, feature disattivata come caso principale e regressioni su entrambi i backend.
- [Budget serverless e build] → singolo handler Spotify, test conteggio 8/12, clean build Linux nelle verifiche previste dalla CI.

## Migration Plan

1. Contratti e fixture finti; congelare le interfacce prima di delegare. Stabilire baseline dei test locali pertinenti.
2. Package backend e adapter SQLite/KV, migrazioni additive; nessuna credenziale reale.
3. Flussi impostazioni/ricerca/libreria e player opzionale; raccolte v4 e backup; verifiche simulate complete con Spotify spento e guasto.
4. Verifica dell'agente principale: architettura, OAuth, concorrenza, migrazioni, flussi E2E e build. Nessuna prova con l'account del proprietario prima di questo passaggio.
5. Ultima fase con il proprietario: risolvere il vincolo della piattaforma, predisporre dashboard/origini/chiavi, linking reale e test Premium/dispositivi/mobile. Se il vincolo resta irrisolto questa fase rimane incompleta, con la parte locale funzionante.

Rollback: spegnere i flag Spotify senza eliminare file o tabelle; le vecchie API ignorano le nuove raccolte. Conservare schemi additivi, non applicare down migration distruttive a dati musicali. Un vecchio client che non può aprire IndexedDB v4 richiede aggiornamento o rollback del solo modulo frontend su una build compatibile con v4, senza cancellare DB/cache. Rotazione o perdita chiave Spotify produce reauth del solo provider. Se avviene un push, attendere tutti i workflow scatenati e correggere eventuali fallimenti secondo AGENTS.md.
