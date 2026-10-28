// Copia il build della PWA in public/, servito da Vercel come file statici.
import fs from 'node:fs';
import path from 'node:path';

const from = path.resolve(import.meta.dirname, '../../web/dist');
const to = path.resolve(import.meta.dirname, '../public');
if (!fs.existsSync(path.join(from, 'index.html'))) {
  console.error(`Build della PWA non trovato in ${from}`);
  process.exit(1);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`PWA copiata in ${to}`);
