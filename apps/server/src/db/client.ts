import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

/** Apre (o crea) il database, imposta le pragma e applica le migrazioni mancanti. */
export function openDatabase(file: string): DatabaseHandle {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite, close: () => sqlite.close() };
}
