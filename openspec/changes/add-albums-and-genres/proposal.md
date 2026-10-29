# Proposal

## Why

Oggi la libreria è un elenco piatto di brani: l'album è solo un testo libero sul brano e l'unico modo di raggruppare la musica sono le playlist, che sono personali e pensate per l'ascolto, non per catalogare. Chi carica file propri o importa molti brani non può ritrovarli per disco o per genere, e le copertine restano quelle del file o la miniatura di YouTube anche quando il disco ne ha una ufficiale. Serve un'organizzazione del catalogo per album e generi, separata dalle playlist e utilizzabile sia on-premise sia in modalità client.

## What Changes

- **Album come elementi del catalogo.** Un album ha titolo, artista dell'album, anno opzionale, copertina e un elenco ordinato di brani; un brano appartiene al massimo a un album. Gli album sono separati dalle playlist: non compaiono fra le playlist e non le modificano.
- **Raggruppamento automatico.** All'importazione (YouTube, file, ponte) un brano con il tag album finisce nell'album con lo stesso titolo e artista, creato se manca; i brani già in libreria vengono raggruppati una volta, alla migrazione. La modifica del campo "album" di un brano lo sposta nell'album corrispondente.
- **Gestione manuale.** Creare, rinominare ed eliminare album (i brani restano in libreria), aggiungere e togliere brani, cambiarne l'ordine, impostare artista e anno.
- **Copertina dell'album.** Si può assegnare scegliendo un'immagine dal dispositivo, scegliendo fra i risultati di una ricerca online, oppure resta quella del primo brano. Una copertina assegnata all'album viene mostrata da tutti i suoi brani (liste, player, schermata di blocco); il brano torna alla propria se esce dall'album.
- **Ricerca online di copertine e metadati** su database musicali pubblici (MusicBrainz con Cover Art Archive, iTunes Search come riserva) usando titolo del brano, artista e album. Per un album senza copertina la ricerca parte da sola e applica il risultato solo se titolo e artista corrispondono; altrimenti l'utente sceglie fra i candidati, che propongono anche anno e generi. La ricerca online è disattivabile dalle Impostazioni.
- **Generi come tag.** Un brano può avere più generi; un genere impostato su un album vale per tutti i suoi brani. I generi vengono letti dai tag dei file e suggeriti dalla ricerca online; i nomi sono unici senza distinzione fra maiuscole e minuscole.
- **Nuova sezione in Libreria.** Accanto alle playlist, filtri "Album" e "Generi": elenco degli album con copertina, pagina album (riproduci, casuale, modifica), elenco dei generi con numero di brani, pagina genere con brani e album.
- **Backup** (modalità client): album, copertine assegnate e generi vengono esportati e ripristinati; i backup precedenti restano importabili.

Fuori scope: pagine artista, dischi multipli (numero di disco), riscrittura della copertina dentro i file audio, raccomandazioni per genere, modifica di massa di più album insieme, servizi di ricerca a pagamento o con chiave API.

## Capabilities

### New Capabilities

- `album-catalog`: album come elementi del catalogo, raggruppamento automatico all'importazione e alla migrazione, gestione manuale, copertina dell'album e sua visualizzazione sui brani, vista Album separata dalle playlist.
- `genre-tags`: generi multipli per brano e per album, lettura dai tag dei file, unicità dei nomi, vista Generi e navigazione per genere.
- `cover-lookup`: ricerca online di copertine e metadati di album su database musicali pubblici, applicazione automatica solo con corrispondenza sicura, scelta fra candidati, interruttore nelle Impostazioni.

### Modified Capabilities

- `library-backup`: il backup include album, copertine assegnate agli album e generi; i backup senza queste informazioni restano validi.
- `cloud-gateway`: una nuova funzione per la ricerca online e il proxy delle immagini trovate, entro il budget di 12 funzioni.

## Impact

- **Prerequisito**: `library-backup` e `cloud-gateway` nascono nella change `add-client-mode`, che va archiviata prima di questa (come `add-spookyfy-mvp` prima di `add-client-mode`).
- **Codice**:
  - `packages/shared`: DTO e schemi per album, generi e risultati di ricerca; logica di ricerca sui provider (normalizzazione, punteggio di corrispondenza) condivisa fra server e gateway; campi aggiuntivi nel formato di backup.
  - `apps/server`: tabelle e migrazione per album e generi con raggruppamento dei brani esistenti, rotte REST per album, generi e ricerca online, salvataggio delle copertine scaricate, riscrittura nei tag ID3 di album, artista dell'album, numero di traccia e genere.
  - `apps/gateway`: una funzione nuova (da 6 a 7 su 12).
  - `apps/web`: migrazione IndexedDB, metodi di album e generi nella libreria del dispositivo e nell'interfaccia di backend, lettura di genere e numero di traccia nell'importazione da file, viste Album e Generi, editor dell'album, scelta della copertina, interruttore nelle Impostazioni.
  - e2e: flussi album e generi in entrambe le modalità, con i servizi esterni simulati.
- **Servizi esterni**: MusicBrainz (massimo 1 richiesta al secondo, User-Agent identificativo obbligatorio), Cover Art Archive, iTunes Search API; tutti gratuiti e senza chiave. Le richieste partono dal server on-premise o dal gateway, mai dal browser.
- **Privacy**: con la ricerca attiva, titolo, artista e album dei brani vengono inviati a questi servizi; lo si dichiara nelle Impostazioni e nella guida.
