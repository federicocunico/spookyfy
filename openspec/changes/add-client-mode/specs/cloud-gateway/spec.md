# Spec Delta

## Purpose

Fornisce, su una piattaforma serverless senza stato, l'autenticazione degli utenti e il tramite verso YouTube (ricerca, metadati, audio e copertine) per la modalità client, senza conservare alcun dato musicale.

## ADDED Requirements

### Requirement: Budget di funzioni serverless
Il gateway SHALL essere composto al massimo da 12 funzioni serverless, incluse quelle future; il numero MUST essere verificato automaticamente a ogni build. La PWA SHALL essere servita come file statici dallo stesso deployment, senza consumare funzioni.

#### Scenario: Controllo in CI
- **WHEN** una modifica porta il gateway a 13 funzioni
- **THEN** la verifica automatica fallisce e indica il numero di funzioni e il limite

### Requirement: Account del gateway
Il gateway SHALL offrire registrazione con token di invito, login, logout e sessione corrente con le stesse regole dell'on-premise per username, password, unicità, durata della sessione (30 giorni dall'ultimo uso), messaggi d'errore e limite ai tentativi. Gli account e i contatori dei tentativi SHALL essere gli unici dati conservati, in un archivio chiave-valore.

#### Scenario: Registrazione sul gateway
- **WHEN** un utente si registra sul gateway con username `fede`, password `Notte#2026` e il token configurato
- **THEN** l'account viene creato e l'utente risulta autenticato

#### Scenario: Unicità sul gateway
- **WHEN** esiste `fede` e qualcuno si registra con token valido e username `FEDE`
- **THEN** la registrazione viene rifiutata con l'errore di username non disponibile

#### Scenario: Limite ai tentativi condiviso fra istanze
- **WHEN** 5 login falliti per lo stesso username dallo stesso IP arrivano a istanze diverse del gateway in 15 minuti
- **THEN** il sesto tentativo viene rifiutato con errore di troppe richieste

### Requirement: Sessione firmata senza stato
La sessione SHALL essere un token firmato in un cookie HttpOnly e Secure, rinnovato con l'uso; il server non conserva le sessioni, ma consulta l'archivio solo per revoche e invalidazioni. Dopo il logout lo stesso token MUST essere rifiutato fino alla sua scadenza naturale, e un cambio password o l'eliminazione dell'account MUST invalidare tutte le sessioni dell'utente.

#### Scenario: Riuso dopo il logout
- **WHEN** un client riusa il cookie di una sessione chiusa con logout
- **THEN** il gateway rifiuta la richiesta come non autenticata

#### Scenario: Cambio password
- **WHEN** l'amministratore reimposta la password di `fede` dalla riga di comando
- **THEN** le sessioni di `fede` aperte su qualunque dispositivo vengono rifiutate

### Requirement: Gestione account da riga di comando sul gateway
L'amministratore SHALL poter creare account, reimpostare password, elencare ed eliminare account del gateway con un comando eseguito dal proprio computer, che opera direttamente sull'archivio del gateway con le stesse regole di validazione.

#### Scenario: Creazione da CLI
- **WHEN** l'amministratore crea l'account `anna` dalla riga di comando con le credenziali dell'archivio
- **THEN** `anna` può accedere all'app servita dal gateway

### Requirement: Funzioni riservate agli utenti autenticati
Ricerca, metadati, audio e copertine MUST rifiutare richieste senza sessione valida, così che il gateway non sia utilizzabile da terzi come proxy verso YouTube.

#### Scenario: Proxy senza sessione
- **WHEN** un client senza sessione richiede l'audio di un video al gateway
- **THEN** il gateway risponde con errore di autenticazione senza contattare YouTube

### Requirement: Ricerca remota dal gateway
Il gateway SHALL cercare su YouTube con una query di 1–200 caratteri e restituire fino a 10 risultati con identificativo, titolo, artista/canale, durata e miniatura, escludendo le dirette. Se YouTube rifiuta la richiesta o non risponde entro 15 secondi, il gateway SHALL rispondere con un errore di servizio non disponibile che distingue il blocco anti-bot dagli altri errori.

#### Scenario: Ricerca riuscita
- **WHEN** l'utente cerca "come as you are"
- **THEN** riceve al massimo 10 risultati con titolo, artista, durata e miniatura

#### Scenario: Blocco anti-bot
- **WHEN** YouTube risponde al gateway chiedendo una verifica anti-bot
- **THEN** il gateway risponde con un errore che indica il blocco e l'app propone le alternative (file locale o ponte on-premise)

### Requirement: Metadati di un video
Il gateway SHALL restituire per un identificativo valido titolo e artista ripuliti, album se disponibile, durata, URL della copertina tramite il gateway e dimensione del flusso audio scelto. I video più lunghi di 20 minuti, le dirette e i video non disponibili MUST essere segnalati con un errore esplicito.

#### Scenario: Video troppo lungo
- **WHEN** l'utente chiede i metadati di un video di 45 minuti
- **THEN** il gateway risponde che il video supera la durata massima

### Requirement: Proxy audio in streaming
Il gateway SHALL inoltrare al client, in streaming e senza conversione, il flusso audio AAC/M4A di un video, con tipo `audio/mp4`, dimensione totale e supporto alle richieste Range, entro la durata massima della funzione. Il gateway MUST NOT salvare il file né i suoi metadati.

#### Scenario: Download completo
- **WHEN** il client richiede l'audio di un video di 4 minuti senza Range
- **THEN** riceve l'intero file M4A in streaming anche se supera 4,5 MB

#### Scenario: Riproduzione immediata con seek
- **WHEN** il player del client richiede un intervallo a metà del brano
- **THEN** il gateway risponde 206 con l'intervallo richiesto

#### Scenario: Nessuna traccia sul server
- **WHEN** termina il trasferimento di un brano
- **THEN** sul gateway non resta alcuna copia del file

### Requirement: Proxy delle copertine
Il gateway SHALL restituire la miniatura di un video dalla stessa origine dell'app, così che il client possa elaborarla (ritaglio quadrato e colore dominante) e salvarla.

#### Scenario: Copertina utilizzabile dal client
- **WHEN** il client richiede la copertina di un video tramite il gateway
- **THEN** riceve un'immagine dalla propria origine, leggibile da canvas senza restrizioni cross-origin
