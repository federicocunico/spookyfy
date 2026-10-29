# Spec Delta

## Purpose

Permette di etichettare brani e album con uno o più generi musicali e di sfogliare la libreria per genere, in modalità on-premise e client.

## ADDED Requirements

### Requirement: Generi dei brani
Ogni brano SHALL poter avere zero o più generi. Un nome di genere MUST essere lungo 1–40 caratteri dopo la rimozione degli spazi superflui; i generi SHALL essere unici senza distinzione fra maiuscole, minuscole e accenti, conservando la grafia del primo inserimento. Un brano MUST NOT avere più di 10 generi.

#### Scenario: Aggiunta di un genere
- **WHEN** l'utente aggiunge il genere "Grunge" a un brano
- **THEN** il brano riporta il genere "Grunge"

#### Scenario: Stesso genere con grafia diversa
- **WHEN** esiste il genere "Hip-Hop" e l'utente aggiunge "hip-hop" a un altro brano
- **THEN** entrambi i brani riportano il genere "Hip-Hop" e l'elenco dei generi ne contiene uno solo

#### Scenario: Nome non valido
- **WHEN** l'utente prova ad aggiungere un genere fatto solo di spazi
- **THEN** il sistema risponde con errore di validazione

### Requirement: Generi di un album
L'utente SHALL poter aggiungere o togliere un genere a un album: l'operazione MUST valere per tutti i brani dell'album in quel momento. I generi mostrati per un album SHALL essere quelli presenti in tutti i suoi brani.

#### Scenario: Genere su tutto l'album
- **WHEN** l'utente aggiunge il genere "Rock" all'album "In Utero" con 12 brani
- **THEN** tutti i 12 brani riportano il genere "Rock"

#### Scenario: Genere su un solo brano
- **WHEN** uno solo dei brani di un album ha il genere "Acustico"
- **THEN** la pagina dell'album non mostra "Acustico" fra i generi dell'album, mentre il brano sì

### Requirement: Generi dai tag dei file
All'importazione da file il sistema SHALL leggere i generi presenti nei tag e assegnarli al brano, separando i valori multipli e ignorando codici numerici non riconosciuti.

#### Scenario: MP3 con genere
- **WHEN** l'utente importa un MP3 con genere "Alternative; Indie"
- **THEN** il brano riporta i generi "Alternative" e "Indie"

### Requirement: Suggerimento dei generi
Durante la modifica dei generi di un brano o di un album l'app SHALL suggerire i generi già presenti in libreria che corrispondono per prefisso al testo digitato, oltre a quelli proposti dalla ricerca online quando disponibile.

#### Scenario: Completamento
- **WHEN** l'utente digita "ele" e in libreria esiste il genere "Elettronica"
- **THEN** l'app propone "Elettronica"

### Requirement: Vista Generi
La Libreria SHALL offrire una sezione "Generi", separata dalle playlist, con l'elenco dei generi in uso e il numero di brani di ciascuno. La pagina di un genere SHALL mostrare i brani con quel genere e gli album che lo hanno su tutti i brani, con riproduzione e riproduzione casuale dei brani.

#### Scenario: Ascolto per genere
- **WHEN** l'utente apre il genere "Jazz" e tocca riproduzione casuale
- **THEN** il player riproduce in ordine casuale i soli brani con genere "Jazz"

### Requirement: Generi non più usati
Un genere che non è più assegnato ad alcun brano MUST NOT comparire nella sezione Generi né fra i suggerimenti.

#### Scenario: Ultimo brano rimosso
- **WHEN** l'utente toglie il genere "Swing" all'unico brano che lo aveva
- **THEN** "Swing" non compare più nella sezione Generi

### Requirement: Generi nella ricerca locale
La ricerca nella libreria SHALL restituire anche i brani con un genere che corrisponde per prefisso al testo cercato.

#### Scenario: Ricerca per genere
- **WHEN** l'utente cerca "shoeg" e un brano ha il genere "Shoegaze"
- **THEN** il brano compare nei risultati
