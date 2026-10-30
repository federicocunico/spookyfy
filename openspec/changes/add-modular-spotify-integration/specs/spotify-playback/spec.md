# Spec Delta

## Purpose

Riproduce e controlla contenuti Spotify attraverso gli strumenti ufficiali, adattando l'interfaccia alle capacità effettive del browser, dell'account e del dispositivo selezionato.

## ADDED Requirements

### Requirement: Streaming tramite player ufficiale
La riproduzione Spotify nel browser SHALL utilizzare il player ufficiale su richiesta esplicita dell'utente, dopo linking e autorizzazioni necessarie. MUST NOT esistere riproduzione Spotify attraverso gli URL audio locali o salvataggio dell'audio sul dispositivo.

#### Scenario: Primo avvio
- **WHEN** l'utente collegato sceglie un brano Spotify con integrazione reale autorizzata e riproduzione disponibile
- **THEN** l'app inizializza il player ufficiale e avvia il contenuto sul dispositivo scelto senza inviare audio attraverso server o gateway Spookyfy

#### Scenario: Riapertura dell'app
- **WHEN** l'app viene riaperta con un ultimo brano Spotify ricordato
- **THEN** non avvia automaticamente il contenuto né trasferisce la riproduzione da un altro dispositivo

### Requirement: Trasporto e dispositivi Spotify
Il sistema SHALL offrire play/pausa, seek, successivo, precedente, shuffle e repeat nei contesti Spotify supportati, e permettere di scegliere un dispositivo disponibile. L'interfaccia MUST rispettare restrizioni e stato effettivo del dispositivo senza mostrare come riuscito un comando rifiutato.

#### Scenario: Nessun dispositivo disponibile
- **WHEN** l'utente richiede una riproduzione senza un dispositivo utilizzabile
- **THEN** l'app propone di attivare il player browser o aprire Spotify senza dichiarare un errore Premium

#### Scenario: Trasferimento esplicito
- **WHEN** l'utente seleziona un dispositivo Spotify diverso
- **THEN** l'app esegue il trasferimento richiesto, aggiorna il dispositivo corrente e non riattiva quello precedente automaticamente

### Requirement: Un solo motore attivo e stato verificabile
Il sistema MUST impedire riproduzioni simultanee controllate dall'app dei motori locale e Spotify. Il cambio di motore SHALL attendere l'arresto confermato del precedente; se non verificabile SHALL fermare il passaggio e permettere il recupero esplicito. Eventi tardivi del motore precedente MUST NOT alterare il nuovo stato.

#### Scenario: Passaggio al locale
- **WHEN** l'utente passa da Spotify a un file locale
- **THEN** Spotify viene fermato prima dell'avvio del file e i comandi di sistema controllano il motore locale

#### Scenario: Pausa Spotify non confermata
- **WHEN** il motore Spotify non conferma l'arresto durante un cambio sorgente
- **THEN** il nuovo contenuto resta in pausa e l'app offre disconnessione del player browser o indicazioni per arrestare il dispositivo remoto

### Requirement: Recupero da errori specifici
Il player SHALL distinguere assenza Premium, autenticazione Spotify, browser incompatibile, autoplay bloccato, dispositivo perso e contenuto non disponibile. Ogni errore SHALL interrompere solo le attività interessate e offrire un recupero appropriato senza avvii o tentativi infiniti.

#### Scenario: Account senza Premium
- **WHEN** il player ufficiale segnala che l'account non ha un abbonamento Premium valido
- **THEN** l'app mostra che la riproduzione Spotify richiede Premium e mantiene disponibile il player locale

#### Scenario: Browser senza supporto richiesto
- **WHEN** il player non può essere inizializzato nell'ambiente corrente
- **THEN** l'app indica il limite e offre apertura in Spotify o un altro dispositivo disponibile senza impedire l'ascolto dei file locali

### Requirement: Capacità mobili e controlli di sistema
L'app SHALL richiedere un nuovo gesto quando il browser blocca la riproduzione e SHALL mostrare metadati e controlli del solo motore attivo. Continuità in background e passaggi tra motori SHALL essere dichiarati disponibili solo negli ambienti verificati; le garanzie del player locale MUST NOT essere estese automaticamente a Spotify.

#### Scenario: Autoplay bloccato dopo trasferimento
- **WHEN** il browser richiede un gesto per avviare il player Spotify
- **THEN** l'app mostra un comando Riprendi senza segnalare falsamente una riproduzione in corso

#### Scenario: Dispositivo Spotify esterno attivo
- **WHEN** l'ascolto continua su un dispositivo esterno
- **THEN** l'app mostra quel dispositivo e lo stato remoto senza pretendere di avere una sorgente audio locale

### Requirement: Nessuna analisi locale degli ascolti Spotify
Il sistema MUST NOT inviare gli eventi Spotify al conteggio ascolti, alla cronologia derivata o all'analisi del silenzio dei file locali. Lo stato del player SHALL essere usato soltanto per il controllo della riproduzione e della coda consentita.

#### Scenario: Ascolto Spotify prolungato
- **WHEN** un brano Spotify supera la soglia usata per conteggiare gli ascolti locali
- **THEN** non viene generato un evento di ascolto Spookyfy né calcolata una statistica derivata Spotify
