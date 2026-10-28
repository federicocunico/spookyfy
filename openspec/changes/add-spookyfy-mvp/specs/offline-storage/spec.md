# Spec Delta

## Purpose

Consente di conservare brani sul dispositivo per l'ascolto senza connessione, massimizzando la sopravvivenza dei dati sui sistemi mobile (in particolare iOS) e degradando in modo trasparente allo streaming quando il sistema li elimina.

## ADDED Requirements

### Requirement: Richiesta di storage persistente
All'avvio l'app SHALL chiedere al browser che il proprio storage sia persistente e SHALL mostrare nelle impostazioni se la richiesta è stata concessa, insieme allo spazio usato e a quello disponibile stimati dal browser.

#### Scenario: Persistenza concessa
- **WHEN** il browser concede lo storage persistente
- **THEN** le impostazioni indicano "Storage protetto"

#### Scenario: Persistenza negata
- **WHEN** il browser nega lo storage persistente
- **THEN** le impostazioni indicano che i download potrebbero essere eliminati dal sistema in caso di poco spazio e l'app continua a funzionare normalmente

### Requirement: Download locale di un brano
L'utente SHALL poter scaricare un brano sul dispositivo con un toggle (icona nuvola quando non scaricato, spunta quando scaricato) disponibile nel player a schermo intero e nelle liste di brani. Durante il download il toggle SHALL mostrare l'avanzamento. Un download MUST essere salvato solo se completo.

#### Scenario: Download riuscito
- **WHEN** l'utente attiva il toggle di download su un brano
- **THEN** il toggle mostra l'avanzamento e, al termine, la spunta, e il brano è riproducibile offline

#### Scenario: Interruzione del download
- **WHEN** la connessione cade a metà download
- **THEN** non resta alcuna copia parziale, il toggle torna allo stato "non scaricato" e viene mostrato un errore

#### Scenario: Rimozione del download
- **WHEN** l'utente disattiva il toggle su un brano scaricato
- **THEN** la copia locale viene eliminata e il brano resta riproducibile in streaming

### Requirement: Download di una playlist
L'utente SHALL poter scaricare tutti i brani di una playlist o dei preferiti con un'unica azione. I brani SHALL essere scaricati in sequenza saltando quelli già presenti, con indicazione dell'avanzamento complessivo, e l'utente SHALL poter annullare l'operazione.

#### Scenario: Download di playlist parzialmente scaricata
- **WHEN** l'utente scarica una playlist di 20 brani di cui 5 già scaricati
- **THEN** vengono scaricati solo i 15 mancanti e l'avanzamento mostra il totale di 20

#### Scenario: Annullamento
- **WHEN** l'utente annulla il download di una playlist dopo 8 brani
- **THEN** gli 8 brani scaricati restano disponibili offline e gli altri non vengono scaricati

### Requirement: Schermo attivo durante i download massivi
Durante il download di una playlist l'app SHALL mantenere lo schermo acceso tramite le API del browser, se supportate, e SHALL offrire una modalità a schermo scuro a basso consumo che mostra solo l'avanzamento. Al termine o all'annullamento lo schermo MUST tornare a potersi spegnere normalmente.

#### Scenario: Download lungo su iPhone
- **WHEN** l'utente avvia il download di una playlist di 50 brani e appoggia il telefono
- **THEN** lo schermo resta acceso fino al termine del download e poi può spegnersi normalmente

#### Scenario: API non supportata
- **WHEN** il browser non supporta il blocco dello spegnimento dello schermo
- **THEN** l'app avvisa l'utente di tenere lo schermo acceso e il download procede

### Requirement: Ripresa dei download interrotti
Se l'app viene sospesa o chiusa durante un download di playlist, i brani non ancora scaricati SHALL restare in attesa e il download SHALL riprendere quando l'app torna in primo piano, senza riscaricare i brani già completati.

#### Scenario: Ritorno in primo piano
- **WHEN** l'utente passa ad un'altra app a metà del download di una playlist e poi torna su Spookyfy
- **THEN** il download riprende dal primo brano non ancora completato

### Requirement: Importazione con salvataggio offline automatico
Quando un'importazione richiesta dall'utente su questo dispositivo viene completata, l'app SHALL permettere di avviarne subito la riproduzione in streaming e SHALL contemporaneamente salvarne una copia locale per l'ascolto offline.

#### Scenario: Brano appena importato
- **WHEN** l'utente importa un brano da Cerca e il server notifica il completamento
- **THEN** il brano è riproducibile subito in streaming e, al termine del salvataggio in background, risulta scaricato

### Requirement: Fallback trasparente in caso di eliminazione dal sistema
Se il sistema operativo elimina le copie locali, l'app SHALL rilevarlo, aggiornare lo stato dei brani interessati a "non scaricato" e, alla successiva riproduzione, SHALL usare lo streaming dal server senza errori visibili.

#### Scenario: Cache svuotata da iOS
- **WHEN** iOS ha eliminato i brani scaricati e l'utente, online, avvia un brano che risultava scaricato
- **THEN** il brano parte in streaming e il suo toggle mostra lo stato "non scaricato"

### Requirement: Libreria consultabile offline
I metadati dei brani scaricati e delle playlist e dei preferiti dell'utente SHALL essere disponibili sul dispositivo, così che senza connessione l'utente possa sfogliare e riprodurre i brani scaricati. La Libreria SHALL offrire un filtro "Scaricati".

#### Scenario: Navigazione offline
- **WHEN** l'utente è offline e apre una playlist con alcuni brani scaricati
- **THEN** vede tutta la playlist con i brani non scaricati attenuati e non selezionabili, e può riprodurre quelli scaricati

### Requirement: Riproduzione locale con posizionamento
I brani scaricati SHALL essere riproducibili offline con le stesse funzionalità dello streaming, compreso il posizionamento a un punto qualsiasi del brano.

#### Scenario: Seek offline
- **WHEN** l'utente è offline e sposta la riproduzione di un brano scaricato al minuto 2
- **THEN** la riproduzione riprende dal minuto 2
