# Deploy su Vercel da zero

Gateway e PWA della modalità client sono **un solo progetto Vercel** (Root Directory `apps/gateway`): la stessa URL serve l'app da installare sul telefono e le API. Il database è **Redis Cloud Free (30 MB)** dal Marketplace di Vercel, gratuito.

Istanza attuale: **https://spookyfy-ten.vercel.app** (progetto `spookyfy`).

## 1. Progetto e collegamento

Dalla radice del repository, con la [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`):

```bash
vercel login
vercel project add spookyfy
vercel link --yes --project spookyfy --scope <team>        # <team>: vedi `vercel teams ls`
```

Poi nella dashboard: **Settings → Build and Deployment**
- **Root Directory**: `apps/gateway`
- **Include files outside the root directory**: attivo
- **Framework Preset**: Other · **Node.js Version**: 22.x

Il resto (installazione pnpm, build della PWA, funzioni, region `fra1`) è in `apps/gateway/vercel.json`.

## 2. Database (gratuito)

```bash
vercel integration add redis --plan 26483 -m Region=fra1 -m HighAvailability=None -n spookyfy-redis -e production
vercel env ls        # deve comparire REDIS_URL
```

`26483` è il piano **Free — 30 MB** (uno per account). Se l'id cambiasse, i piani si vedono dalla dashboard: *Storage → Create Database → Redis*. Nel database finiscono solo account, revoche di sessione e contatori anti-tentativi.

## 3. Variabili d'ambiente

```bash
vercel env add SESSION_SECRET production --sensitive --yes --value "$(openssl rand -base64 48)"
vercel env add REGISTRATION_TOKEN production --sensitive --yes --value 'il-tuo-token-di-invito'
```

`PUBLIC_ORIGIN` serve solo con un dominio personalizzato. Senza `REGISTRATION_TOKEN` vale `spotifymerdacostosa2026`, pubblico in questo repository: chiunque lo legga può registrarsi.

## 4. Primo deploy

```bash
vercel deploy --prod
```

Il build avviene sui server di Vercel. **Non usare `vercel build` + `--prebuilt` da Windows**: i link di pnpm e il binario nativo di argon2 non funzionano su Linux e le funzioni falliscono con `ERR_MODULE_NOT_FOUND`.

Verifica:

```bash
curl https://<progetto>.vercel.app/api/health    # {"status":"ok","mode":"client",...}
VERIFY_REGISTRATION_TOKEN='il-tuo-token-di-invito' pnpm verify:prod https://<progetto>.vercel.app
```

Verifica completa (API e browser) e cosa fare se la registrazione non va: [verifica-deploy.md](verifica-deploy.md).

## 5. Deploy automatico dalla CI di GitHub

Il job `deploy-vercel` di `.github/workflows/ci.yml` pubblica in produzione a ogni push su `main`, dopo lint, test ed e2e, poi controlla `/api/health`. Una tantum:

1. Crea un token su **https://vercel.com/account/settings/tokens** → *Create Token*, con **Scope: il team del progetto** (es. «federicocunico94-1584's projects»), non limitato a un singolo progetto. Un token limitato al progetto riceve 403 sul team e la CLI fallisce con «Could not retrieve Project Settings»; il job lo segnala nel passo «Token Vercel con accesso al team».
2. Salva token, ID e URL nel repository:

   ```bash
   gh secret set VERCEL_TOKEN                                         # incolla il token
   gh secret set VERCEL_ORG_ID --body "$(node -p "require('./.vercel/project.json').orgId")"
   gh secret set VERCEL_PROJECT_ID --body "$(node -p "require('./.vercel/project.json').projectId")"
   gh variable set VERCEL_PRODUCTION_URL --body https://<progetto>.vercel.app
   gh secret set VERIFY_REGISTRATION_TOKEN                            # token di invito, per la verifica dopo il deploy
   ```

Dopo il deploy, il job `verify-production` registra un account di prova sulla produzione (API e browser) e poi lo elimina: vedi [verifica-deploy.md](verifica-deploy.md).

Il progetto non è collegato a Git su Vercel, quindi non ci sono deploy doppi: pubblica solo la CI.

## 6. Account

Dall'app: *Crea un account* con il token di invito. Oppure dal computer:

```bash
vercel env pull apps/gateway/.env --environment=production --yes
pnpm --filter @spookyfy/gateway cli user:create fede
pnpm --filter @spookyfy/gateway cli user:list
```

`apps/gateway/.env` contiene segreti ed è ignorato da git.

## 7. Prova sul telefono

Apri l'URL del progetto in Safari (iPhone) o Chrome (Android) → *Aggiungi a schermata Home* / *Installa app* → apri dall'icona → crea l'account. Checklist: sezione «Modalità client» di [verification-ios.md](verification-ios.md) e [verification-android.md](verification-android.md).

## Limite noto: YouTube da Vercel

Prova del 28/10/2026 da `fra1`: la **ricerca funziona**, ma metadati e audio vengono rifiutati dalla verifica anti-bot di YouTube (`YOUTUBE_BLOCKED`). Il gateway non aggira questi controlli. Per aggiungere brani usa quindi:

- **Libreria → Importa da file** (MP3/M4A dal telefono);
- il **ponte verso un server on-premise** ([bridge.md](bridge.md)), che scarica con `yt-dlp` da un IP domestico.
