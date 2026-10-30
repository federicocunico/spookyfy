# Spec Delta

## Purpose

Consente all'utente collegato di consultare e gestire i contenuti Spotify autorizzati mantenendone provenienza, limiti di accesso e distinzione dalla musica importata in Spookyfy.

## ADDED Requirements

### Requirement: Ricerca distinta per sorgente
L'utente SHALL poter cercare brani, album, artisti e playlist su Spotify tramite il proprio collegamento. Risultati, caricamento, paginazione ed errori Spotify SHALL restare distinti da libreria locale e YouTube; risposte obsolete MUST NOT sostituire una ricerca più recente.

#### Scenario: Ricerca Spotify riuscita
- **WHEN** l'utente collegato seleziona Spotify e cerca un artista
- **THEN** vede risultati attribuiti a Spotify con collegamenti originali e può caricare ulteriori risultati senza duplicazioni accidentali

#### Scenario: Una sorgente non risponde
- **WHEN** Spotify non risponde durante una ricerca
- **THEN** lo stato Spotify mostra l'errore e l'utente può comunque consultare risultati locali e avviare la ricerca YouTube

### Requirement: Consultazione della libreria autorizzata
Il sistema SHALL mostrare brani salvati, album salvati, dettagli di album/artisti disponibili e playlist dell'utente tramite richieste paginate su scelta dell'utente. L'accesso limitato ai contenuti di una playlist MUST essere distinto da una playlist vuota.

#### Scenario: Playlist posseduta o collaborativa
- **WHEN** Spotify autorizza la lettura degli elementi di una playlist dell'utente
- **THEN** l'app mostra gli elementi nell'ordine originale conservando i duplicati

#### Scenario: Playlist senza accesso agli elementi
- **WHEN** Spotify restituisce solo metadati o nega la lettura dei contenuti di una playlist
- **THEN** l'app mostra la playlist e la limitazione senza inventare un elenco vuoto né tentare il recupero tramite un altro servizio

#### Scenario: Contenuti non supportati
- **WHEN** una playlist contiene elementi rimossi, non disponibili, file locali Spotify o episodi non supportati
- **THEN** l'app ne indica l'indisponibilità mantenendo comprensibili le posizioni e senza trasformarli in file audio Spookyfy

### Requirement: Gestione esplicita della libreria Spotify
L'utente SHALL poter salvare e rimuovere brani o album nella propria libreria Spotify quando autorizzato. I preferiti locali MUST restare indipendenti; nessuna azione locale SHALL modificare automaticamente la libreria Spotify.

#### Scenario: Salvataggio su Spotify
- **WHEN** l'utente sceglie esplicitamente Salva su Spotify su un brano con autorizzazione sufficiente
- **THEN** la modifica avviene nella libreria Spotify e l'app ne mostra l'esito

#### Scenario: Preferito locale
- **WHEN** l'utente aggiunge ai preferiti un file della propria libreria Spookyfy
- **THEN** non viene inviata alcuna modifica alla libreria Spotify

### Requirement: Modifica delle playlist native Spotify
Il sistema SHALL consentire creazione, rinomina, descrizione, visibilità, aggiunta, rimozione e riordino degli elementi nelle playlist Spotify per cui l'utente ha i permessi. Le modifiche SHALL essere esplicite, preservare i duplicati e rendere visibili conflitti ed esiti incerti senza promettere una sincronizzazione automatica.

#### Scenario: Creazione privata
- **WHEN** l'utente crea una playlist Spotify senza scegliere una visibilità pubblica
- **THEN** la playlist viene creata privata e compare tra le sue playlist Spotify

#### Scenario: Conflitto durante il riordino
- **WHEN** la playlist cambia su Spotify mentre l'utente sta modificando il suo ordine nell'app
- **THEN** l'app riconcilia con la versione remota o richiede un nuovo tentativo senza sovrascrivere silenziosamente elementi concorrenti

#### Scenario: Timeout dopo una modifica
- **WHEN** la risposta a una creazione o aggiunta si perde dopo l'invio
- **THEN** l'app segnala un esito incerto, aggiorna lo stato remoto e non ripete automaticamente l'operazione causando duplicati

### Requirement: Copia di riferimenti e attribuzione
Quando abilitato, il sistema SHALL poter copiare gli elementi accessibili di una playlist Spotify in una raccolta Spookyfy come soli riferimenti, conservandone provenienza e ordine. Contenuti e copertine Spotify MUST essere attribuiti e collegati alla risorsa originale senza entrare nel catalogo locale condiviso.

#### Scenario: Copia di una playlist
- **WHEN** l'utente richiede la copia di una playlist Spotify accessibile nelle proprie raccolte Spookyfy
- **THEN** vengono copiati soltanto riferimenti supportati, gli esclusi sono segnalati e nessun audio viene importato

#### Scenario: Utente differente
- **WHEN** un altro account Spookyfy apre il catalogo locale condiviso
- **THEN** non trova i contenuti personali Spotify copiati dal primo utente
