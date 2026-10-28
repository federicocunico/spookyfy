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

## Problemi riscontrati

_Nessuno ancora._
