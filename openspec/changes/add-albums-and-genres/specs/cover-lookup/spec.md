# Spec Delta

## Purpose

Trova copertine e metadati di album su database musicali pubblici a partire da titolo del brano, artista e album, per completare il catalogo senza inserire tutto a mano.

## ADDED Requirements

### Requirement: Ricerca online su database pubblici
Il sistema SHALL cercare album su database musicali pubblici gratuiti e senza chiave (MusicBrainz con Cover Art Archive, iTunes Search come riserva) a partire da titolo dell'album e artista, oppure da titolo del brano e artista. Ogni candidato SHALL riportare titolo, artista, anno se noto, generi se noti, sorgente e anteprima della copertina; al massimo 10 candidati, i più pertinenti per primi.

#### Scenario: Ricerca da un album
- **WHEN** l'utente cerca la copertina dell'album "Nevermind" di "Nirvana"
- **THEN** l'app mostra i candidati con anteprima, anno e sorgente, con "Nevermind" di "Nirvana" fra i primi

#### Scenario: Ricerca da un brano senza album
- **WHEN** l'utente cerca online un brano "Smells Like Teen Spirit" di "Nirvana" che non appartiene ad alcun album
- **THEN** l'app propone gli album che contengono quel brano

### Requirement: Richieste solo dal backend
Le richieste ai database musicali MUST partire dal server on-premise o dal gateway, mai direttamente dal browser, rispettare i limiti di frequenza dei servizi (per MusicBrainz al massimo una richiesta al secondo per istanza) e identificarsi con un User-Agent dell'app. Le immagini SHALL arrivare al client dalla stessa origine dell'app.

#### Scenario: Molte ricerche ravvicinate
- **WHEN** arrivano 5 ricerche nello stesso secondo
- **THEN** le richieste a MusicBrainz vengono distanziate di almeno un secondo e nessuna ricerca fallisce per questo

### Requirement: Applicazione di un candidato
Scegliendo un candidato, l'utente SHALL poter applicare all'album la copertina e, a scelta, titolo, artista, anno e generi proposti. Per un brano senza album, applicare un candidato SHALL inserire il brano nell'album corrispondente, creandolo se serve. La copertina SHALL essere scaricata e salvata nel catalogo, così da restare disponibile senza connessione.

#### Scenario: Solo copertina
- **WHEN** l'utente applica la copertina di un candidato lasciando deselezionati gli altri campi
- **THEN** l'album ha la nuova copertina e titolo, artista, anno e generi restano invariati

#### Scenario: Copertina offline
- **WHEN** l'utente, dopo aver applicato una copertina, apre l'album in modalità aereo
- **THEN** l'album mostra la copertina applicata

### Requirement: Ricerca automatica per album senza copertina
Quando nasce un album senza copertina assegnata, il sistema SHALL cercarne una automaticamente e applicarla solo se il miglior candidato ha titolo e artista equivalenti a quelli dell'album (senza maiuscole, accenti, punteggiatura e diciture come "Remastered" o "Deluxe"). Senza corrispondenza sicura l'album MUST restare invariato. Ogni album SHALL essere cercato automaticamente al massimo una volta.

#### Scenario: Corrispondenza sicura
- **WHEN** l'importazione crea l'album "OK Computer" di "Radiohead" e la ricerca trova "OK Computer" di "Radiohead"
- **THEN** l'album riceve quella copertina senza intervento dell'utente

#### Scenario: Nessuna corrispondenza sicura
- **WHEN** la ricerca per l'album "Demo 2026" di "Band del garage" trova solo album con altri titoli
- **THEN** l'album mantiene la copertina del primo brano e non viene ricercato di nuovo in automatico

### Requirement: Ricerca automatica sugli album esistenti
Dopo l'aggiornamento, il sistema SHALL eseguire in background la ricerca automatica per gli album senza copertina assegnata, uno alla volta e senza rallentare riproduzione e importazioni; SHALL interrompersi dopo ripetuti errori di rete o di servizio e riprendere all'avvio successivo.

#### Scenario: Servizio irraggiungibile
- **WHEN** i database musicali non rispondono durante la ricerca in background
- **THEN** la ricerca si interrompe, la libreria resta utilizzabile e gli album non ancora cercati vengono ripresi al prossimo avvio

### Requirement: Errori della ricerca online
Se la ricerca online fallisce per rete o servizio non disponibile, l'app SHALL mostrare un messaggio comprensibile e consentire di riprovare; un risultato vuoto SHALL essere indicato come tale, senza errori.

#### Scenario: Senza connessione
- **WHEN** l'utente avvia una ricerca di copertine senza connessione
- **THEN** l'app spiega che la ricerca online richiede la connessione e la copertina resta invariata

### Requirement: Interruttore della ricerca online
Le Impostazioni SHALL offrire l'interruttore "Cerca copertine online", attivo per impostazione predefinita, con la spiegazione dei dati inviati (titolo, artista, album) e dei servizi usati. Con l'interruttore spento il sistema MUST NOT inviare alcuna richiesta ai database musicali, né automatica né manuale. On-premise l'impostazione SHALL valere per l'intero server.

#### Scenario: Ricerca disattivata
- **WHEN** l'utente spegne "Cerca copertine online" e importa un brano con un album nuovo
- **THEN** nessuna richiesta parte verso i database musicali e l'azione di ricerca manuale non è disponibile
