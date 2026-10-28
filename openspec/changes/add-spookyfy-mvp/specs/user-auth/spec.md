# Spec Delta

## Purpose

Garantisce che solo le persone autorizzate dal proprietario del server possano registrarsi e usare Spookyfy, proteggendo libreria, streaming e ingestione esposti su Internet tramite tunnel.

## ADDED Requirements

### Requirement: Registrazione con token di invito
Il sistema SHALL permettere di creare un account dall'app solo fornendo username, password e il token di registrazione configurato sul server (valore predefinito `spotifymerdacostosa2026`). Un token errato o mancante MUST far rifiutare la richiesta senza creare l'account. Se il token configurato è vuoto la registrazione MUST essere disabilitata. A registrazione riuscita l'utente SHALL risultare autenticato.

#### Scenario: Registrazione riuscita
- **WHEN** un utente invia username `fede`, una password valida e il token `spotifymerdacostosa2026` con la configurazione predefinita
- **THEN** l'account `fede` viene creato, la sessione viene avviata e l'app mostra la Home

#### Scenario: Token errato
- **WHEN** un utente invia dati validi con il token `abc123`
- **THEN** il sistema rifiuta la richiesta con un errore di token non valido e nessun account viene creato

#### Scenario: Token personalizzato
- **WHEN** il server è configurato con un token diverso da quello predefinito e un utente si registra con `spotifymerdacostosa2026`
- **THEN** la registrazione viene rifiutata

#### Scenario: Registrazione disabilitata
- **WHEN** il token di registrazione è configurato vuoto e un utente tenta di registrarsi con qualunque token
- **THEN** il sistema risponde che la registrazione è disabilitata e nessun account viene creato

#### Scenario: Ordine dei controlli
- **WHEN** un utente invia uno username già esistente con un token errato
- **THEN** il sistema segnala solo il token non valido, senza rivelare che lo username è in uso

### Requirement: Unicità e formato dello username
Lo username SHALL essere lungo da 3 a 32 caratteri e contenere solo lettere, cifre, punto, trattino e underscore. Lo username MUST essere unico senza distinzione fra maiuscole e minuscole. Con token valido, uno username già in uso MUST essere rifiutato con un errore esplicito di username non disponibile.

#### Scenario: Username già in uso
- **WHEN** esiste l'account `fede` e un utente si registra con token valido e username `Fede`
- **THEN** il sistema rifiuta la registrazione indicando che lo username non è disponibile

#### Scenario: Username non valido
- **WHEN** un utente si registra con lo username `fe` o `fede!`
- **THEN** il sistema rifiuta la registrazione con un errore di validazione sullo username

#### Scenario: Registrazioni concorrenti
- **WHEN** due richieste di registrazione con lo stesso username arrivano nello stesso istante
- **THEN** viene creato un solo account e l'altra richiesta riceve l'errore di username non disponibile

### Requirement: Requisiti della password
Ogni password impostata (registrazione, creazione da riga di comando, cambio password) MUST avere da 8 a 128 caratteri e contenere almeno una lettera, almeno una cifra e almeno un carattere speciale (non alfanumerico). Le password MUST essere salvate solo come hash con algoritmo lento e salt. L'app SHALL mostrare durante la digitazione quali requisiti sono già soddisfatti.

#### Scenario: Password valida
- **WHEN** un utente si registra con la password `Notte#2026`
- **THEN** la password è accettata

#### Scenario: Password troppo corta
- **WHEN** un utente si registra con la password `ab#1`
- **THEN** il sistema rifiuta la registrazione indicando la lunghezza minima di 8 caratteri

#### Scenario: Carattere speciale mancante
- **WHEN** un utente si registra con la password `notte2026`
- **THEN** il sistema rifiuta la registrazione indicando che serve almeno un carattere speciale

#### Scenario: Cifra mancante
- **WHEN** un utente si registra con la password `notte#notte`
- **THEN** il sistema rifiuta la registrazione indicando che serve almeno una cifra

#### Scenario: Feedback in tempo reale
- **WHEN** l'utente digita `notte2026` nel campo password della schermata di registrazione
- **THEN** l'app mostra soddisfatti i requisiti di lunghezza, lettera e cifra e non soddisfatto quello del carattere speciale

### Requirement: Gestione account da riga di comando
Il sistema SHALL permettere all'amministratore del server di creare account, reimpostarne la password, elencarli ed eliminarli tramite un comando eseguito sul server, applicando gli stessi controlli di unicità dello username e di requisiti della password della registrazione, senza bisogno del token.

#### Scenario: Creazione di un account dal server
- **WHEN** l'amministratore esegue il comando di creazione utente con username `anna` e password `Luna_2026`
- **THEN** l'account `anna` esiste e può effettuare il login dall'app

#### Scenario: Password non conforme da CLI
- **WHEN** l'amministratore prova a creare un account con la password `luna`
- **THEN** il comando fallisce con un messaggio che elenca i requisiti non soddisfatti e nessun account viene creato

#### Scenario: Eliminazione di un account
- **WHEN** l'amministratore elimina l'account `fede`
- **THEN** tutte le sessioni attive di `fede` vengono invalidate e i suoi dati personali (preferiti, playlist, storico) vengono rimossi

### Requirement: Login con username e password
Il sistema SHALL autenticare l'utente con username (senza distinzione fra maiuscole e minuscole) e password e, in caso di successo, stabilire una sessione tramite un cookie non accessibile da JavaScript, marcato Secure, valido solo per l'origine dell'app. In caso di fallimento il sistema MUST rispondere con lo stesso messaggio generico sia per username inesistente sia per password errata.

#### Scenario: Login riuscito
- **WHEN** l'utente invia credenziali corrette dalla schermata di login
- **THEN** il sistema imposta il cookie di sessione e l'app mostra la Home

#### Scenario: Credenziali errate
- **WHEN** l'utente invia una password errata per un username esistente
- **THEN** il sistema risponde con errore di autenticazione e lo stesso messaggio usato per uno username inesistente

### Requirement: Durata e rinnovo della sessione
Una sessione SHALL restare valida per 30 giorni dall'ultimo utilizzo e MUST essere rinnovata automaticamente quando l'utente usa l'app. Una sessione scaduta o revocata MUST essere rifiutata.

#### Scenario: Sessione rinnovata dall'uso
- **WHEN** l'utente usa l'app 20 giorni dopo il login e poi di nuovo 25 giorni dopo
- **THEN** la sessione è ancora valida al secondo utilizzo

#### Scenario: Sessione scaduta
- **WHEN** l'utente non usa l'app per più di 30 giorni
- **THEN** la richiesta successiva viene rifiutata e l'app mostra la schermata di login

### Requirement: Logout
Il sistema SHALL permettere all'utente di terminare la propria sessione corrente; dopo il logout il cookie MUST essere rimosso e la sessione MUST essere invalidata lato server.

#### Scenario: Logout dalle impostazioni
- **WHEN** l'utente tocca "Esci" nelle impostazioni
- **THEN** la sessione viene invalidata sul server e l'app mostra la schermata di login

#### Scenario: Riuso del cookie dopo il logout
- **WHEN** una richiesta usa il valore di un cookie di sessione già chiusa con logout
- **THEN** il sistema rifiuta la richiesta come non autenticata

### Requirement: Tutte le risorse private richiedono autenticazione
Ogni endpoint API, lo streaming audio, le copertine e il canale in tempo reale MUST rifiutare richieste senza una sessione valida. Solo i file statici della PWA (app shell, manifest, icone) e gli endpoint di login e registrazione SHALL essere accessibili senza sessione.

#### Scenario: Audio senza sessione
- **WHEN** un client senza cookie di sessione richiede il file audio di un brano
- **THEN** il sistema risponde con errore di autenticazione senza inviare dati audio

#### Scenario: Canale in tempo reale senza sessione
- **WHEN** un client senza sessione valida tenta di aprire il canale in tempo reale
- **THEN** la connessione viene rifiutata

#### Scenario: App shell accessibile
- **WHEN** un client senza sessione richiede la pagina principale della PWA
- **THEN** il sistema restituisce l'app shell, che mostra la schermata di login

### Requirement: Protezione da brute force sul login
Il sistema SHALL limitare i tentativi di login falliti a 5 ogni 15 minuti per combinazione di indirizzo IP del client e username; oltre il limite MUST rifiutare ulteriori tentativi fino alla scadenza della finestra, anche con credenziali corrette. L'IP del client MUST essere ricavato dall'header impostato dal tunnel.

#### Scenario: Superamento del limite
- **WHEN** dallo stesso IP vengono inviati 5 login falliti per `fede` in 10 minuti e poi un sesto tentativo con la password corretta
- **THEN** il sesto tentativo viene rifiutato con un errore di troppe richieste

#### Scenario: Scadenza della finestra
- **WHEN** sono trascorsi 15 minuti dal primo dei 5 tentativi falliti
- **THEN** un login con credenziali corrette ha successo

### Requirement: Protezione da brute force sul token di registrazione
Il sistema SHALL limitare i tentativi di registrazione con token errato a 5 ogni 15 minuti per indirizzo IP del client; oltre il limite MUST rifiutare ogni richiesta di registrazione da quell'IP, anche con token corretto, fino alla scadenza della finestra.

#### Scenario: Tentativi di indovinare il token
- **WHEN** dallo stesso IP arrivano 5 registrazioni con token errato e poi una con il token corretto entro 15 minuti
- **THEN** la sesta richiesta viene rifiutata con un errore di troppe richieste e nessun account viene creato

### Requirement: Protezione delle richieste che modificano dati
Il sistema MUST rifiutare ogni richiesta che modifica dati (registrazione, creazione, aggiornamento, eliminazione, avvio di download) se l'header Origin non corrisponde all'origine pubblica configurata per l'app.

#### Scenario: Richiesta cross-origin
- **WHEN** una pagina su un altro dominio invia una richiesta di creazione playlist usando il cookie dell'utente
- **THEN** il sistema rifiuta la richiesta e nessuna playlist viene creata

#### Scenario: Richiesta dall'app
- **WHEN** l'app, dalla propria origine, invia una richiesta di creazione playlist
- **THEN** la playlist viene creata
