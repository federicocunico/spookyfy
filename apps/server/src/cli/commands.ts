import readline from 'node:readline';
import { tokenNameSchema } from '../auth/token-routes.js';
import { AccessTokenService } from '../auth/tokens.js';
import { UserService } from '../auth/users.js';
import { systemClock } from '../clock.js';
import type { Db } from '../db/client.js';
import { HttpError } from '../http-errors.js';

export interface CliIo {
  db: Db;
  /** true su terminale: la password viene chiesta due volte. */
  interactive: boolean;
  /** Legge una password senza mostrarla (o una riga da stdin se non è un terminale). */
  readPassword(prompt: string): Promise<string>;
  out(line: string): void;
  err(line: string): void;
}

const USAGE = `Uso: pnpm --filter @spookyfy/server cli <comando> [argomenti]

Comandi:
  user:create <username>   crea un account (password chiesta in modo nascosto)
  user:passwd <username>   reimposta la password e chiude le sessioni aperte
  user:list                elenca gli account
  user:delete <username>   elimina l'account con preferiti, playlist e storico
  token:create <username> <nome>   crea un token di accesso per il ponte (mostrato una volta)
  token:list <username>            elenca i token dell'utente
  token:revoke <id>                revoca un token

La password non si passa mai come argomento: viene letta dal terminale o da stdin.`;

async function readNewPassword(io: CliIo): Promise<string | undefined> {
  const password = await io.readPassword('Password: ');
  if (!io.interactive) return password;
  const confirm = await io.readPassword('Conferma password: ');
  if (confirm !== password) {
    io.err('Le password non coincidono.');
    return undefined;
  }
  return password;
}

function reportError(io: CliIo, err: unknown): number {
  if (err instanceof HttpError) {
    const details = Object.values(err.fields ?? {}).flat();
    io.err(
      details.length > 1 ? `Errore:\n${details.map((d) => `  - ${d}`).join('\n')}` : `Errore: ${err.message}`,
    );
    return 1;
  }
  throw err;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, username, ...rest] = argv;
  const users = new UserService(io.db, systemClock);
  const tokens = new AccessTokenService(io.db, systemClock);
  const needsUsername =
    command === 'user:create' ||
    command === 'user:passwd' ||
    command === 'user:delete' ||
    command === 'token:create' ||
    command === 'token:list';
  if (!command || command === 'help' || command === '--help') {
    io.out(USAGE);
    return command ? 0 : 1;
  }
  if (needsUsername && !username) {
    io.err(`Manca lo username.\n\n${USAGE}`);
    return 1;
  }

  try {
    switch (command) {
      case 'user:create': {
        const password = await readNewPassword(io);
        if (password === undefined) return 1;
        const user = await users.create(username!, password);
        io.out(`Account ${user.username} creato.`);
        return 0;
      }
      case 'user:passwd': {
        const password = await readNewPassword(io);
        if (password === undefined) return 1;
        await users.setPassword(username!, password);
        io.out(`Password di ${username} aggiornata; le sessioni aperte sono state chiuse.`);
        return 0;
      }
      case 'user:list': {
        const list = users.list();
        if (list.length === 0) io.out('Nessun account.');
        for (const u of list)
          io.out(`${u.username}\tcreato il ${new Date(u.createdAt).toISOString().slice(0, 10)}`);
        return 0;
      }
      case 'user:delete': {
        users.delete(username!);
        io.out(`Account ${username} eliminato.`);
        return 0;
      }
      case 'token:create': {
        const parsed = tokenNameSchema.safeParse(rest.join(' '));
        if (!parsed.success) {
          io.err(`Errore: ${parsed.error.issues[0]?.message ?? 'nome non valido'}`);
          return 1;
        }
        const user = users.findByUsername(username!);
        if (!user) {
          io.err(`Errore: utente ${username} non trovato`);
          return 1;
        }
        const { token, record } = tokens.create(user.id, parsed.data);
        io.out(`Token «${record.name}» creato (id ${record.id}). Copialo ora, non verrà più mostrato:`);
        io.out(token);
        return 0;
      }
      case 'token:list': {
        const user = users.findByUsername(username!);
        if (!user) {
          io.err(`Errore: utente ${username} non trovato`);
          return 1;
        }
        const list = tokens.list(user.id);
        if (list.length === 0) io.out('Nessun token.');
        for (const t of list) {
          const used = t.lastUsedAt ? new Date(t.lastUsedAt).toISOString().slice(0, 10) : 'mai';
          io.out(
            `${t.id}	${t.name}	creato il ${new Date(t.createdAt).toISOString().slice(0, 10)}	ultimo uso: ${used}`,
          );
        }
        return 0;
      }
      case 'token:revoke': {
        if (!username) {
          io.err(`Manca l'id del token.

${USAGE}`);
          return 1;
        }
        tokens.revoke(username);
        io.out(`Token ${username} revocato.`);
        return 0;
      }
      default:
        io.err(`Comando sconosciuto: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    return reportError(io, err);
  }
}

let stdinLines: AsyncIterableIterator<string> | undefined;

/** I/O reale: prompt nascosto su terminale, altrimenti una riga per volta da stdin. */
export function terminalIo(): Omit<CliIo, 'db'> {
  return {
    interactive: Boolean(process.stdin.isTTY),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    async readPassword(prompt) {
      if (!process.stdin.isTTY) {
        stdinLines ??= readline
          .createInterface({ input: process.stdin, terminal: false })
          [Symbol.asyncIterator]();
        const next = await stdinLines.next();
        return next.done ? '' : next.value;
      }
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const output = rl as unknown as { _writeToOutput: (s: string) => void };
        let muted = false;
        output._writeToOutput = (s: string) => {
          if (!muted || s.includes('\n')) process.stdout.write(muted ? '\n' : s);
        };
        rl.question(prompt, (answer) => {
          rl.close();
          resolve(answer);
        });
        muted = true;
      });
    },
  };
}
