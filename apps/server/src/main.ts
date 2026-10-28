import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, DEFAULT_REGISTRATION_TOKEN, loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { detectHardware } from './hardware.js';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.mediaDir, { recursive: true });

const hardware = detectHardware();
const database = openDatabase(path.join(config.dataDir, 'spookyfy.db'));
const app = await buildApp({ config, database, hardware });

app.log.info(
  {
    cores: hardware.cores,
    totalMemMiB: Math.round(hardware.totalMemBytes / 1024 / 1024),
    arch: hardware.arch,
    platform: hardware.platform,
    ingestConcurrency: app.ctx.ingestConcurrency,
    ingestConcurrencySource: config.ingestConcurrency === undefined ? 'auto' : 'INGEST_CONCURRENCY',
  },
  'profilo hardware rilevato',
);
if (config.registrationToken === DEFAULT_REGISTRATION_TOKEN) {
  app.log.warn(
    'REGISTRATION_TOKEN usa il valore predefinito pubblicato nel repository: impostane uno diverso in produzione',
  );
} else if (config.registrationToken === '') {
  app.log.info('registrazione dall’app disabilitata (REGISTRATION_TOKEN vuoto)');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'arresto in corso');
  await app.close();
  database.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
