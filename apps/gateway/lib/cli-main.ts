import readline from 'node:readline';
import { runGatewayCli } from './cli.js';
import { kvConfigFromEnv } from './config.js';
import { createKv, systemClock } from './kv.js';

const kvConfig = kvConfigFromEnv(process.env);
if (!kvConfig) {
  console.error(
    'Manca REDIS_URL (o KV_REST_API_URL e KV_REST_API_TOKEN): esegui vercel env pull apps/gateway/.env',
  );
  process.exit(1);
}

let lines: AsyncIterableIterator<string> | undefined;
async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    lines ??= readline.createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
    const next = await lines.next();
    return next.done ? '' : next.value;
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    out._writeToOutput = (s) => {
      if (!muted || s.includes('\n')) process.stdout.write(muted ? '\n' : s);
    };
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a);
    });
    muted = true;
  });
}

const code = await runGatewayCli(process.argv.slice(2), {
  kv: createKv(kvConfig),
  clock: systemClock,
  interactive: Boolean(process.stdin.isTTY),
  readPassword,
  out: (l) => console.log(l),
  err: (l) => console.error(l),
});
process.exit(code);
