import { GatewayUsers } from './auth.js';
import { HttpError } from './http.js';
import type { Clock, Kv } from './kv.js';

export interface GatewayCliIo {
  kv: Kv;
  clock: Clock;
  interactive: boolean;
  readPassword(prompt: string): Promise<string>;
  out(line: string): void;
  err(line: string): void;
}

const USAGE = `Uso: pnpm --filter @spookyfy/gateway cli <comando> [argomenti]

Gestisce gli account del gateway (modalità client) direttamente sul KV Upstash:
servono KV_REST_API_URL e KV_REST_API_TOKEN nel file apps/gateway/.env.

Comandi:
  user:create <username>   crea un account (password chiesta in modo nascosto)
  user:passwd <username>   reimposta la password e invalida tutte le sessioni
  user:list                elenca gli account
  user:delete <username>   elimina l'account e invalida le sessioni`;

async function readNewPassword(io: GatewayCliIo): Promise<string | undefined> {
  const pw = await io.readPassword('Password: ');
  if (!io.interactive) return pw;
  if ((await io.readPassword('Conferma password: ')) !== pw) {
    io.err('Le password non coincidono.');
    return undefined;
  }
  return pw;
}

export async function runGatewayCli(argv: string[], io: GatewayCliIo): Promise<number> {
  const [command, username] = argv;
  const users = new GatewayUsers(io.kv, io.clock);
  if (!command || command === 'help' || command === '--help') {
    io.out(USAGE);
    return command ? 0 : 1;
  }
  if (['user:create', 'user:passwd', 'user:delete'].includes(command) && !username) {
    io.err(`Manca lo username.\n\n${USAGE}`);
    return 1;
  }
  try {
    switch (command) {
      case 'user:create': {
        const pw = await readNewPassword(io);
        if (pw === undefined) return 1;
        const u = await users.create(username!, pw);
        io.out(`Account ${u.username} creato.`);
        return 0;
      }
      case 'user:passwd': {
        const pw = await readNewPassword(io);
        if (pw === undefined) return 1;
        await users.setPassword(username!, pw);
        io.out(`Password di ${username} aggiornata; le sessioni aperte sono state invalidate.`);
        return 0;
      }
      case 'user:list': {
        const list = await users.list();
        if (list.length === 0) io.out('Nessun account.');
        for (const u of list)
          io.out(`${u.username}\tcreato il ${new Date(u.createdAt).toISOString().slice(0, 10)}`);
        return 0;
      }
      case 'user:delete': {
        await users.delete(username!);
        io.out(`Account ${username} eliminato.`);
        return 0;
      }
      default:
        io.err(`Comando sconosciuto: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    if (err instanceof HttpError) {
      const details = Object.values(err.fields ?? {}).flat();
      io.err(
        details.length > 1
          ? `Errore:\n${details.map((d) => `  - ${d}`).join('\n')}`
          : `Errore: ${err.message}`,
      );
      return 1;
    }
    throw err;
  }
}
