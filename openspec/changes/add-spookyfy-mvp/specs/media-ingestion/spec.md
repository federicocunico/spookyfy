# Spec Delta

## Purpose

Permette di cercare brani sulla sorgente remota (YouTube) dall'app e di importarli nella libreria del server come file audio taggati, notificando i client in tempo reale sull'avanzamento.

## ADDED Requirements

### Requirement: Ricerca remota
Il sistema SHALL permettere a un utente autenticato di cercare brani su YouTube con una query testuale e SHALL restituire fino a 10 risultati con identificativo sorgente, titolo, canale/artista, durata, miniatura e un indicatore che segnala se il brano è già presente in libreria. Le query vuote o più lunghe di 200 caratteri MUST essere rifiutate.

#### Scenario: Ricerca con risultati
- **WHEN** l'utente cerca "nirvana come as you are"
- **THEN** il sistema restituisce al massimo 10 risultati, ciascuno con titolo, artista, durata e miniatura

#### Scenario: Brano già in libreria
- **WHEN** un risultato della ricerca corrisponde a un video già importato
- **THEN** il risultato riporta l'identificativo del brano in libreria e l'indicazione "già presente"

#### Scenario: Query non valida
- **WHEN** l'utente invia una query vuota
- **THEN** il sistema risponde con errore di validazione senza contattare la sorgente remota

#### Scenario: Sorgente remota non raggiungibile
- **WHEN** la ricerca remota fallisce o supera i 15 secondi
- **THEN** il sistema risponde con un errore che indica che la ricerca remota non è disponibile

### Requirement: Richiesta di importazione
Il sistema SHALL accettare la richiesta di importare un brano a partire dal suo identificativo sorgente, creando un job in coda e restituendone subito l'identificativo. Se il brano è già in libreria il sistema MUST restituire il brano esistente senza creare un job; se un job per lo stesso brano è già attivo MUST restituire quel job.

#### Scenario: Nuova importazione
- **WHEN** l'utente richiede l'importazione di un video non presente in libreria
- **THEN** il sistema crea un job in stato "in coda" e ne restituisce l'identificativo

#### Scenario: Brano già importato
- **WHEN** l'utente richiede l'importazione di un video già in libreria
- **THEN** il sistema restituisce il brano esistente e non crea alcun job

#### Scenario: Richieste duplicate concorrenti
- **WHEN** due utenti richiedono l'importazione dello stesso video mentre il primo job è ancora attivo
- **THEN** entrambi ricevono lo stesso identificativo di job

#### Scenario: Identificativo non valido
- **WHEN** l'utente richiede l'importazione con un identificativo che non ha il formato di un video YouTube
- **THEN** il sistema risponde con errore di validazione e non crea alcun job

### Requirement: Elaborazione dei job
Il sistema SHALL elaborare i job in ordine di arrivo con un numero massimo di job contemporanei configurabile, il cui valore predefinito dipende dalle risorse del server. Ogni job SHALL scaricare l'audio, convertirlo in MP3, salvare la copertina, scrivere i tag ID3 (titolo, artista, album se disponibile, copertina) e registrare il brano in libreria con durata, dimensione del file e colore dominante della copertina.

#### Scenario: Job completato
- **WHEN** un job viene elaborato con successo
- **THEN** in libreria esiste un nuovo brano con file MP3, copertina, durata, dimensione e colore dominante, e il job passa allo stato "completato" con il riferimento al brano

#### Scenario: Tag ID3 nel file
- **WHEN** il file MP3 di un brano importato viene aperto con un lettore di tag ID3
- **THEN** il file contiene titolo, artista e copertina corrispondenti ai metadati in libreria

#### Scenario: Limite di concorrenza
- **WHEN** vengono richieste 5 importazioni con limite di concorrenza configurato a 2
- **THEN** al massimo 2 job sono in elaborazione nello stesso momento e gli altri restano "in coda"

#### Scenario: Default proporzionato all'hardware
- **WHEN** il limite non è configurato e il server ha più core di un Raspberry Pi
- **THEN** il sistema elabora in parallelo più job di quanti ne elaborerebbe sul Raspberry Pi, restando comunque entro un massimo fisso

### Requirement: Gestione degli errori di importazione
Un job che fallisce SHALL passare allo stato "fallito" con un messaggio d'errore leggibile e MUST NOT lasciare file parziali né brani incompleti in libreria. I video più lunghi di 20 minuti o non disponibili MUST far fallire il job. L'utente SHALL poter riprovare un job fallito.

#### Scenario: Video non disponibile
- **WHEN** il video richiesto è privato o rimosso
- **THEN** il job passa a "fallito" con un messaggio che indica che il video non è disponibile e nessun file resta sul disco

#### Scenario: Video troppo lungo
- **WHEN** il video richiesto dura 45 minuti
- **THEN** il job fallisce con un messaggio che indica il superamento della durata massima

#### Scenario: Nuovo tentativo
- **WHEN** l'utente riprova un job fallito per un errore temporaneo di rete
- **THEN** il job torna "in coda" e viene rielaborato

### Requirement: Ripresa dopo il riavvio
I job in coda o in elaborazione al momento di un arresto del server SHALL essere rimessi in coda al riavvio, dopo aver eliminato gli eventuali file parziali.

#### Scenario: Riavvio durante un download
- **WHEN** il server si riavvia mentre un job è in elaborazione
- **THEN** dopo il riavvio il job viene rielaborato da capo e completato senza duplicare il brano

### Requirement: Notifiche in tempo reale
Il sistema SHALL inviare agli utenti autenticati connessi al canale in tempo reale gli eventi di cambio stato dei job (in coda, in elaborazione con percentuale, completato con i dati del brano, fallito con messaggio). Gli eventi di avanzamento MUST essere inviati al massimo una volta al secondo per job.

#### Scenario: Notifica di completamento
- **WHEN** un job richiesto dall'utente viene completato
- **THEN** il client connesso riceve un evento "completato" con i metadati del nuovo brano entro 1 secondo

#### Scenario: Avanzamento limitato
- **WHEN** il download di un brano procede per 10 secondi
- **THEN** il client riceve al massimo 10 eventi di avanzamento per quel job

#### Scenario: Riconnessione
- **WHEN** il client perde la connessione al canale e si riconnette
- **THEN** il client può ottenere lo stato attuale dei propri job attivi tramite l'API dei job

### Requirement: Consultazione dei job
Il sistema SHALL permettere a un utente autenticato di elencare i job attivi e quelli terminati nelle ultime 24 ore, con stato, percentuale, eventuale errore e riferimento al brano.

#### Scenario: Elenco dei job
- **WHEN** l'utente apre la lista dei download sul server
- **THEN** vede i job in coda, in elaborazione e quelli completati o falliti nelle ultime 24 ore
