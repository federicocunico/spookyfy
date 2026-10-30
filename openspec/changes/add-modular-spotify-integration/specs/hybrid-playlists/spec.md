# Spec Delta

## Purpose

Organizza riferimenti musicali di sorgenti diverse in raccolte personali Spookyfy, preservando la libreria locale e rendendo espliciti i limiti tecnici e di rilascio della parte remota.

## ADDED Requirements

### Requirement: Raccolta personale multisorgente
Quando la capacità è abilitata, l'utente SHALL poter creare, rinominare, eliminare e riordinare playlist Spookyfy contenenti riferimenti locali e Spotify. Ogni occorrenza SHALL avere identità propria, anche per brani duplicati. Le raccolte MUST essere accessibili solo al proprietario e distinte dalle playlist native Spotify.

#### Scenario: Ordine e duplicati
- **WHEN** l'utente inserisce locale A, Spotify B e ancora locale A e sposta l'ultima occorrenza all'inizio
- **THEN** la raccolta contiene A, A, B con tre occorrenze distinte nello stesso ordine dopo la riapertura

#### Scenario: Playlist locale preesistente
- **WHEN** l'utente vuole affiancare Spotify a una playlist locale preesistente
- **THEN** può crearne una copia multisorgente conservando ordine e duplicati senza cambiare l'originale

### Requirement: Separazione dalla sincronizzazione Spotify
Le modifiche a una playlist ibrida MUST restare in Spookyfy. L'app MUST NOT caricare file personali su Spotify, risolverli automaticamente in brani Spotify o presentare una raccolta ibrida come sincronizzata con una playlist remota.

#### Scenario: Aggiunta di un file personale
- **WHEN** l'utente aggiunge un file locale alla raccolta ibrida
- **THEN** non viene inviata alcuna modifica a Spotify e il file rimane nella libreria personale

### Requirement: Persistenza e backup compatibili
Le raccolte multisorgente SHALL conservare riferimenti e ordine senza richiedere rete per le operazioni locali supportate. Il backup SHALL contenere soltanto file locali e riferimenti remoti minimi, escludendo segreti e audio Spotify; i vecchi backup MUST restare importabili. Il ripristino remoto MUST richiedere un collegamento compatibile senza riattivarlo automaticamente.

#### Scenario: Backup precedente all'integrazione
- **WHEN** viene importato un backup locale creato prima della nuova funzionalità
- **THEN** brani, playlist, preferiti, album e generi vengono ripristinati come prima

#### Scenario: Ripristino senza Spotify collegato
- **WHEN** viene importato un backup con riferimenti Spotify senza collegamento compatibile
- **THEN** la parte locale viene ripristinata e i riferimenti remoti restano inerti senza richieste a Spotify fino a riconciliazione esplicita

### Requirement: Riproduzione ibrida condizionata
Soltanto negli ambienti e negli usi abilitati, l'app SHALL riprodurre una coda multisorgente rispettando l'ordine e le impostazioni di coda. I cambi sorgente MUST essere sequenziali, senza sovrapposizioni, mix, crossfade o trim Spotify. Una sospensione del browser che richiede un gesto SHALL mettere la transizione in pausa.

#### Scenario: Transizione simulata supportata
- **WHEN** termina un brano locale seguito da Spotify in un ambiente simulato abilitato
- **THEN** il motore precedente termina prima dell'avvio del successivo e un evento duplicato non salta un altro elemento

#### Scenario: Nuovo gesto necessario
- **WHEN** il browser non consente l'avvio del prossimo motore senza interazione
- **THEN** la coda conserva l'elemento previsto e mostra Riprendi senza saltare silenziosamente il brano

### Requirement: Uso offline e sorgente indisponibile
L'utente SHALL poter ascoltare la parte locale disponibile anche quando Spotify è scollegato o offline. Il sistema SHALL segnalare gli elementi remoti non riproducibili e visitarli al massimo una volta per avanzamento, fermandosi se nessun elemento è riproducibile anche con repeat attivo.

#### Scenario: Modalità aereo
- **WHEN** l'utente avvia una raccolta mista offline con due file locali disponibili e due riferimenti Spotify
- **THEN** ascolta i due file nell'ordine previsto con un avviso sui due riferimenti saltati senza tentativi di rete

#### Scenario: Tutti gli elementi indisponibili
- **WHEN** tutti gli elementi della coda sono indisponibili e repeat coda è attivo
- **THEN** la riproduzione si ferma con una spiegazione senza ricorsione o ciclo infinito

### Requirement: Disconnessione senza perdita locale
Quando Spotify viene scollegato, il sistema SHALL eliminare dati e riferimenti Spotify associati mantenendo raccolte e occorrenze locali nel loro ordine relativo. La rimozione o indisponibilità di un file locale SHALL essere distinta dall'indisponibilità di un riferimento remoto.

#### Scenario: Scollegamento di una raccolta mista
- **WHEN** una raccolta contiene A locale, B Spotify e C locale e l'utente scollega Spotify
- **THEN** la raccolta resta con A e C in tale ordine, nessun file viene cancellato e l'utente vede il numero di riferimenti rimossi
