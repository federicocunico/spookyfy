# Spec Delta

## Purpose

Organizza i brani della libreria in album con titolo, artista, anno, copertina e ordine dei brani, come categoria del catalogo separata dalle playlist, in modalità on-premise e client.

## ADDED Requirements

### Requirement: Album nel catalogo
Il sistema SHALL mantenere gli album come elementi del catalogo, con identificativo, titolo (1–200 caratteri), artista dell'album, anno opzionale, copertina e brani ordinati. Un brano MUST appartenere al massimo a un album. On-premise gli album SHALL essere condivisi da tutti gli account, come i brani; in modalità client SHALL vivere solo sul dispositivo.

#### Scenario: Album visibile a tutti gli account
- **WHEN** `fede` crea l'album "Nevermind" sul server on-premise
- **THEN** l'album compare anche nella libreria di `anna`

#### Scenario: Un solo album per brano
- **WHEN** l'utente aggiunge all'album B un brano che fa parte dell'album A
- **THEN** il brano esce da A ed entra in B

### Requirement: Album indipendenti dalle playlist
Album e playlist SHALL essere categorie separate: aggiungere, togliere o riordinare brani in un album MUST NOT modificare alcuna playlist, e viceversa. Gli album MUST NOT comparire nell'elenco delle playlist.

#### Scenario: Riordino dell'album
- **WHEN** l'utente cambia l'ordine dei brani di un album presente anche in una playlist
- **THEN** l'ordine della playlist resta invariato

### Requirement: Raggruppamento automatico all'importazione
Quando un brano importato ha un album nei metadati, il sistema SHALL inserirlo nell'album con lo stesso titolo e artista dell'album (confronto senza maiuscole, accenti e spazi superflui), creandolo se non esiste, nella posizione indicata dal numero di traccia se presente, altrimenti in coda. Senza artista dell'album SHALL valere l'artista del brano.

#### Scenario: Due brani dello stesso disco
- **WHEN** l'utente importa due file con album "In Utero", artista "Nirvana" e numeri di traccia 2 e 1
- **THEN** la libreria contiene un solo album "In Utero" con i due brani nell'ordine 1, 2

#### Scenario: Brano senza album
- **WHEN** l'utente importa un brano senza album nei metadati
- **THEN** il brano non appartiene ad alcun album

### Requirement: Raggruppamento dei brani esistenti
All'aggiornamento dell'app o del server, i brani già in libreria con un album nei metadati SHALL essere raggruppati in album con le stesse regole dell'importazione, una sola volta e senza perdere brani, preferiti o playlist.

#### Scenario: Libreria esistente
- **WHEN** il server viene aggiornato con 3 brani che hanno album "OK Computer" e artista "Radiohead"
- **THEN** dopo l'avvio esiste l'album "OK Computer" con i 3 brani e le playlist sono invariate

### Requirement: Campo album del brano
Il campo album di un brano SHALL riportare il titolo del suo album. Modificare il campo album di un brano SHALL spostarlo nell'album corrispondente, creandolo se serve; svuotarlo SHALL toglierlo dall'album.

#### Scenario: Correzione dell'album
- **WHEN** l'utente cambia l'album di un brano da "Nevermind (Remastered)" a "Nevermind"
- **THEN** il brano fa parte dell'album "Nevermind" e non più del precedente

### Requirement: Gestione manuale degli album
L'utente autenticato SHALL poter creare un album, cambiarne titolo, artista e anno, aggiungere e togliere brani e cambiarne l'ordine. Un titolo vuoto o più lungo di 200 caratteri, o un anno fuori dall'intervallo 1000–2100, MUST essere rifiutato con un errore di validazione.

#### Scenario: Creazione e aggiunta
- **WHEN** l'utente crea l'album "Demo 2026" e vi aggiunge 3 brani
- **THEN** l'album contiene i 3 brani nell'ordine di aggiunta

#### Scenario: Riordino
- **WHEN** l'utente sposta l'ultimo brano dell'album in prima posizione
- **THEN** l'album restituisce i brani nel nuovo ordine

#### Scenario: Titolo non valido
- **WHEN** l'utente prova a salvare un album con titolo vuoto
- **THEN** il sistema risponde con errore di validazione e l'album resta invariato

### Requirement: Eliminazione di un album
L'eliminazione di un album SHALL rimuovere l'album e la sua copertina assegnata, lasciando in libreria i brani, che non appartengono più ad alcun album. Un album rimasto senza brani SHALL essere eliminato automaticamente se era stato creato dal raggruppamento automatico, e mantenuto se creato dall'utente.

#### Scenario: Eliminazione
- **WHEN** l'utente elimina un album con 10 brani
- **THEN** i 10 brani restano in libreria, nelle playlist e nei preferiti, senza album

#### Scenario: Album automatico svuotato
- **WHEN** l'ultimo brano di un album creato automaticamente viene eliminato dalla libreria
- **THEN** l'album sparisce dall'elenco degli album

### Requirement: Copertina dell'album
La copertina di un album SHALL essere, nell'ordine: quella assegnata dall'utente (immagine dal dispositivo o risultato della ricerca online), altrimenti quella del primo brano. Le immagini assegnate SHALL essere ritagliate quadrate, salvate in versione grande e miniatura con il colore dominante; formati non immagine o file oltre 10 MB MUST essere rifiutati.

#### Scenario: Immagine dal dispositivo
- **WHEN** l'utente sceglie una foto rettangolare dal telefono come copertina di un album
- **THEN** l'album mostra la foto ritagliata quadrata, anche senza connessione

#### Scenario: Nessuna copertina assegnata
- **WHEN** un album non ha copertina assegnata
- **THEN** l'album mostra la copertina del suo primo brano

#### Scenario: File non valido
- **WHEN** l'utente sceglie un PDF come copertina
- **THEN** l'app rifiuta il file con un messaggio e la copertina resta invariata

### Requirement: Copertina dell'album sui brani
Quando un album ha una copertina assegnata, tutti i suoi brani SHALL mostrarla al posto della propria in liste, player e controlli di sistema, insieme al colore dominante dell'album. Un brano tolto dall'album, o un album la cui copertina assegnata viene rimossa, SHALL tornare alla copertina originale del brano.

#### Scenario: Copertina ufficiale
- **WHEN** l'utente assegna una copertina all'album di un brano importato da YouTube
- **THEN** il player e la schermata di blocco mostrano la copertina dell'album invece della miniatura del video

#### Scenario: Brano tolto dall'album
- **WHEN** l'utente toglie quel brano dall'album
- **THEN** il brano torna a mostrare la miniatura originale

### Requirement: Vista Album
La Libreria SHALL offrire una sezione "Album", separata dalle playlist, con l'elenco degli album (copertina, titolo, artista) ordinabile per titolo, artista o data di aggiunta. La pagina di un album SHALL mostrare copertina, titolo, artista, anno, durata totale e brani nell'ordine dell'album, con riproduzione dall'inizio, riproduzione casuale e modifica.

#### Scenario: Apertura di un album
- **WHEN** l'utente apre l'album "In Utero" dalla sezione Album
- **THEN** vede i brani nell'ordine dell'album e può avviarne la riproduzione dal primo

#### Scenario: Libreria senza album
- **WHEN** nessun brano appartiene a un album
- **THEN** la sezione Album spiega come crearne uno

### Requirement: Album nella ricerca locale
La ricerca nella libreria SHALL restituire anche gli album il cui titolo o artista corrisponde per prefisso, con le stesse regole di normalizzazione della ricerca dei brani.

#### Scenario: Ricerca di un album
- **WHEN** l'utente cerca "nevermi"
- **THEN** l'album "Nevermind" compare fra i risultati

### Requirement: Tag dei file on-premise
On-premise, quando cambiano album, artista dell'album, posizione o generi di un brano, il sistema SHALL riscrivere nei tag del file album, artista dell'album, numero di traccia e generi. Un errore di scrittura dei tag MUST NOT annullare la modifica nel catalogo.

#### Scenario: Spostamento in un album
- **WHEN** l'utente aggiunge un brano in seconda posizione nell'album "Demo 2026"
- **THEN** i tag del file riportano album "Demo 2026" e traccia numero 2
