# Spec Delta

## Purpose

Fornisce la riproduzione musicale dell'app: coda, controlli, mini-player e player a schermo intero, con continuità in background e controlli di sistema (lockscreen, cuffie) come in un'app nativa.

## ADDED Requirements

### Requirement: Avvio della riproduzione su gesto esplicito
La prima riproduzione di ogni sessione dell'app SHALL partire solo da un tocco esplicito dell'utente su un controllo di riproduzione. L'app MUST NOT tentare la riproduzione automatica all'avvio, nemmeno ripristinando l'ultimo brano.

#### Scenario: Ripristino all'avvio
- **WHEN** l'utente riapre l'app dopo averla chiusa durante un brano
- **THEN** il mini-player mostra l'ultimo brano in pausa alla posizione salvata e la riproduzione parte solo quando l'utente tocca Play

### Requirement: Riproduzione continua in background
La riproduzione SHALL continuare quando l'app va in background o lo schermo si blocca, e il passaggio automatico al brano successivo della coda SHALL avvenire anche in background.

#### Scenario: Schermo bloccato
- **WHEN** l'utente blocca l'iPhone durante un brano con altri brani in coda
- **THEN** il brano prosegue e al termine parte il successivo senza sbloccare il telefono

### Requirement: Coda di riproduzione
Il player SHALL gestire una coda costruita dal contesto in cui l'utente avvia un brano (playlist, preferiti, risultati, libreria), partendo dal brano toccato. L'utente SHALL poter accodare un brano come "prossimo" e vedere la coda. Coda, brano corrente e posizione SHALL essere ripristinati alla riapertura.

#### Scenario: Avvio da playlist
- **WHEN** l'utente tocca il terzo brano di una playlist da 10
- **THEN** parte il terzo brano e i successivi della coda sono i brani dal quarto al decimo

#### Scenario: Riproduci dopo
- **WHEN** l'utente sceglie "Riproduci dopo" su un brano
- **THEN** quel brano viene riprodotto subito dopo quello corrente

### Requirement: Controlli di trasporto
Il player SHALL offrire play/pausa, brano successivo, brano precedente e posizionamento a un punto qualsiasi del brano. "Precedente" SHALL riportare all'inizio del brano corrente se sono trascorsi più di 3 secondi, altrimenti al brano precedente.

#### Scenario: Precedente oltre 3 secondi
- **WHEN** l'utente tocca Precedente al secondo 40 del brano
- **THEN** il brano riparte dall'inizio

#### Scenario: Precedente entro 3 secondi
- **WHEN** l'utente tocca Precedente al secondo 2 del brano
- **THEN** parte il brano precedente della coda

### Requirement: Shuffle e Repeat
Il player SHALL offrire shuffle (ordine casuale della coda restante, mantenendo il brano corrente) e repeat a tre stati: disattivato, ripeti coda, ripeti brano. Disattivando lo shuffle SHALL tornare l'ordine originale a partire dal brano corrente.

#### Scenario: Ripeti coda
- **WHEN** termina l'ultimo brano della coda con "ripeti coda" attivo
- **THEN** la riproduzione riparte dal primo brano della coda

#### Scenario: Ripeti brano
- **WHEN** termina un brano con "ripeti brano" attivo
- **THEN** lo stesso brano riparte dall'inizio

#### Scenario: Fine coda senza repeat
- **WHEN** termina l'ultimo brano della coda con repeat disattivato
- **THEN** la riproduzione si ferma e il player resta sull'ultimo brano

### Requirement: Integrazione con i controlli di sistema
Durante la riproduzione l'app SHALL pubblicare al sistema titolo, artista, album e copertina del brano corrente, durata e posizione, e SHALL rispondere ai comandi di sistema play, pausa, successivo, precedente e posizionamento dalla lockscreen, dal centro di controllo e da cuffie/auricolari.

#### Scenario: Lockscreen iOS
- **WHEN** l'utente blocca l'iPhone durante la riproduzione
- **THEN** la lockscreen mostra copertina, titolo e artista del brano e i controlli funzionano

#### Scenario: Cuffie
- **WHEN** l'utente preme "successivo" sugli auricolari Bluetooth
- **THEN** parte il brano successivo della coda

#### Scenario: Posizione aggiornata
- **WHEN** l'utente si sposta al minuto 2 dall'app
- **THEN** la barra di avanzamento della lockscreen riflette il minuto 2

### Requirement: Mini-player
Mentre esiste un brano corrente, l'app SHALL mostrare un mini-player flottante appena sopra la Bottom Tab Bar con miniatura della copertina, titolo e artista (titolo a scorrimento orizzontale solo se non entra nello spazio), pulsante play/pausa e una barra di avanzamento sottile alla base.

#### Scenario: Titolo lungo
- **WHEN** il titolo del brano corrente è più largo dello spazio disponibile
- **THEN** il titolo scorre orizzontalmente in modo continuo

#### Scenario: Titolo corto
- **WHEN** il titolo entra nello spazio disponibile
- **THEN** il titolo resta fermo

### Requirement: Player a schermo intero
Toccando il mini-player o trascinandolo verso l'alto, l'app SHALL aprire il player a schermo intero con copertina grande con ombra morbida, sfondo sfumato derivato dal colore dominante della copertina, barra di avanzamento spessa con tempo trascorso e rimanente, controlli completi, shuffle, repeat, preferito e toggle di download locale. Trascinandolo verso il basso o con Indietro SHALL richiudersi.

#### Scenario: Apertura con swipe
- **WHEN** l'utente trascina il mini-player verso l'alto
- **THEN** il player a schermo intero si apre seguendo il dito

#### Scenario: Sfondo dalla copertina
- **WHEN** il brano corrente ha una copertina con colore dominante rosso
- **THEN** lo sfondo del player è un gradiente che parte da una tonalità di quel rosso e sfuma verso `#121212`

#### Scenario: Chiusura con Indietro
- **WHEN** il player a schermo intero è aperto e l'utente usa Indietro
- **THEN** il player si chiude e l'utente resta nella vista in cui si trovava

### Requirement: Barra di avanzamento facile da toccare
La barra di avanzamento del player a schermo intero SHALL avere un'area di tocco alta almeno 44 px, SHALL mostrare la posizione di destinazione durante il trascinamento e SHALL spostare la riproduzione solo al rilascio.

#### Scenario: Trascinamento
- **WHEN** l'utente trascina la barra dal minuto 1 al minuto 3 e rilascia
- **THEN** durante il trascinamento il tempo mostrato segue il dito e al rilascio la riproduzione riprende dal minuto 3

### Requirement: Riproduzione da locale o da rete
Il player SHALL riprodurre un brano dalla copia locale se disponibile e dallo streaming del server altrimenti, in modo trasparente per l'utente. Se un brano non è disponibile né localmente né in rete, il player SHALL mostrare un avviso e passare al brano successivo riproducibile.

#### Scenario: Brano non disponibile offline
- **WHEN** l'app è offline e il brano successivo della coda non è scaricato
- **THEN** il player mostra un avviso e salta al successivo brano scaricato della coda

### Requirement: Segnalazione degli ascolti
Il player SHALL segnalare un ascolto al raggiungimento della soglia definita dalla libreria (30 secondi o metà durata) una sola volta per riproduzione; se l'app è offline l'ascolto SHALL essere conservato sul dispositivo e inviato al ritorno della connessione.

#### Scenario: Ascolto offline conservato
- **WHEN** l'utente ascolta un brano scaricato per 2 minuti senza connessione e poi torna online
- **THEN** l'ascolto viene inviato al server con l'orario originale
