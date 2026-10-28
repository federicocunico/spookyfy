# Spec Delta

## Purpose

Definisce il contenitore dell'app: installabilità come PWA, navigazione a pagina singola che non interrompe mai la musica, struttura a tab e linguaggio visivo "Spookyfy" percepito come nativo.

## ADDED Requirements

### Requirement: Installabilità come PWA
L'app SHALL essere installabile sulla schermata Home di iOS e Android e SHALL aprirsi in modalità standalone, senza barra del browser, con nome "Spookyfy", icone dedicate (incluse le icone Apple touch e maskable), colore tema e colore di sfondo `#121212`.

#### Scenario: Installazione su iOS
- **WHEN** l'utente usa "Aggiungi a schermata Home" da Safari
- **THEN** sulla Home compare l'icona Spookyfy e l'app si apre a schermo intero senza interfaccia del browser

#### Scenario: Installazione su Android
- **WHEN** l'utente apre l'app in Chrome Android
- **THEN** il browser offre l'installazione e l'app installata si apre in modalità standalone

### Requirement: Avvio offline dell'app shell
L'app shell (HTML, codice, stili, font, icone) SHALL essere disponibile offline dopo il primo caricamento. Quando è disponibile una nuova versione, l'app SHALL aggiornarsi senza interrompere la riproduzione in corso, applicando l'aggiornamento al successivo avvio o su conferma dell'utente.

#### Scenario: Avvio in modalità aereo
- **WHEN** l'utente apre l'app installata senza connessione
- **THEN** l'interfaccia si carica e mostra la libreria disponibile offline

#### Scenario: Aggiornamento durante l'ascolto
- **WHEN** viene pubblicata una nuova versione mentre l'utente sta ascoltando musica
- **THEN** la riproduzione non si interrompe e l'utente vede un avviso per aggiornare

### Requirement: Navigazione a pagina singola
L'app SHALL essere una Single Page Application: passare fra le viste (Home, Cerca, Libreria, playlist, impostazioni) MUST NOT ricaricare la pagina né interrompere la riproduzione. Ogni vista SHALL avere un URL proprio e i gesti/tasto Indietro del sistema SHALL tornare alla vista precedente.

#### Scenario: Cambio vista durante la riproduzione
- **WHEN** l'utente passa da Home a Cerca a Libreria mentre un brano è in riproduzione
- **THEN** l'audio continua senza interruzioni né salti

#### Scenario: Indietro
- **WHEN** l'utente apre una playlist dalla Libreria e usa il gesto Indietro
- **THEN** l'app torna alla Libreria mantenendo la posizione di scorrimento

#### Scenario: Apertura diretta di un URL
- **WHEN** l'utente apre direttamente l'URL di una playlist
- **THEN** l'app si carica mostrando quella playlist

### Requirement: Bottom Tab Bar
L'app SHALL mostrare una barra di navigazione fissa in basso con le voci Home, Cerca e La tua Libreria, con sfondo semitrasparente sfocato, evidenziazione della voce attiva con il colore di accento e rispetto dell'area sicura inferiore del dispositivo.

#### Scenario: Tab attiva
- **WHEN** l'utente si trova nella vista Cerca
- **THEN** la voce Cerca è evidenziata con il colore di accento

#### Scenario: Area sicura su iPhone
- **WHEN** l'app gira su un iPhone con indicatore Home
- **THEN** la barra non è sovrapposta all'indicatore e le voci sono interamente toccabili

### Requirement: Schermate di accesso e registrazione
Senza una sessione valida l'app SHALL mostrare una schermata di login con lo stile Spookyfy e un collegamento alla schermata di registrazione (username, password, conferma password, token di invito). Dopo login o registrazione l'app SHALL portare l'utente alla vista inizialmente richiesta. Gli errori del server SHALL essere mostrati accanto al campo interessato.

#### Scenario: Sessione scaduta su un link diretto
- **WHEN** l'utente con sessione scaduta apre l'URL di una playlist ed effettua il login
- **THEN** l'app mostra quella playlist

#### Scenario: Passaggio alla registrazione
- **WHEN** l'utente tocca "Crea un account" nella schermata di login
- **THEN** l'app mostra il modulo di registrazione con il campo per il token di invito

#### Scenario: Conferma password diversa
- **WHEN** l'utente compila password e conferma password con valori diversi
- **THEN** il pulsante di registrazione resta disabilitato e l'app indica che le password non coincidono

#### Scenario: Username non disponibile
- **WHEN** il server risponde che lo username non è disponibile
- **THEN** l'app mostra l'errore sotto il campo username mantenendo gli altri valori inseriti

### Requirement: Design system Spookyfy
L'interfaccia SHALL usare sfondo `#121212`, superfici in elevazione fra `#181818` e `#282828` e colore di accento `#FF5F1F` per bottoni Play, toggle attivi e focus. Tutti i colori SHALL essere definiti come token riutilizzabili. Il testo principale MUST avere un contrasto di almeno 4.5:1 rispetto allo sfondo.

#### Scenario: Bottone Play
- **WHEN** l'utente visualizza una playlist
- **THEN** il bottone Play principale usa il colore di accento

#### Scenario: Focus da tastiera
- **WHEN** un elemento interattivo riceve il focus da tastiera
- **THEN** l'elemento mostra un indicatore di focus visibile nel colore di accento

### Requirement: Stabilità visiva
L'interfaccia MUST NOT presentare spostamenti di layout durante il caricamento: immagini e liste SHALL occupare lo spazio finale fin dal primo frame (dimensioni riservate e segnaposto), e i colori di sfondo dipendenti dalla copertina SHALL essere disponibili insieme ai metadati del brano.

#### Scenario: Caricamento di una lista
- **WHEN** l'utente apre la Libreria con connessione lenta
- **THEN** vengono mostrati segnaposto delle stesse dimensioni delle righe finali e il contenuto li sostituisce senza spostare gli altri elementi

### Requirement: Indicatore di connessione
L'app SHALL indicare in modo non invasivo quando è offline e SHALL disabilitare o nascondere le azioni che richiedono il server (ricerca remota, importazione, modifica di playlist), mantenendo disponibili quelle offline.

#### Scenario: Passaggio offline
- **WHEN** la connessione cade mentre l'utente è nella vista Cerca
- **THEN** l'app mostra un avviso "Sei offline" e la ricerca remota risulta non disponibile, mentre i brani scaricati restano riproducibili
