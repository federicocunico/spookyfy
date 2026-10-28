import readline from 'node:readline';
import { runGatewayCli } from './cli.js';
import { UpstashKv, systemClock } from './kv.js';

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error(
    'Mancano KV_REST_API_URL e KV_REST_API_TOKEN (copiali dal progetto Vercel in apps/gateway/.env).',
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
  kv: new UpstashKv(url, token),
  clock: systemClock,
  interactive: Boolean(process.stdin.isTTY),
  readPassword,
  out: (l) => console.log(l),
  err: (l) => console.error(l),
});
process.exit(code);
