// Avvia il server di produzione per i test e2e con database e media nuovi.
// (Playwright avvia il web server prima di globalSetup: la pulizia va fatta qui.)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

fs.rmSync(path.join(import.meta.dirname, '.data'), { recursive: true, force: true });
await import(pathToFileURL(path.resolve(import.meta.dirname, '../apps/server/dist/main.js')).href);
