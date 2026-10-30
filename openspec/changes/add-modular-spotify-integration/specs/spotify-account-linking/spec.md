# Spec Delta

## Purpose

Collega in modo facoltativo un'identità Spotify a un account Spookyfy esistente, mantenendo indipendenti autenticazione locale, autorizzazioni esterne e ciclo di vita dei dati.

## ADDED Requirements

### Requirement: Linking successivo alla creazione dell'account
Il sistema MUST consentire il linking solo a un utente con account Spookyfy esistente e sessione browser valida. Il flusso Spotify MUST NOT creare account Spookyfy, effettuare login Spookyfy o modificare password, inviti e identità locale.

#### Scenario: Visitatore non autenticato
- **WHEN** un visitatore tenta di iniziare o completare il linking senza sessione Spookyfy valida
- **THEN** nessun collegamento o account viene creato e il sistema richiede il login locale

#### Scenario: Utente appena registrato
- **WHEN** un utente completa la registrazione Spookyfy e sceglie Collega Spotify dalle impostazioni
- **THEN** può autorizzare Spotify come passaggio distinto e facoltativo

### Requirement: Autorizzazione legata alla sessione di origine
Ogni autorizzazione MUST essere protetta contro falsificazione, riuso e scambio del codice. Il completamento MUST verificare l'identità e la sessione che hanno avviato il flusso, la scadenza della richiesta e il redirect registrato prima di salvare il collegamento.

#### Scenario: Callback contraffatta o riutilizzata
- **WHEN** una callback ha stato mancante, errato, scaduto o già utilizzato
- **THEN** il sistema rifiuta il collegamento senza salvare token o modificare un collegamento esistente

#### Scenario: Cambio account durante il flusso
- **WHEN** l'utente avvia il flusso come A e completa la callback dopo essere uscito o entrato come B
- **THEN** il sistema rifiuta il completamento e non collega Spotify ad A o B

#### Scenario: Consenso negato
- **WHEN** l'utente nega l'autorizzazione su Spotify
- **THEN** torna alle impostazioni con un esito comprensibile e l'eventuale collegamento precedente resta valido

### Requirement: Identità stabile e consenso alle capacità
L'associazione MUST utilizzare l'identificatore Spotify stabile documentato per il linking, senza dedurla da email o nome. Ogni account Spookyfy SHALL avere al massimo un account Spotify collegato e un'identità Spotify MUST NOT essere riassegnata silenziosamente tra account locali. Gli scope SHALL essere limitati alle funzioni richieste.

#### Scenario: Nome Spotify modificato
- **WHEN** l'utente modifica nome visualizzato o identificatore pubblico mutabile su Spotify
- **THEN** il collegamento continua a riferirsi allo stesso account stabile

#### Scenario: Account già associato
- **WHEN** una seconda identità Spookyfy tenta di collegare un account Spotify già collegato nella stessa installazione
- **THEN** il sistema rifiuta il nuovo collegamento senza rivelare il proprietario precedente

#### Scenario: Funzione con scope aggiuntivo
- **WHEN** l'utente richiede una modifica playlist non coperta dal consenso corrente
- **THEN** l'app richiede un'autorizzazione aggiuntiva esplicita senza invalidare le funzioni già autorizzate

### Requirement: Stato Premium ed errori di accesso distinti
Dopo il linking il sistema SHALL mostrare se la riproduzione Spotify è disponibile, richiede Premium o non è ancora verificabile. L'assenza di informazioni sull'abbonamento MUST NOT essere interpretata come Premium o Free. Errori di scope, quota, allowlist, dispositivo o browser MUST NOT essere etichettati come mancanza di Premium.

#### Scenario: Abbonamento non Premium verificato
- **WHEN** un'informazione attendibile del profilo o un errore specifico del player conferma l'assenza di Premium
- **THEN** l'app avvisa che la riproduzione Spotify non funzionerà con quell'abbonamento e lascia utilizzabili le funzioni locali

#### Scenario: Abbonamento non esposto
- **WHEN** il profilo collegato non espone il tipo di abbonamento e il player non è stato verificato
- **THEN** l'app mostra Premium richiesto e verifica non disponibile, senza dichiarare che l'account sia Free

### Requirement: Custodia e rinnovo delle credenziali
Refresh token e altri segreti persistenti MUST restare protetti sul backend e assenti da backup, log e storage browser. Solo un access token temporaneo necessario al player SHALL essere consegnato al browser autenticato senza caching. Scadenza o revoca Spotify SHALL richiedere il ricollegamento senza disconnettere Spookyfy.

#### Scenario: Rinnovi concorrenti
- **WHEN** due richieste tentano di rinnovare lo stesso collegamento contemporaneamente
- **THEN** il sistema conserva un insieme coerente di credenziali e non perde un eventuale refresh token aggiornato

#### Scenario: Revoca o scadenza definitiva
- **WHEN** Spotify rifiuta definitivamente il rinnovo
- **THEN** il collegamento richiede una nuova autorizzazione e nessuna richiesta continua a riprovare indefinitamente

### Requirement: Disconnessione e separazione degli account
La disconnessione SHALL eliminare credenziali, dati personali Spotify e cache del collegamento, interrompere le sue attività e rimuovere i suoi riferimenti dalle collezioni locali senza eliminare file locali. Logout e cambio utente SHALL rimuovere dal browser token e stato Spotify dell'utente uscente, mantenendo il collegamento backend fino alla disconnessione esplicita.

#### Scenario: Disconnessione esplicita
- **WHEN** l'utente scollega Spotify dalle impostazioni
- **THEN** non partono più richieste per quel collegamento, i dati Spotify sono rimossi e libreria, ordine relativo dei file locali e audio locali restano integri

#### Scenario: Altro utente sul dispositivo
- **WHEN** un secondo utente entra dopo il logout del primo
- **THEN** non vede token, playlist remote o riferimenti personali Spotify del primo utente
