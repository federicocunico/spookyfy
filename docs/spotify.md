# Spotify

Spotify è un modulo facoltativo. Un account Spookyfy si crea e usa con le credenziali locali; il collegamento Spotify si avvia successivamente dalle impostazioni. Scollegare Spotify non cancella la musica importata.

L'integrazione reale è **disattivata per impostazione predefinita**. La configurazione dell'app Spotify e il collegamento con l'account personale sono l'ultima fase della change `add-modular-spotify-integration`, dopo le verifiche senza credenziali. Questo documento distingue la funzionalità implementata dalle prove ancora necessarie con Spotify reale.

## Disponibilità e limiti

Lo streaming musicale tramite SDK richiede Premium; non tutte le operazioni Web API hanno questo requisito. Il profilo può non esporre `product`: in quel caso l'app indica che Premium è richiesto ma l'abbonamento non è ancora verificabile. Un errore di quota, permessi, dispositivo o browser non significa che l'utente sia Free. [Profilo](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile), [scope streaming](https://developer.spotify.com/documentation/web-api/concepts/scopes).

Per Development Mode il proprietario dell'app developer deve mantenere Premium e gli utenti devono appartenere all'allowlist, con i limiti descritti nella [documentazione quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). Il [changelog di luglio 2026](https://developer.spotify.com/documentation/web-api/references/changes/july-2026) aggiorna il limite a 25 app per developer, con quote condivise, e distingue `QUOTA_EXCEEDED` dal semplice rate limit.

Il wrapper multiservizio e le funzioni ibride incontrano limiti della [Developer Policy § III](https://developer.spotify.com/policy). Prima di abilitare l'integrazione reale serve risolvere e documentare quel vincolo rispetto all'uso effettivo dell'app. Il flag di configurazione non concede un'autorizzazione da Spotify. Non assumere che un account Premium o il funzionamento tecnico del SDK risolvano questo punto.

**Decisione del proprietario, 30 ottobre 2026:** dopo la segnalazione dei vincoli, il proprietario ritiene che non si applichino al proprio utilizzo e ha richiesto esplicitamente di procedere con l'attivazione e le prove personali. Su questa indicazione sono abilitati il modulo reale e la riproduzione ibrida nell'installazione Vercel. La decisione dell'operatore non costituisce un'autorizzazione rilasciata da Spotify né una verifica legale indipendente; il punto 9.1 resta aperto per tale verifica. Le verifiche automatiche svolte finora usano dati sintetici.

La configurazione di produzione usa la callback `https://spookyfy-music.vercel.app/api/spotify/callback`, Client ID backend e una chiave di cifratura dedicata conservata come variabile sensibile su Vercel. Il provider sintetico resta disattivato. Registrazione della callback e allowlist nella dashboard devono ancora essere confermate dal proprietario; OAuth, streaming e prove sui dispositivi reali non sono ancora attestati.

## Configurazione facoltativa

Le variabili si impostano sul backend che autentica l'utente: server on-premise oppure gateway Vercel. Non sono variabili `VITE_*` e le chiavi non devono entrare nel bundle web.

| Variabile | Significato |
|---|---|
| `SPOTIFY_ENABLED` | `true` abilita la valutazione della configurazione reale; default spento |
| `SPOTIFY_CLIENT_ID` | Client ID pubblico dell'app developer |
| `SPOTIFY_REDIRECT_URI` | Callback registrata, ad esempio `https://dominio.example/api/spotify/callback` |
| `SPOTIFY_KEY_ID` | Identificatore della chiave attiva per cifrare i token |
| `SPOTIFY_ENCRYPTION_KEYS` | Oggetto JSON `{"identificatore":"chiave-base64-di-32-byte"}` |
| `SPOTIFY_POLICY_RESOLVED` | Attestazione dell'operatore dopo la risoluzione documentata del vincolo; default falso |
| `SPOTIFY_HYBRID_PLAYBACK_ENABLED` | Ulteriore controllo della riproduzione multisorgente; default falso |
| `SPOTIFY_FAKE` | Provider sintetico, ammesso solo con `NODE_ENV=test` o `development` |

Chiavi dedicate e casuali di 32 byte, distinte da `SESSION_SECRET`. Per la rotazione aggiungere una nuova chiave all'oggetto e cambiare `SPOTIFY_KEY_ID`; mantenere la precedente finché serva decifrare i collegamenti esistenti. Perdita o rimozione di una chiave richiede il ricollegamento del solo provider.

PKCE non richiede di inserire un client secret nel browser. Il redirect deve corrispondere alla dashboard: HTTPS, oppure HTTP su IP loopback esplicito come `127.0.0.1`; `localhost` non è accettato da Spotify. Usare la stessa origine per app, cookie e callback anche in sviluppo. [Redirect URI](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

Configurazione Spotify assente o incompleta non impedisce di avviare Spookyfy. Il provider finto non è un fallback automatico in produzione. In sviluppo si può impostare `NODE_ENV=development` e `SPOTIFY_FAKE=true` per verificare l'interfaccia senza app developer, token o richieste audio Spotify.

## Collegamento e dati personali

Il flusso è [Authorization Code con PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow). Il backend lega la richiesta alla sessione Spookyfy iniziatrice; il ritorno da Spotify non crea né autentica un account locale. Nome ed email Spotify non sono usati per fondere account: l'associazione utilizza `account_id`, l'identificatore stabile indicato dalla documentazione.

Per mostrare le playlist native modificabili, il backend può confrontare temporaneamente `/me.id` e `owner.id`. Questo confronto di permessi rimane nella cache breve della sessione e non sostituisce `account_id` nel collegamento persistente. Identità o permessi insufficienti producono una vista in sola lettura.

I permessi crescono solo su richiesta della funzione: consultazione, modifica libreria, modifica playlist e streaming sono capacità distinte. Una nuova autorizzazione rifiutata non deve cancellare quella precedente.

Access e refresh token persistenti sono cifrati sul backend. Il player riceve soltanto un access token temporaneo in memoria, con risposta non memorizzabile in cache. I token non devono apparire nei log, nel backup portabile, negli URL di ritorno alle impostazioni, in IndexedDB o localStorage.

I [refresh token](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens) hanno una durata documentata di sei mesi, che non viene estesa dai rinnovi dell'access token. Scadenza o revoca richiedono una nuova autorizzazione Spotify; il login Spookyfy resta indipendente.

**Scollega Spotify** rimuove credenziali, dati e riferimenti Spotify del collegamento e ferma le attività associate. Le occorrenze locali delle raccolte restano nel loro ordine relativo. **Esci** pulisce il player e i dati temporanei del browser; il collegamento backend resta associato all'account Spookyfy, da recuperare soltanto dopo il suo login. Per revocare anche l'autorizzazione sul sito Spotify usare la gestione delle app dell'account Spotify.

## Librerie e playlist

- La libreria locale e la ricerca YouTube mantengono il loro percorso precedente.
- La sezione Spotify consulta brani, album, artisti e playlist autorizzati; i risultati riportano provenienza e link Spotify.
- I preferiti locali e i salvataggi Spotify sono operazioni separate ed esplicite.
- Le playlist native Spotify si modificano soltanto con scope e permessi sufficienti. Creare una playlist senza scelta pubblica esplicita la rende privata.
- L'API nativa di rimozione opera per URI: il comando dell'app indica esplicitamente che rimuove tutte le occorrenze del brano scelto e richiede conferma. Le raccolte Spookyfy permettono invece di rimuovere una singola occorrenza. [Remove playlist items](https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist).
- Le playlist ibride sono raccolte **Spookyfy** di riferimenti ordinati; consentono duplicati e non sono sincronizzate automaticamente su Spotify. Copiare una playlist locale lascia intatto l'originale.
- Una playlist Spotify di cui sono disponibili solo i metadati è indicata come limitata, senza fingere che sia vuota. Episodi, elementi rimossi e file locali del client Spotify non diventano file Spookyfy.

Non esistono download Spotify, conversione in YouTube, modifica dei tag remoti, trim Spotify o upload dei file personali a Spotify. Un download di raccolta considera soltanto i file locali idonei. Senza rete si possono ascoltare i file già disponibili, mentre i riferimenti Spotify rimangono remoti.

## Contratti API e documentazione

Superficie applicativa chiusa sotto `/api/spotify/*`, autenticata tramite sessione browser Spookyfy; nessun proxy per URL o metodi arbitrari. Il token bridge on-premise non autorizza il linking. Nel gateway una sola funzione dinamica gestisce queste azioni, rispettando il budget serverless.

| Azioni Spookyfy | API Spotify di riferimento | Scope principali |
|---|---|---|
| `link`, `callback`, `status`, `token` | `/authorize`, `/api/token`, `GET /me` | `user-read-private` e consenso incrementale |
| `search`, `detail` | `/search`, dettaglio brano/album/artista/playlist | Token utente; altri scope dipendono dal contenuto |
| `library` | `/me/tracks`, `/me/albums`, `/me/playlists` | `user-library-read`, `playlist-read-private`, `playlist-read-collaborative` |
| `saved` | `PUT/DELETE /me/library` | `user-library-modify` per brani/album |
| `playlist` | `POST /me/playlists`, modifica dettagli playlist | `playlist-modify-private/public` |
| `playlist-items` | `/playlists/{id}/items` | Permessi di lettura/scrittura appropriati |
| `devices`, `playback` | `/me/player/*` e SDK ufficiale | `streaming`, `user-read-playback-state`, `user-modify-playback-state` |

Riferimenti verificati per il contratto 2026:

- [Migrazione Development Mode](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide): search massimo 10 per richiesta; endpoint e campi ritirati trattati esplicitamente.
- [Playlist items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items): usare `/items` e la relativa shape; niente fallback indiscriminato a `/tracks`.
- [Create playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist): `/me/playlists`, visibilità inviata esplicitamente.
- [Save library items](https://developer.spotify.com/documentation/web-api/reference/save-library-items): URI e limiti per richiesta secondo reference.
- [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits): rispettare `Retry-After`, limitare richieste e tentativi.
- [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/reference): errori account/autenticazione/inizializzazione/autoplay e controlli di trasporto.

Un timeout dopo una mutazione non prova che la modifica sia fallita: l'app deve mostrare un esito incerto e rileggere lo stato invece di ripetere alla cieca una creazione o aggiunta.

Il backend comune risiede in `packages/spotify` e viene compilato dopo `packages/shared`, senza essere importato dal web. Lo store gateway usa un documento con confronto e sostituzione atomici tramite Redis/Upstash EVAL: collegamenti, unicità degli account, tentativi OAuth, generazioni, lease e cooldown rimangono coerenti in una sola operazione. I token nel documento sono cifrati. Il server usa transazioni SQLite e gli stessi contratti. Questa scelta è proporzionata all'uso personale previsto; per un numero elevato di utenti occorrerebbe partizionare lo store conservando le garanzie di unicità e concorrenza.

## Player e dispositivi

Il player locale mantiene l'unico elemento audio persistente. Il SDK Spotify viene caricato solo su richiesta; l'audio remoto è gestito direttamente dal player ufficiale, senza passare da un proxy audio Spookyfy.

Il cambio di motore attende l'arresto del precedente. Un dispositivo remoto perso non deve indurre un trasferimento automatico al browser. Se l'arresto non è confermato, il passaggio resta in pausa con possibilità di recupero esplicito.

Lo stato di un dispositivo Connect esterno viene aggiornato periodicamente mentre l'app è visibile, con richieste limitate e possibilità di aggiornamento manuale. Le [snapshot Web API](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback) non forniscono un evento affidabile di fine brano: per una raccolta ibrida su quel dispositivo, una pausa o uno stato assente non fanno saltare automaticamente all'elemento seguente. Usare **Successivo** per continuare quando la fine non è verificabile. Nel player browser l'avanzamento usa i segnali SDK verificati, senza trasferimenti automatici verso altri dispositivi.

Il browser può richiedere un nuovo gesto dopo un trasferimento. Su iOS/PWA e in background la continuità del player locale non dimostra quella di Spotify o di una transizione ibrida. Le checklist su [iPhone](verification-ios.md) e [Android](verification-android.md) devono distinguere prove fisiche e simulazioni. Lo stato Spotify non alimenta il conteggio degli ascolti o l'analisi del silenzio dei file locali.

## Backup, migrazioni e rollback

SQLite e IndexedDB ricevono estensioni additive. La libreria device passa a IndexedDB v4; i file audio e le vecchie playlist non vengono convertiti in contenuti remoti.

Il backup portabile v1 può includere un'estensione opzionale `hybridCollections` versionata. Contiene ordine, occorrenze e riferimenti minimi, senza credenziali o audio Spotify. I vecchi backup rimangono importabili. I vecchi lettori non supportano la parte ibrida: usare una versione aggiornata per conservarla. Il ripristino assegna le raccolte all'utente corrente e mantiene i riferimenti remoti inerti fino alla riconciliazione esplicita con lo stesso account Spotify.

Un backup completo del DB on-premise include eventuali envelope cifrati: non condividerlo insieme alle chiavi. Un ripristino su un'altra installazione richiede nuova autorizzazione del provider.

Per disattivare Spotify spegnere i flag, senza cancellare tabelle, DB o cache audio. Evitare down migration distruttive. Un frontend precedente che supporta solo IndexedDB v3 non può aprire un DB v4: il rollback deve mantenere un client compatibile con v4, disabilitando il modulo.

## Verifica e attivazione personale

I test automatici coprono separatamente contratti, OAuth/token, API, store, SDK simulato, UI e regressioni dei file locali. Nessun risultato simulato costituisce una verifica di streaming, DRM o background su Spotify reale.

Verifica dell'agente principale del **30 ottobre 2026**, su Windows con Chromium e WebKit:

| Controllo | Esito |
|---|---|
| `pnpm lint` | Superato |
| `pnpm typecheck` | Superato; Svelte senza errori o warning |
| `pnpm test` | 692 passati: shared 83, Spotify 49, web 311, gateway 69, server 180; 2 esclusi |
| `pnpm build` | PWA e server compilati |
| `pnpm test:e2e` | 37 regressioni esistenti e 16 scenari Spotify passati; 3 esclusioni previste |
| `pnpm --filter @spookyfy/gateway vercel-build` | PWA copiata in `public`, 8 funzioni su 12 |
| `pnpm --filter @spookyfy/gateway count-functions` | 8/12 |
| `pnpm --filter @spookyfy/server exec drizzle-kit check` | Snapshot e journal coerenti |
| `openspec validate add-modular-spotify-integration --strict` | Superato |

La revisione ha corretto permessi/contenuti delle playlist native, conservazione dei metadati, selezione del dispositivo nei comandi, shape REST delle restrizioni, passaggi fra motori, comandi delle occorrenze locali, purge delle cache e richieste tardive. La cancellazione gateway è protetta anche contro nuove richieste già autenticate e cambi password concorrenti; il controllo browser della sessione revocata elimina il player Spotify senza fermare i file locali. Dopo queste ultime modifiche sono stati ripetuti i test completi e i controlli mirati pertinenti.

Gli scenari browser usano backend sintetico e protocollo SDK simulato, senza account o credenziali Spotify personali. Comprendono modifiche native con duplicati, raccolte ibride, offline, backup su database nuovo, unlink, errori del provider e disattivazione dei flag. I test di autenticazione client sono stati ripetuti su entrambi i browser dopo la correzione della cancellazione account.

Le due esclusioni unit/integration richiedono Redis esterno e YouTube reale. Le tre esclusioni browser sono i controlli Chromium di installabilità/CLS su WebKit e l'auto-trim client con codec non disponibile su WebKit. EVAL Redis/Upstash è verificato con adapter simulati; questo risultato non equivale a una prova su un servizio Redis/Upstash remoto.

Durante le verifiche sono comparsi un timeout isolato nel parser MP3 e un download locale rallentato; entrambi sono passati nelle successive esecuzioni isolate e complete, senza aumentare i timeout dei test.

Preview e rollback sono stati verificati **localmente** sui build di produzione e sugli handler del gateway, senza credenziali Spotify: il client rimane compatibile con IndexedDB v4 e la parte locale funziona con Spotify disattivato. Questi esiti descrivono la verifica precedente alla pubblicazione; il risultato del deploy remoto è attestato separatamente dal workflow CI GitHub.

L'attivazione personale è in corso su richiesta esplicita del proprietario: la configurazione del gateway Vercel è predisposta. Restano da confermare callback e allowlist nella dashboard e da eseguire OAuth del proprietario e prove reali desktop/mobile. L'eventuale ambiente on-premise richiede una propria callback e chiavi dedicate. La verifica indipendente del vincolo di piattaforma resta non attestata. Non occorre condividere password, refresh token o chiavi nel messaggio di chat.
