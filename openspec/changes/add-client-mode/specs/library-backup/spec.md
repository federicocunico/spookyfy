# Spec Delta

## Purpose

Protegge la libreria della modalità client, che vive solo sul dispositivo, permettendo di esportarla in un file e di reimportarla sullo stesso o su un altro dispositivo.

## ADDED Requirements

### Requirement: Esportazione della libreria
L'utente SHALL poter esportare la libreria da salvare sul telefono o su un servizio cloud, scegliendo se includere i file audio. Il backup SHALL contenere metadati e copertine dei brani, preferiti, playlist con il loro ordine e storico ascolti, con una versione di formato; l'audio, se incluso, SHALL essere diviso in parti di dimensione limitata per non esaurire la memoria del telefono.

#### Scenario: Backup leggero
- **WHEN** l'utente esporta senza file audio
- **THEN** ottiene un solo file piccolo con metadati, copertine, preferiti, playlist e ascolti

#### Scenario: Backup completo
- **WHEN** l'utente esporta una libreria di 2 GB includendo i file audio
- **THEN** l'app indica la dimensione stimata e il numero di parti prima di iniziare, e produce il file dei metadati più le parti audio, ciascuna entro il limite

### Requirement: Importazione di un backup
L'utente SHALL poter importare un backup scegliendone i file (metadati ed eventuali parti audio): i brani già presenti MUST NOT essere duplicati, quelli mancanti vengono aggiunti, playlist e preferiti vengono uniti e gli ascolti non vengono contati due volte. I brani presenti nel backup senza file audio SHALL comparire come "da riscaricare" e poter essere riscaricati tramite gateway o ponte.

#### Scenario: Ripristino su un nuovo telefono
- **WHEN** l'utente importa un backup completo su un telefono nuovo
- **THEN** libreria, playlist, preferiti e ascolti sono identici a quelli esportati

#### Scenario: Backup senza audio
- **WHEN** l'utente importa un backup leggero su un telefono senza quei brani
- **THEN** i brani compaiono come "da riscaricare" con l'azione per riscaricarli

#### Scenario: Importazione ripetuta
- **WHEN** l'utente importa due volte lo stesso backup
- **THEN** la libreria non contiene duplicati

### Requirement: Validazione del file di backup
Un file non riconosciuto, danneggiato o di una versione di formato non supportata MUST essere rifiutato senza modificare la libreria.

#### Scenario: File danneggiato
- **WHEN** l'utente sceglie un file di backup troncato
- **THEN** l'app mostra un errore e la libreria resta invariata

### Requirement: Promemoria di backup
In modalità client l'app SHALL indicare nelle impostazioni la data dell'ultimo backup e SHALL ricordare di farne uno quando sono stati aggiunti almeno 20 brani o sono passati 30 giorni dall'ultimo.

#### Scenario: Promemoria
- **WHEN** l'utente ha importato 25 brani dall'ultimo backup
- **THEN** l'app mostra un promemoria non invasivo per esportare la libreria
