# Verifica manuale su iPhone

Checklist da eseguire su un iPhone reale con la PWA installata tramite il tunnel (task 12.2). I test automatici coprono la logica e WebKit, ma lockscreen, audio in background, WakeLock ed eviction dello storage si verificano solo sul dispositivo.

| Campo | Valore |
|---|---|
| Data | _da compilare_ |
| Dispositivo / iOS | _es. iPhone 13, iOS 18.x_ |
| Versione di Spookyfy | _commit o data del build_ |
| URL | _https://…_ |

Esito: ✅ ok · ❌ non ok (descrivere) · ⏭️ non verificato

| # | Verifica | Come | Esito | Note |
|---|---|---|---|---|
| 1 | Installazione standalone | Safari → Condividi → Aggiungi a schermata Home; aprire dall'icona: nessuna barra del browser, icona e nome Spookyfy | | |
| 2 | Primo play da tap | Riaprire l'app dopo averla chiusa durante un brano: il mini-player mostra il brano in pausa alla posizione salvata; parte solo toccando Play | | |
| 3 | Lockscreen | Bloccare durante la riproduzione: copertina, titolo, artista; play/pausa, successivo, precedente e barra di avanzamento funzionano | | |
| 4 | Cuffie / AirPods | "Successivo" e pausa dagli auricolari | | |
| 5 | Brano successivo a schermo bloccato | Avviare una playlist, bloccare: al termine del brano parte il successivo senza sbloccare | | |
| 6 | Cambio vista senza interruzioni | Passare fra Home, Cerca, Libreria e una playlist durante la riproduzione | | |
| 7 | Player a schermo intero | Swipe verso l'alto sul mini-player, swipe verso il basso o gesto Indietro per chiudere; sfondo dal colore della copertina | | |
| 8 | Importazione | Cercare un brano, "Aggiungi": avanzamento in tempo reale, poi riproduzione immediata e spunta "scaricato" | | |
| 9 | Download di playlist con schermo acceso | Scaricare una playlist di almeno 20 brani appoggiando il telefono: lo schermo resta acceso fino al termine; provare anche la modalità schermo scuro | | |
| 10 | Ripresa dopo il background | Durante un download di playlist passare a un'altra app e tornare: riprende dal primo brano mancante | | |
| 11 | Modalità aereo | Attivare la modalità aereo e riaprire l'app: si avvia, banner "Sei offline", Libreria → Scaricati riproducibile con seek; i brani non scaricati sono attenuati | | |
| 12 | Storage persistente | Impostazioni → "Storage protetto" | | |
| 13 | Fallback dopo eliminazione della cache | Impostazioni iPhone → Safari → Avanzate → Dati dei siti web → eliminare i dati del dominio (oppure riempire lo spazio); riaprire online: i brani risultano non scaricati e partono in streaming senza errori | | |
| 14 | Aggiornamento | Dopo un nuovo deploy compare "Nuova versione disponibile" e la musica non si interrompe | | |

## Modalità client (gateway su Vercel)

Stesso formato di esito, con l'app aperta dall'URL del progetto Vercel e installata nella schermata Home.

| # | Verifica | Come | Esito | Note |
|---|---|---|---|---|
| C1 | Modalità rilevata | La Libreria mostra «Importa da file» e non il filtro «Scaricati» | | |
| C2 | Importazione da YouTube | Cerca → Aggiungi: avanzamento, poi brano in libreria; se YouTube blocca, messaggio con le alternative | | |
| C3 | Ascolto durante l'importazione | Play sul risultato mentre si importa: l'audio parte subito e non si interrompe al termine | | |
| C4 | Importazione da file | Libreria → Importa da file → scegliere MP3/M4A da File/iCloud: titolo, artista e copertina dai tag | | |
| C5 | Ponte on-premise | Impostazioni → Server di casa: «Ponte attivo»; ricerca e importazione tramite il server di casa | | |
| C6 | Modalità aereo | Avvio senza rete, libreria completa riproducibile con seek, lockscreen funzionante | | |
| C7 | Backup e ripristino | Esporta con audio → Salva su File; su un altro dispositivo o dopo aver cancellato i dati, Importa backup | | |
| C8 | Eliminazione dello storage | Cancellare i dati del sito: all'apertura avviso dei brani persi, «Riscarica» dal menu ⋯ e ripristino da backup | | |
| C9 | Spazio | Impostazioni: brani, spazio occupato e disponibile; avviso se lo storage non è protetto | | |

## Problemi riscontrati

_Nessuno ancora._
