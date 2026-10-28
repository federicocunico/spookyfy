# Spec Delta

## MODIFIED Requirements

### Requirement: Tutte le risorse private richiedono autenticazione
Ogni endpoint API, lo streaming audio, le copertine e il canale in tempo reale MUST rifiutare richieste senza una sessione valida o senza un token di accesso personale valido. Solo i file statici della PWA (app shell, manifest, icone), la health check e gli endpoint di login e registrazione SHALL essere accessibili senza autenticazione. Il canale in tempo reale SHALL accettare solo la sessione via cookie.

#### Scenario: Audio senza sessione
- **WHEN** un client senza cookie di sessione e senza token di accesso richiede il file audio di un brano
- **THEN** il sistema risponde con errore di autenticazione senza inviare dati audio

#### Scenario: Audio con token di accesso
- **WHEN** un client senza cookie ma con un token di accesso personale valido richiede il file audio di un brano
- **THEN** il sistema restituisce l'audio

#### Scenario: Canale in tempo reale senza sessione
- **WHEN** un client senza sessione valida tenta di aprire il canale in tempo reale
- **THEN** la connessione viene rifiutata

#### Scenario: App shell accessibile
- **WHEN** un client senza sessione richiede la pagina principale della PWA
- **THEN** il sistema restituisce l'app shell, che mostra la schermata di login

### Requirement: Protezione delle richieste che modificano dati
Il sistema MUST rifiutare ogni richiesta che modifica dati (registrazione, creazione, aggiornamento, eliminazione, avvio di download) autenticata tramite cookie di sessione, o non autenticata, se l'header Origin non corrisponde all'origine pubblica configurata per l'app. Le richieste autenticate con un token di accesso personale, che il browser non allega automaticamente, SHALL essere esentate da questo controllo.

#### Scenario: Richiesta cross-origin
- **WHEN** una pagina su un altro dominio invia una richiesta di creazione playlist usando il cookie dell'utente
- **THEN** il sistema rifiuta la richiesta e nessuna playlist viene creata

#### Scenario: Richiesta dall'app
- **WHEN** l'app, dalla propria origine, invia una richiesta di creazione playlist
- **THEN** la playlist viene creata

#### Scenario: Richiesta con token di accesso da un'altra origine
- **WHEN** un'app in modalità client su un'altra origine avvia un'importazione con un token di accesso valido e senza cookie
- **THEN** il sistema accetta la richiesta
