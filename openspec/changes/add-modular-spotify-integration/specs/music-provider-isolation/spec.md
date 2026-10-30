# Spec Delta

## Purpose

Permette di affiancare sorgenti musicali opzionali alla libreria personale senza trasferire ai servizi esistenti i loro requisiti, guasti o vincoli di accesso.

## ADDED Requirements

### Requirement: Attivazione opzionale delle sorgenti
Il sistema SHALL avviarsi e consentire l'uso delle funzioni esistenti anche senza configurazione Spotify o con configurazione Spotify non valida. Le funzionalità esterne SHALL esporre uno stato distinto da quello della libreria locale.

#### Scenario: Installazione senza credenziali
- **WHEN** server o gateway viene avviato senza configurazione Spotify
- **THEN** login, ricerca YouTube, libreria, importazioni e riproduzione locale mantengono il comportamento precedente
- **AND** Spotify risulta non configurato e non effettua richieste esterne

#### Scenario: Configurazione Spotify non valida
- **WHEN** la configurazione del solo modulo Spotify è incompleta o non valida
- **THEN** il sistema segnala l'indisponibilità del modulo senza impedire l'avvio delle funzioni locali

### Requirement: Identità e operazioni specifiche della sorgente
Ogni riferimento musicale multisorgente MUST identificare la sorgente e la propria identità senza collisioni. Le operazioni disponibili SHALL dipendere dalla sorgente e dalla sua disponibilità; un riferimento Spotify MUST NOT essere presentato come un file locale.

#### Scenario: Identificativi uguali
- **WHEN** un file locale e un brano Spotify hanno la stessa stringa identificativa
- **THEN** playlist, coda e comandi li trattano come due elementi distinti

#### Scenario: Operazioni su brano Spotify
- **WHEN** viene aperto il menu di un brano Spotify
- **THEN** non sono disponibili download offline, modifica dei tag, trim del silenzio o ricerca di una copia YouTube basata sui dati Spotify

### Requirement: Errori confinati al provider
Timeout, risposte incompatibili, revoche, limiti e guasti Spotify MUST NOT invalidare la sessione Spookyfy, dichiarare tutta l'app offline o bloccare le operazioni locali. Le richieste Spotify SHALL avere durata e tentativi limitati, con esiti distinguibili dall'assenza di risultati.

#### Scenario: Revoca Spotify durante una ricerca
- **WHEN** Spotify rifiuta il token mentre la sessione Spookyfy è valida
- **THEN** solo Spotify richiede il ricollegamento e l'utente continua a usare la propria libreria

#### Scenario: Quota o servizio indisponibile
- **WHEN** Spotify risponde con 429, 5xx, timeout o dati non interpretabili
- **THEN** l'app mostra uno stato specifico per Spotify e le ricerche locali e YouTube restano utilizzabili

### Requirement: Contenuti Spotify separati dai media posseduti
Il sistema MUST NOT scaricare, memorizzare offline, esportare come audio, transcodificare o analizzare l'audio Spotify. Eventuali metadati conservati SHALL essere personali, limitati alla funzione e cancellabili separatamente dai file locali.

#### Scenario: Scaricamento di una raccolta mista
- **WHEN** l'utente richiede di scaricare una raccolta contenente riferimenti locali e Spotify
- **THEN** il sistema considera soltanto i file locali idonei e indica quanti elementi Spotify restano disponibili solo online

### Requirement: Rilascio subordinato alla compatibilità con Spotify
Le funzioni integrate e ibride soggette ai vincoli della piattaforma SHALL restare disattivate con Spotify reale fino alla risoluzione documentata del vincolo. I test simulati SHALL poter verificarle senza credenziali personali; l'assenza di tale risoluzione MUST NOT compromettere il rilascio della parte locale.

#### Scenario: Vincolo esterno irrisolto
- **WHEN** la compatibilità dell'uso integrato con la policy Spotify non è stata chiarita
- **THEN** il sistema non abilita l'integrazione reale e i test usano esclusivamente provider simulati
