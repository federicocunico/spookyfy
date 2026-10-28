# Spec Delta

## Purpose

Distribuisce ai client autenticati i file audio e le copertine della libreria in un formato riproducibile dal tag audio dei browser mobile, compresi scrubbing e ripresa.

## ADDED Requirements

### Requirement: Streaming audio con richieste parziali
Il sistema SHALL servire il file MP3 di ogni brano a un URL stabile, con tipo `audio/mpeg`, dimensione totale e supporto alle richieste Range a byte singolo (risposta 206 con l'intervallo richiesto). Una richiesta senza Range MUST ricevere il file intero con risposta 200.

#### Scenario: Richiesta parziale
- **WHEN** il client richiede i byte 0-1 di un brano
- **THEN** il sistema risponde 206 con esattamente 2 byte, l'header Content-Range con la dimensione totale e Accept-Ranges `bytes`

#### Scenario: Seek a metà brano
- **WHEN** il client richiede un intervallo che parte dalla metà del file
- **THEN** il sistema risponde 206 con i byte a partire da quell'offset senza inviare la parte precedente

#### Scenario: Download completo
- **WHEN** il client richiede il file senza header Range
- **THEN** il sistema risponde 200 con l'intero file e l'header Content-Length

#### Scenario: Intervallo non soddisfacibile
- **WHEN** il client richiede un intervallo che inizia oltre la fine del file
- **THEN** il sistema risponde 416 indicando la dimensione totale

#### Scenario: Brano inesistente
- **WHEN** il client richiede l'audio di un identificativo che non esiste in libreria
- **THEN** il sistema risponde 404

### Requirement: Copertine
Il sistema SHALL servire la copertina di ogni brano come immagine a un URL stabile, in una dimensione grande (almeno 512 px di lato) e in una miniatura (al massimo 128 px di lato).

#### Scenario: Copertina grande
- **WHEN** il client richiede la copertina grande di un brano
- **THEN** il sistema restituisce un'immagine con lato di almeno 512 px

#### Scenario: Miniatura
- **WHEN** il client richiede la miniatura di un brano
- **THEN** il sistema restituisce un'immagine con lato massimo di 128 px

### Requirement: Politica di caching delle risorse media
Audio e copertine SHALL essere considerati immutabili per identificativo di brano e MUST essere marcati come cacheabili solo dal client (privati), così che proxy e CDN intermedi, incluso il tunnel, non li conservino.

#### Scenario: Header di caching
- **WHEN** il client riceve un file audio o una copertina
- **THEN** la risposta dichiara la risorsa privata e immutabile per almeno un anno

### Requirement: Sorgente audio indipendente dal client
Lo streaming SHALL funzionare con il tag audio standard dei browser mobile, inclusi Safari iOS in modalità PWA installata e Chrome Android, autenticandosi tramite il cookie di sessione senza header personalizzati.

#### Scenario: Riproduzione su iOS
- **WHEN** l'app installata su iPhone avvia la riproduzione di un brano non scaricato
- **THEN** l'audio parte in streaming e lo scrubbing a un punto qualsiasi del brano funziona
