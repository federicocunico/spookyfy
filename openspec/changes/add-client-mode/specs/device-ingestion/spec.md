# Spec Delta

## Purpose

Porta nuovi brani nella libreria del dispositivo in modalità client da tre sorgenti: YouTube tramite il gateway, file audio presenti sul telefono e un server on-premise usato come ponte.

## ADDED Requirements

### Requirement: Importazione da YouTube tramite gateway
In modalità client l'utente SHALL poter importare un risultato della ricerca remota: l'app ottiene i metadati, scarica l'audio completo e la copertina tramite il gateway e salva il brano sul dispositivo, mostrando l'avanzamento. Un video già presente in libreria MUST NOT essere scaricato di nuovo.

#### Scenario: Importazione riuscita
- **WHEN** l'utente tocca "Aggiungi" su un risultato
- **THEN** l'app mostra la percentuale di avanzamento e al termine il brano è in libreria e riproducibile offline

#### Scenario: Video già importato
- **WHEN** l'utente tocca "Aggiungi" su un video già in libreria
- **THEN** l'app mostra il brano esistente senza scaricarlo

### Requirement: Riproduzione durante l'importazione
L'utente SHALL poter avviare la riproduzione di un brano mentre è ancora in importazione; il brano viene riprodotto in streaming dal gateway e, a importazione completata, le riproduzioni successive usano la copia sul dispositivo.

#### Scenario: Ascolto immediato
- **WHEN** l'utente tocca Play su un brano in importazione
- **THEN** l'audio parte senza attendere la fine del download

### Requirement: Importazioni in coda e ripresa
Le importazioni SHALL essere eseguite in coda, una o due alla volta; se l'app va in background o viene chiusa, le importazioni non completate SHALL riprendere al ritorno in primo piano. Durante una coda di più brani l'app SHALL tenere lo schermo acceso come per i download di playlist.

#### Scenario: Ritorno in primo piano
- **WHEN** l'utente lascia l'app durante l'importazione di 5 brani e poi torna
- **THEN** le importazioni non completate riprendono senza duplicare i brani già salvati

### Requirement: Errori di importazione
Se il gateway segnala un blocco anti-bot di YouTube, un video non disponibile o troppo lungo, l'app SHALL mostrare un messaggio specifico e, per il blocco anti-bot, proporre l'importazione da file o tramite ponte on-premise. Un'importazione fallita SHALL poter essere ritentata.

#### Scenario: Blocco anti-bot
- **WHEN** l'importazione fallisce perché YouTube blocca il gateway
- **THEN** l'app spiega il motivo e offre "Importa da file" e, se configurato, "Importa tramite il server di casa"

### Requirement: Importazione da file del dispositivo
L'utente SHALL poter scegliere uno o più file audio dal telefono (app File, iCloud Drive, download) in formato MP3 o M4A/AAC. L'app SHALL leggere titolo, artista, album e copertina dai tag del file quando presenti, usare il nome del file come titolo altrimenti, calcolare la durata e salvare il brano in libreria. I formati non riproducibili sul dispositivo MUST essere rifiutati con un messaggio.

#### Scenario: MP3 con tag
- **WHEN** l'utente importa un MP3 con titolo, artista e copertina nei tag ID3
- **THEN** il brano compare in libreria con quei metadati e quella copertina

#### Scenario: File senza tag
- **WHEN** l'utente importa `Canzone di prova.m4a` senza tag
- **THEN** il brano compare con titolo "Canzone di prova", artista "Artista sconosciuto" e una copertina predefinita

#### Scenario: Formato non supportato
- **WHEN** l'utente sceglie un file FLAC che il dispositivo non può riprodurre
- **THEN** l'app rifiuta il file spiegando quali formati sono supportati

### Requirement: Importazione tramite ponte on-premise
Se l'utente ha configurato un server on-premise con indirizzo e token di accesso personale, l'app in modalità client SHALL poter cercare tramite quel server e delegargli l'importazione di un video: il server scarica il brano, l'app ne segue lo stato e poi copia sul dispositivo audio, copertina e metadati. Il brano MUST risultare in libreria solo dopo la copia completa.

#### Scenario: Importazione tramite ponte
- **WHEN** il gateway è bloccato da YouTube e l'utente sceglie "Importa tramite il server di casa"
- **THEN** il server on-premise importa il brano e al termine l'app lo salva sul dispositivo

#### Scenario: Ricerca tramite ponte
- **WHEN** la ricerca sul gateway è bloccata da YouTube e il ponte è configurato
- **THEN** l'app permette di ripetere la ricerca tramite il server on-premise e di importarne i risultati

#### Scenario: Ponte non raggiungibile
- **WHEN** il server on-premise configurato non risponde o rifiuta il token
- **THEN** l'app mostra l'errore e lascia invariata la libreria

#### Scenario: Configurazione del ponte
- **WHEN** l'utente inserisce nelle impostazioni indirizzo e token del server on-premise
- **THEN** l'app verifica la connessione e mostra se il ponte è utilizzabile
