# Spec Delta

## Purpose

Permette di usare la stessa PWA con due backend diversi, on-premise con libreria e streaming sul server oppure client con gateway senza stato e libreria sul telefono, adattando funzionalità e interfaccia alla modalità dichiarata dal backend.

## ADDED Requirements

### Requirement: Dichiarazione della modalità
Ogni backend SHALL esporre, senza autenticazione, una health check che dichiara la modalità (`onpremise` o `client`), la versione e l'elenco delle funzionalità disponibili. La health check MUST NOT rivelare dati sugli utenti.

#### Scenario: Backend on-premise
- **WHEN** un client interroga la health check del server on-premise
- **THEN** la risposta indica la modalità `onpremise` e funzionalità come streaming dal server e libreria condivisa

#### Scenario: Gateway
- **WHEN** un client interroga la health check del gateway su Vercel
- **THEN** la risposta indica la modalità `client` e funzionalità come importazione verso il dispositivo e ricerca remota

### Requirement: Una sola PWA per entrambe le modalità
La PWA SHALL determinare la modalità all'avvio dalla health check della propria origine e conservare l'ultima modalità nota sul dispositivo, così da avviarsi anche offline. Lo stesso build della PWA MUST funzionare con entrambi i backend.

#### Scenario: Avvio online
- **WHEN** la PWA si avvia con il gateway raggiungibile
- **THEN** usa la libreria sul dispositivo e le funzioni del gateway

#### Scenario: Avvio offline
- **WHEN** la PWA si avvia senza connessione dopo essere stata usata in modalità client
- **THEN** si avvia in modalità client con la libreria del dispositivo

### Requirement: Applicabilità dei requisiti per modalità
In modalità `onpremise` SHALL valere il comportamento esistente di libreria, streaming e storage offline sul server. In modalità `client` SHALL valere invece il comportamento definito da `device-library`, `device-ingestion` e `library-backup`; in questa modalità il server MUST NOT conservare brani, metadati della libreria, playlist, preferiti o ascolti.

#### Scenario: Nessun dato musicale sul gateway
- **WHEN** un utente in modalità client importa brani, crea playlist e ascolta musica
- **THEN** sul gateway e sul suo KV non resta alcun dato relativo a brani, playlist, preferiti o ascolti

### Requirement: Interfaccia adattata alla modalità
In modalità client l'app SHALL mostrare le azioni proprie della modalità (importa da file, backup, ponte on-premise, spazio sul dispositivo) e MUST NOT mostrare azioni che presuppongono una libreria sul server (eliminazione per tutti gli account, riproduzione in streaming di brani non presenti sul dispositivo). In modalità on-premise l'interfaccia resta quella attuale.

#### Scenario: Libreria in modalità client
- **WHEN** l'utente apre la Libreria in modalità client
- **THEN** vede solo brani presenti sul dispositivo e i comandi per importare da file e fare il backup

#### Scenario: Libreria in modalità on-premise
- **WHEN** l'utente apre la Libreria in modalità on-premise
- **THEN** l'interfaccia è invariata rispetto alla versione precedente
