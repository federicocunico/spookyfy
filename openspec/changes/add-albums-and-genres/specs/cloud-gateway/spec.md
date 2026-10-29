# Spec Delta

## ADDED Requirements

### Requirement: Ricerca di album e copertine dal gateway
Il gateway SHALL offrire agli utenti autenticati la ricerca online di album e copertine e il proxy delle immagini dei candidati, con una sola funzione serverless aggiuntiva entro il budget di 12. Il gateway MUST NOT conservare ricerche né immagini; il proxy MUST accettare solo immagini dei servizi di copertine previsti e rifiutare altri indirizzi.

#### Scenario: Immagine di un candidato
- **WHEN** il client richiede tramite il gateway l'immagine di un candidato di Cover Art Archive
- **THEN** riceve l'immagine dalla propria origine, leggibile da canvas senza restrizioni cross-origin

#### Scenario: Indirizzo non consentito
- **WHEN** una richiesta al proxy delle immagini indica un indirizzo di un dominio non previsto
- **THEN** il gateway rifiuta la richiesta senza contattare quell'indirizzo

#### Scenario: Utente non autenticato
- **WHEN** un client senza sessione chiama la ricerca di album
- **THEN** il gateway risponde 401
