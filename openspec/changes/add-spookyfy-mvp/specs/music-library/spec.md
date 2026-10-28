# Spec Delta

## Purpose

Organizza i brani presenti sul server in una libreria consultabile e ricercabile, con preferiti, playlist e storico ascolti per utente, base per le viste dell'app e per le future regole di pulizia.

## ADDED Requirements

### Requirement: Catalogo condiviso dei brani
Il sistema SHALL mantenere un unico catalogo di brani condiviso da tutti gli account. Ogni brano SHALL esporre identificativo, titolo, artista, album (opzionale), durata, dimensione del file, colore dominante, data di aggiunta e URL di audio e copertina. L'elenco SHALL essere paginato e ordinabile per data di aggiunta, titolo o artista.

#### Scenario: Elenco paginato
- **WHEN** la libreria contiene 120 brani e il client chiede la prima pagina da 50 ordinata per data di aggiunta decrescente
- **THEN** il sistema restituisce i 50 brani più recenti e un riferimento per la pagina successiva

#### Scenario: Brano visibile a tutti gli account
- **WHEN** l'utente `fede` importa un brano
- **THEN** il brano compare anche nella libreria dell'utente `anna`

### Requirement: Ricerca locale
Il sistema SHALL permettere la ricerca testuale nel catalogo su titolo, artista e album, senza distinzione fra maiuscole e minuscole e con corrispondenza per prefisso delle parole.

#### Scenario: Ricerca per prefisso
- **WHEN** l'utente cerca "nirv" e la libreria contiene un brano dell'artista "Nirvana"
- **THEN** il brano compare nei risultati

#### Scenario: Nessun risultato
- **WHEN** l'utente cerca un testo che non corrisponde ad alcun brano
- **THEN** il sistema restituisce un elenco vuoto senza errori

### Requirement: Modifica dei metadati
Il sistema SHALL permettere a un utente autenticato di correggere titolo, artista e album di un brano; la modifica SHALL essere visibile a tutti gli account e riscritta nei tag ID3 del file.

#### Scenario: Correzione del titolo
- **WHEN** l'utente cambia il titolo di un brano da "Song (Official Video)" a "Song"
- **THEN** la libreria e i tag ID3 del file riportano il titolo "Song"

### Requirement: Eliminazione di un brano
Il sistema SHALL permettere di eliminare un brano dalla libreria; il file audio e la copertina MUST essere rimossi dal disco e il brano MUST sparire da preferiti e playlist di tutti gli utenti.

#### Scenario: Eliminazione
- **WHEN** l'utente elimina un brano presente in due playlist
- **THEN** il brano non compare più nel catalogo né nelle playlist e i suoi file non sono più sul disco

### Requirement: Preferiti
Ogni utente SHALL poter aggiungere e rimuovere brani dai propri preferiti ("Brani che ti piacciono"). I preferiti MUST essere personali per account e l'elenco SHALL essere ordinato dal più recente.

#### Scenario: Aggiunta ai preferiti
- **WHEN** l'utente tocca il cuore su un brano
- **THEN** il brano compare in cima ai suoi preferiti

#### Scenario: Preferiti personali
- **WHEN** `fede` aggiunge un brano ai preferiti
- **THEN** il brano non compare nei preferiti di `anna`

### Requirement: Playlist
Ogni utente SHALL poter creare, rinominare ed eliminare playlist proprie, aggiungere e rimuovere brani e cambiarne l'ordine. Lo stesso brano MAY comparire più volte nella stessa playlist. Le playlist MUST essere visibili e modificabili solo dal proprietario. Il nome MUST essere non vuoto e lungo al massimo 100 caratteri.

#### Scenario: Creazione e aggiunta
- **WHEN** l'utente crea la playlist "Notte" e vi aggiunge 3 brani
- **THEN** la playlist "Notte" contiene i 3 brani nell'ordine di aggiunta

#### Scenario: Riordino
- **WHEN** l'utente sposta l'ultimo brano della playlist in prima posizione
- **THEN** la playlist restituisce i brani nel nuovo ordine

#### Scenario: Accesso a playlist altrui
- **WHEN** `anna` richiede una playlist di proprietà di `fede`
- **THEN** il sistema risponde come se la playlist non esistesse

#### Scenario: Nome non valido
- **WHEN** l'utente prova a creare una playlist con nome vuoto
- **THEN** il sistema risponde con errore di validazione

### Requirement: Registrazione degli ascolti
Il sistema SHALL registrare un ascolto per utente e brano quando il brano è stato riprodotto per almeno 30 secondi o per almeno metà della sua durata, se più corto. Ogni ascolto SHALL riportare il momento in cui è avvenuto. Il sistema SHALL esporre per ogni brano il numero di ascolti e la data dell'ultimo ascolto dell'utente.

#### Scenario: Ascolto conteggiato
- **WHEN** l'utente ascolta un brano di 3 minuti per 45 secondi
- **THEN** viene registrato un ascolto e la data dell'ultimo ascolto del brano viene aggiornata

#### Scenario: Ascolto troppo breve
- **WHEN** l'utente salta un brano di 3 minuti dopo 10 secondi
- **THEN** non viene registrato alcun ascolto

### Requirement: Ascolti registrati offline
Il sistema SHALL accettare ascolti avvenuti in passato, inviati in blocco dal client al ritorno della connessione, mantenendo il momento originale. Ascolti duplicati inviati più volte MUST essere conteggiati una sola volta.

#### Scenario: Sincronizzazione al ritorno online
- **WHEN** l'utente ascolta 4 brani offline e poi l'app torna online
- **THEN** il server registra 4 ascolti con gli orari in cui sono avvenuti

#### Scenario: Invio ripetuto
- **WHEN** il client reinvia lo stesso blocco di ascolti dopo un timeout
- **THEN** il server non duplica gli ascolti

### Requirement: Viste per la Home
Il sistema SHALL fornire all'utente l'elenco dei brani ascoltati di recente (senza duplicati, dal più recente) e dei brani aggiunti di recente al catalogo.

#### Scenario: Ascoltati di recente
- **WHEN** l'utente ha ascoltato A, poi B, poi di nuovo A
- **THEN** gli ascoltati di recente riportano A seguito da B
