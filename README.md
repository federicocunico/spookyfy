# Spookyfy

Player musicale personale e self-hosted: una **PWA** installabile su iPhone e Android che si comporta come un'app nativa (audio in background, controlli in lockscreen, ascolto offline) e un **server on-premise** che importa i brani da YouTube con `yt-dlp`, esposto su Internet tramite **Cloudflare Tunnel** senza aprire porte sul router.

- **Server**: Node.js + TypeScript (Fastify), SQLite, `yt-dlp` + `ffmpeg`. Serve API e PWA dalla stessa origine.
- **App**: Svelte 5 + Vite, Service Worker per l'avvio offline e la riproduzione dei brani scaricati.
- **Hardware**: da Raspberry Pi 4/5 o mini-PC (profilo minimo) a server più potenti, arm64 o x64, Linux.

> `yt-dlp` è usato a uso personale. Il rispetto dei termini delle piattaforme da cui si scaricano i contenuti è responsabilità di chi installa e usa Spookyfy.

## Struttura

```
apps/server      API, ingestione (yt-dlp), CLI account, serve il build della PWA
apps/web         PWA Svelte 5
packages/shared  tipi e schemi condivisi (password, username, DTO, eventi)
e2e              test end-to-end Playwright (Chromium e WebKit)
deploy           systemd e Cloudflare Tunnel
docs             documentazione (autenticazione, verifiche manuali)
```

## Requisiti

- Linux arm64 o x64 (Raspberry Pi OS 64 bit, Debian, Ubuntu…)
- Node.js **22 LTS** o successivo, pnpm (via `corepack enable`)
- `ffmpeg`
- `yt-dlp` (binario standalone, aggiornato spesso)
- `cloudflared` e un dominio gestito da Cloudflare

## Installazione sul server (Raspberry Pi, mini-PC o server)

```bash
# Dipendenze di sistema
sudo apt update && sudo apt install -y ffmpeg git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo corepack enable
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Utente di servizio e cartelle dei dati
sudo useradd --system --home /var/lib/spookyfy --shell /usr/sbin/nologin spookyfy
sudo mkdir -p /var/lib/spookyfy/data /var/lib/spookyfy/media /etc/spookyfy
sudo chown -R spookyfy:spookyfy /var/lib/spookyfy

# Codice e build
sudo git clone <url-del-repository> /opt/spookyfy && cd /opt/spookyfy
sudo pnpm install --frozen-lockfile
sudo pnpm build
```

## Configurazione

Copia l'esempio e modificalo:

```bash
sudo cp apps/server/.env.example /etc/spookyfy/spookyfy.env
sudo chmod 640 /etc/spookyfy/spookyfy.env && sudo chown root:spookyfy /etc/spookyfy/spookyfy.env
sudo nano /etc/spookyfy/spookyfy.env
```

| Variabile | Default | Descrizione |
|---|---|---|
| `PUBLIC_ORIGIN` | — (obbligatoria in produzione) | Origine pubblica, es. `https://spookyfy.example.com`. Usata per il controllo CSRF. |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Indirizzo di ascolto (solo locale: lo espone il tunnel). |
| `DATA_DIR` | `./data` | Database SQLite. |
| `MEDIA_DIR` | `./media` | MP3 e copertine. |
| `REGISTRATION_TOKEN` | `spotifymerdacostosa2026` | Token di invito per la registrazione; vuoto = registrazione disabilitata. |
| `YTDLP_PATH` / `FFMPEG_PATH` | `yt-dlp` / (dal PATH) | Eseguibili esterni. |
| `INGEST_CONCURRENCY` | metà dei core (1–8) | Importazioni contemporanee. |
| `INGEST_NICE` | `10` | Priorità di yt-dlp/ffmpeg (0 = normale, 19 = minima). |
| `TRUST_CF_HEADERS` | `true` | IP del client da `CF-Connecting-IP` (per il rate limit dei login). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`… |

`COOKIE_SECURE` e `YTDLP_NODE_SCRIPT` esistono solo per i test end-to-end: non vanno usate in produzione.

### Token di registrazione e primo utente

**Cambia `REGISTRATION_TOKEN`**: il valore predefinito è pubblicato in questo repository e chiunque lo legga potrebbe registrarsi. Se resta quello predefinito, all'avvio il server scrive un avviso nel log. Condividi il token con chi deve creare un account; quando non servono altre registrazioni, lascialo vuoto (`REGISTRATION_TOKEN=`) e riavvia il servizio.

Il primo account si crea dall'app ("Crea un account", con il token) oppure dalla riga di comando, senza token:

```bash
cd /opt/spookyfy
sudo -u spookyfy bash -c 'set -a; . /etc/spookyfy/spookyfy.env; node /opt/spookyfy/apps/server/dist/cli.js user:create fede'
```

Username: 3–32 caratteri (lettere, cifre, `.`, `_`, `-`), unici senza distinzione di maiuscole. Password: almeno 8 caratteri con lettere, cifre e almeno un carattere speciale. Tutti i comandi di gestione degli account sono in [docs/auth.md](docs/auth.md).

### Servizio systemd

```bash
sudo cp deploy/spookyfy.service /etc/systemd/system/
sudo cp deploy/yt-dlp-update.service deploy/yt-dlp-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spookyfy yt-dlp-update.timer
journalctl -u spookyfy -f   # all'avvio stampa il profilo hardware e la concorrenza scelta
```

## Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create spookyfy
cloudflared tunnel route dns spookyfy spookyfy.example.com
sudo mkdir -p /etc/cloudflared
sudo cp deploy/cloudflared/config.yml /etc/cloudflared/config.yml   # sostituisci UUID e dominio
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
cloudflared tunnel ingress validate
sudo cloudflared service install
```

Nella dashboard di Cloudflare aggiungi una **Cache Rule** con *Bypass cache* per il percorso `/api/*`: audio e copertine sono già marcati `Cache-Control: private` e non vengono conservati dall'edge, ma la regola rende esplicito che nessuna risposta dell'API passa dalla cache condivisa. I WebSocket (`/api/ws`) funzionano attraverso il tunnel senza configurazioni aggiuntive.

## Dimensionamento

| Profilo | Esempio | `INGEST_CONCURRENCY` | `INGEST_NICE` | Note |
|---|---|---|---|---|
| Minimo | Raspberry Pi 4/5, 4 GB | auto (= 2) | 10 | Le conversioni restano in secondo piano rispetto allo streaming. |
| Medio | mini-PC x64, 4–8 core | auto (= 2–4) | 5–10 | |
| Potente | server, 16+ core | auto (= 8) o più | 0 | Il default è limitato a 8; si può alzare fino a 32. |

SQLite in modalità WAL regge senza problemi l'uso previsto (pochi utenti, migliaia di brani) su ogni profilo. Lo spazio su disco è la risorsa principale: un brano MP3 occupa in media 4–10 MB.

## Installare l'app sul telefono

- **iPhone (Safari)**: apri `https://spookyfy.example.com`, tocca *Condividi* → *Aggiungi a schermata Home*. Apri Spookyfy dall'icona: solo l'app installata ottiene lo storage persistente e i controlli in lockscreen come un'app nativa. La prima riproduzione parte toccando Play.
- **Android (Chrome)**: apri l'indirizzo e accetta *Installa app* (o menu ⋮ → *Installa app*).

Funzioni principali: ricerca nella libreria e su YouTube, importazione con avanzamento in tempo reale, preferiti, playlist con riordino, coda con shuffle e repeat, download per brano o per playlist (con lo schermo tenuto acceso e la modalità schermo scuro), ascolto offline. Se il sistema elimina i brani scaricati per mancanza di spazio, vengono riprodotti in streaming.

## Backup

Basta salvare database e cartella media:

```bash
# Copia coerente del database anche a servizio avviato
sqlite3 /var/lib/spookyfy/data/spookyfy.db "VACUUM INTO '/backup/spookyfy-$(date +%F).db'"
rsync -a /var/lib/spookyfy/media/ /backup/spookyfy-media/
```

Per ripristinare: ferma il servizio, rimetti il file del database in `DATA_DIR` (con nome `spookyfy.db`) e la cartella media in `MEDIA_DIR`, riavvia.

## Aggiornare Spookyfy

```bash
cd /opt/spookyfy && sudo git pull && sudo pnpm install --frozen-lockfile && sudo pnpm build
sudo systemctl restart spookyfy
```

Le migrazioni del database vengono applicate automaticamente all'avvio. Le app installate mostrano "Nuova versione disponibile" e si aggiornano su conferma (o al riavvio successivo), senza interrompere la musica.

## Sviluppo

```bash
corepack enable
pnpm install
cp apps/server/.env.example apps/server/.env   # imposta NODE_ENV=development e PUBLIC_ORIGIN=http://localhost:5173
pnpm dev            # server su :8787, Vite su :5173 (proxy /api e WebSocket)
pnpm test           # unit e integrazione (shared, server, web)
pnpm test:e2e       # build + Playwright (serve: pnpm --filter @spookyfy/e2e exec playwright install chromium webkit)
pnpm lint && pnpm typecheck
```

I test del server usano uno yt-dlp finto (`apps/server/test/fixtures/fake-ytdlp.mjs`). Per provare l'importazione reale con yt-dlp e ffmpeg installati:

```bash
SPOOKYFY_REAL_YTDLP=1 pnpm --filter @spookyfy/server exec vitest run test/real-ytdlp.test.ts
```
