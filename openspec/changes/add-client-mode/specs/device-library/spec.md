# Spec Delta

## Purpose

Conserva l'intera libreria musicale dell'utente sul dispositivo in modalità client: brani, file audio, copertine, preferiti, playlist e ascolti, consultabili e riproducibili senza alcun server.

## ADDED Requirements

### Requirement: Catalogo sul dispositivo
In modalità client ogni brano SHALL essere salvato sul dispositivo con file audio, copertina (grande e miniatura), titolo, artista, album opzionale, durata, dimensione, colore dominante, sorgente e data di aggiunta. Un brano MUST comparire in libreria solo quando file audio e metadati sono stati salvati entrambi.

#### Scenario: Brano completo
- **WHEN** un'importazione termina
- **THEN** il brano compare in libreria ed è riproducibile anche senza connessione

#### Scenario: Importazione interrotta
- **WHEN** l'importazione si interrompe a metà del file
- **THEN** il brano non compare in libreria e non resta spazio occupato da file parziali

### Requirement: Riproduzione locale
In modalità client i brani della libreria SHALL essere riprodotti dalla copia sul dispositivo, con posizionamento a un punto qualsiasi, controlli di sistema e passaggio al brano successivo in background, come in modalità on-premise.

#### Scenario: Seek senza rete
- **WHEN** l'utente, in modalità aereo, sposta la riproduzione al minuto 2 di un brano
- **THEN** la riproduzione riprende dal minuto 2

### Requirement: Ricerca e ordinamento locali
La libreria sul dispositivo SHALL supportare la ricerca per prefisso su titolo, artista e album, senza distinzione fra maiuscole e minuscole e senza accenti, e l'ordinamento per data di aggiunta, titolo o artista.

#### Scenario: Ricerca locale
- **WHEN** l'utente cerca "bjork" e la libreria contiene un brano di "Björk"
- **THEN** il brano compare nei risultati

### Requirement: Preferiti, playlist e ascolti sul dispositivo
Preferiti, playlist (creazione, rinomina, eliminazione, aggiunta, rimozione, riordino, duplicati ammessi, nome 1–100 caratteri) e ascolti (soglia di 30 s o metà durata, ascoltati di recente) SHALL funzionare come in modalità on-premise, salvati solo sul dispositivo.

#### Scenario: Playlist offline
- **WHEN** l'utente crea una playlist e la riordina senza connessione
- **THEN** la modifica viene salvata e mantenuta alla riapertura dell'app

### Requirement: Modifica ed eliminazione dei brani
L'utente SHALL poter correggere titolo, artista e album di un brano ed eliminarlo; l'eliminazione MUST liberare lo spazio del file e rimuovere il brano da preferiti, playlist e coda.

#### Scenario: Eliminazione
- **WHEN** l'utente elimina un brano presente in una playlist
- **THEN** il brano sparisce da libreria e playlist e lo spazio occupato diminuisce

### Requirement: Spazio sul dispositivo
L'app SHALL mostrare lo spazio occupato dalla libreria, lo spazio disponibile stimato e il numero di brani, e SHALL avvisare prima di un'importazione che non può essere completata per mancanza di spazio.

#### Scenario: Spazio insufficiente
- **WHEN** lo spazio disponibile stimato è inferiore alla dimensione del brano da importare
- **THEN** l'app avvisa l'utente e non avvia l'importazione

### Requirement: Protezione dall'eliminazione da parte del sistema
In modalità client l'app SHALL richiedere lo storage persistente e, se il browser lo nega, SHALL avvisare chiaramente che il sistema potrebbe cancellare la libreria e suggerire l'installazione nella schermata Home e il backup. Se all'avvio la libreria risulta svuotata dal sistema, l'app SHALL spiegarlo e proporre il ripristino da backup.

#### Scenario: Storage non protetto
- **WHEN** il browser nega lo storage persistente in modalità client
- **THEN** l'app mostra un avviso con il suggerimento di installare l'app e di esportare un backup

#### Scenario: Libreria cancellata dal sistema
- **WHEN** all'avvio i file audio risultano eliminati dal sistema operativo
- **THEN** l'app indica quali brani sono stati persi e propone di ripristinare un backup
