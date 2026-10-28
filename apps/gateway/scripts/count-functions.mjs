// Conta le funzioni serverless che Vercel crea da api/ e fallisce oltre il limite.
// Su Vercel ogni file .js/.ts/.mjs in api/ diventa una funzione, tranne quelli che
// iniziano con "_" o "." e le dichiarazioni di tipo.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_FUNCTIONS = 12;

export function listFunctions(apiDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.(m?js|ts)$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !/\.test\./.test(entry.name)
      ) {
        out.push(path.relative(apiDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(apiDir);
  return out.sort();
}

export function checkFunctions(apiDir, max = MAX_FUNCTIONS) {
  const fns = listFunctions(apiDir);
  return { ok: fns.length <= max, count: fns.length, max, functions: fns };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const apiDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'api'));
  const r = checkFunctions(apiDir);
  console.log(`Funzioni serverless: ${r.count}/${r.max}`);
  for (const f of r.functions) console.log(`  - api/${f}`);
  if (!r.ok) {
    console.error(`Troppe funzioni: ${r.count} su un massimo di ${r.max} (piano Hobby di Vercel).`);
    process.exit(1);
  }
}
