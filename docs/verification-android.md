# Verifica manuale su Android

Stessa checklist di [verification-ios.md](verification-ios.md), eseguita con Chrome su un telefono Android reale (task 12.3).

| Campo | Valore |
|---|---|
| Data | _da compilare_ |
| Dispositivo / Android / Chrome | _es. Pixel 7, Android 15, Chrome 1xx_ |
| Versione di Spookyfy | _commit o data del build_ |
| URL | _https://…_ |

Esito: ✅ ok · ❌ non ok (descrivere) · ⏭️ non verificato

| # | Verifica | Come | Esito | Note |
|---|---|---|---|---|
| 1 | Installazione standalone | Chrome propone "Installa app" (o menu ⋮ → Installa app); l'app si apre senza interfaccia del browser | | |
| 2 | Primo play da tap | Riaprire l'app: brano ripristinato in pausa, parte solo toccando Play | | |
| 3 | Controlli di sistema | Notifica multimediale e schermata di blocco: copertina, titolo, comandi e posizione | | |
| 4 | Cuffie Bluetooth | Successivo e pausa dagli auricolari | | |
| 5 | Brano successivo a schermo spento | Al termine del brano parte il successivo con lo schermo spento | | |
| 6 | Cambio vista senza interruzioni | Home, Cerca, Libreria, playlist durante la riproduzione | | |
| 7 | Player a schermo intero | Swipe su/giù, tasto Indietro di sistema chiude il player | | |
| 8 | Importazione | Avanzamento in tempo reale, riproduzione immediata, salvataggio offline | | |
| 9 | Download di playlist con schermo acceso | Lo schermo resta acceso fino al termine; modalità schermo scuro | | |
| 10 | Ripresa dopo il background | Il download riprende tornando nell'app | | |
| 11 | Modalità aereo | Avvio offline, Scaricati riproducibili con seek, brani mancanti attenuati | | |
| 12 | Storage persistente | Impostazioni → "Storage protetto" (per le app installate Chrome lo concede di norma) | | |
| 13 | Fallback dopo eliminazione della cache | Impostazioni del sito → Cancella dati; online i brani partono in streaming | | |
| 14 | Aggiornamento | Avviso "Nuova versione disponibile" senza interrompere la musica | | |

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

### Spotify: verifiche fisiche ancora da eseguire

Test simulati e provider finto non costituiscono una prova di streaming su Android. Prima delle prove reali servono policy risolta e configurazione autorizzata.

- [ ] Chrome e PWA: attivazione esplicita del SDK, scelta browser/Connect e nuovo gesto quando richiesto; distinguere Premium, autenticazione, browser incompatibile e dispositivo perso.
- [ ] File locale → Spotify → locale, richieste sovrapposte e dispositivo remoto irraggiungibile: nessun doppio audio; il passaggio resta fermo quando la pausa non è confermata.
- [ ] Background, schermo bloccato, cuffie, telefonata e riapertura: metadati, seek e azioni del solo motore attivo; annotare browser/versione e limiti osservati separatamente dal player locale.
- [ ] Nessuna riattivazione o trasferimento automatico del vecchio dispositivo; ripristino della raccolta in pausa.
- [ ] Modalità aereo e download raccolta: solo file locali, conteggio Spotify escluso; nessuna richiesta audio Spotify verso cache o service worker.
- [ ] Logout/unlink, account locale diverso e tab multipli: nessun token/stato remoto del precedente utente; file locali preservati.

_Nessuno ancora._
