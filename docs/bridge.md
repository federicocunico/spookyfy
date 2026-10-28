# Ponte on-premise

Il **ponte** permette a un'app Spookyfy in **modalità client** (gateway su Vercel, libreria sul telefono) di cercare e importare brani tramite un server **on-premise**. Serve soprattutto quando YouTube blocca gli IP di Vercel: il server di casa scarica da un IP domestico, l'app copia poi audio, copertine e metadati sul dispositivo.

## 1. Abilitare il ponte sul server on-premise

Nel file d'ambiente del server (`/etc/spookyfy/spookyfy.env`) indica le origini delle app autorizzate, separate da virgola:

```bash
BRIDGE_ALLOWED_ORIGINS=https://spookyfy-client.vercel.app
```

Riavvia il servizio (`sudo systemctl restart spookyfy`). Senza questa variabile il ponte è **disabilitato**: i token non vengono accettati e nessuna richiesta da altre origini è consentita.

Con il ponte attivo:

- solo queste rotte accettano il token: ricerca remota, importazione, stato dei job e nuovo tentativo, lettura di un brano, audio e copertine;
- la gestione di account e token richiede sempre l'accesso con username e password (un token non può creare altri token);
- il CORS è concesso solo alle origini autorizzate e senza cookie;
- dopo 20 richieste con token non valido in 15 minuti dallo stesso IP, le successive vengono rifiutate fino alla fine della finestra.

## 2. Creare un token di accesso

**Dall'app on-premise**: Impostazioni → *Token di accesso* → scegli un nome (es. «iPhone client») → *Crea*. Il token compare **una sola volta**: copialo subito. Sul server resta solo il suo hash.

**Dalla riga di comando** del server:

```bash
cd /opt/spookyfy
sudo -u spookyfy bash -c 'set -a; . /etc/spookyfy/spookyfy.env; node apps/server/dist/cli.js token:create fede iPhone client'
sudo -u spookyfy bash -c 'set -a; . /etc/spookyfy/spookyfy.env; node apps/server/dist/cli.js token:list fede'
sudo -u spookyfy bash -c 'set -a; . /etc/spookyfy/spookyfy.env; node apps/server/dist/cli.js token:revoke <id>'
```

In sviluppo: `pnpm --filter @spookyfy/server cli token:create fede iPhone client`.

Un token agisce con i permessi del suo utente. Revocalo dalle impostazioni o con `token:revoke` se il telefono viene perso.

## 3. Configurare l'app in modalità client

Impostazioni → *Server di casa (ponte)*: indirizzo del server (es. `https://spookyfy.example.com`) e token → *Verifica e salva*. L'app controlla che il server sia on-premise, che il ponte sia abilitato e che il token sia valido.

Poi, quando YouTube blocca il gateway:

- in **Cerca** compare *Cerca tramite il server di casa*;
- su un risultato la cui importazione è stata bloccata compare *Importa tramite il server di casa*.

Il brano viene importato sul server di casa e poi copiato sul telefono; risulta in libreria solo dopo la copia completa.
