import path from 'node:path';
import { runCli, terminalIo } from './cli/commands.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db/client.js';

try {
  const config = loadConfig();
  const database = openDatabase(path.join(config.dataDir, 'spookyfy.db'));
  const code = await runCli(process.argv.slice(2), { ...terminalIo(), db: database.db });
  database.close();
  process.exit(code);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
