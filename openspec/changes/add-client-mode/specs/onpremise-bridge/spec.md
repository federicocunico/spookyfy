# Spec Delta

## Purpose

Permette a un'app in modalità client di usare un server on-premise, che scarica da un IP domestico, come ponte per l'importazione dei brani, in modo autenticato e limitato alle origini autorizzate.

## ADDED Requirements

### Requirement: Token di accesso personali
Un utente del server on-premise SHALL poter creare, elencare e revocare token di accesso personali con un nome, dalle impostazioni dell'app on-premise o dalla riga di comando. Il token SHALL essere mostrato una sola volta alla creazione e MUST essere salvato sul server solo come hash. Un token SHALL agire con i permessi del suo utente.

#### Scenario: Creazione del token
- **WHEN** l'utente crea il token "iPhone client"
- **THEN** il token viene mostrato una sola volta e compare nell'elenco con nome e data di creazione

#### Scenario: Revoca
- **WHEN** l'utente revoca un token
- **THEN** le richieste successive con quel token vengono rifiutate

### Requirement: Endpoint utilizzabili con token
Con un token di accesso valido, inviato nell'header Authorization, SHALL essere utilizzabili la ricerca remota, la richiesta di importazione, la consultazione dei job, la lettura dei metadati dei brani, l'audio e le copertine. Le operazioni di gestione account e token MUST richiedere la sessione via cookie.

#### Scenario: Importazione con token
- **WHEN** l'app in modalità client richiede l'importazione di un video con un token valido
- **THEN** il server crea il job e l'app può seguirne lo stato con lo stesso token

#### Scenario: Creazione di token con un token
- **WHEN** una richiesta autenticata solo con un token tenta di creare un nuovo token
- **THEN** il server rifiuta la richiesta

### Requirement: CORS per origini autorizzate
Il server on-premise SHALL consentire richieste cross-origin solo dalle origini configurate come autorizzate per il ponte e solo per gli endpoint utilizzabili con token, senza consentire l'invio di cookie. Senza origini configurate il ponte MUST essere disabilitato.

#### Scenario: Origine autorizzata
- **WHEN** l'app servita da un'origine autorizzata invia una richiesta con token
- **THEN** il browser riceve gli header CORS e la richiesta va a buon fine

#### Scenario: Origine non autorizzata
- **WHEN** una pagina su un'origine non autorizzata invia una richiesta con token
- **THEN** il server non concede l'accesso cross-origin

### Requirement: Limite ai tentativi con token
Il server SHALL limitare a 20 ogni 15 minuti per IP le richieste con token non valido, rifiutando le successive con errore di troppe richieste.

#### Scenario: Token indovinati
- **WHEN** dallo stesso IP arrivano 21 richieste con token non validi in 15 minuti
- **THEN** la ventunesima viene rifiutata con errore di troppe richieste
