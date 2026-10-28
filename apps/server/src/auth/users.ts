import { ErrorCode, normalizeUsername, passwordSchema, usernameSchema } from '@spookyfy/shared';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { HttpError, notFound } from '../http-errors.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';

export interface UserRecord {
  id: string;
  username: string;
  createdAt: number;
}

export class UsernameTakenError extends HttpError {
  constructor() {
    super(409, ErrorCode.UsernameTaken, 'Username non disponibile', {
      username: ['Username non disponibile'],
    });
  }
}

/** Errore di validazione con tutti i messaggi, per campo. */
function validationError(field: string, messages: string[]): HttpError {
  return new HttpError(400, ErrorCode.ValidationFailed, messages[0] ?? 'Valore non valido', {
    [field]: messages,
  });
}

export function assertValidUsername(username: string): void {
  const r = usernameSchema.safeParse(username);
  if (!r.success)
    throw validationError(
      'username',
      r.error.issues.map((i) => i.message),
    );
}

export function assertValidPassword(password: string): void {
  const r = passwordSchema.safeParse(password);
  if (!r.success)
    throw validationError(
      'password',
      r.error.issues.map((i) => i.message),
    );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export class UserService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  findByUsername(username: string) {
    return this.db
      .select()
      .from(users)
      .where(eq(users.usernameNormalized, normalizeUsername(username)))
      .get();
  }

  findById(id: string): UserRecord | undefined {
    return this.db
      .select({ id: users.id, username: users.username, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id))
      .get();
  }

  async create(username: string, password: string): Promise<UserRecord> {
    assertValidUsername(username);
    assertValidPassword(password);
    if (this.findByUsername(username)) throw new UsernameTakenError();
    const passwordHash = await hashPassword(password);
    const record = { id: ulid(), username, createdAt: this.clock.now() };
    try {
      // Il vincolo UNIQUE è la garanzia vera: copre due registrazioni simultanee
      // che superano entrambe il controllo preventivo durante l'hashing.
      this.db
        .insert(users)
        .values({ ...record, usernameNormalized: normalizeUsername(username), passwordHash })
        .run();
    } catch (err) {
      if (isUniqueViolation(err)) throw new UsernameTakenError();
      throw err;
    }
    return record;
  }

  /** Restituisce l'utente se le credenziali sono corrette, altrimenti `undefined`. */
  async verifyCredentials(username: string, password: string): Promise<UserRecord | undefined> {
    const user = this.findByUsername(username);
    if (!user) {
      await verifyAgainstDummy(password);
      return undefined;
    }
    if (!(await verifyPassword(user.passwordHash, password))) return undefined;
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  }

  /** Cambia la password e chiude tutte le sessioni dell'utente. */
  async setPassword(username: string, password: string): Promise<void> {
    assertValidPassword(password);
    const user = this.findByUsername(username);
    if (!user) throw notFound(`Utente ${username} non trovato`);
    const passwordHash = await hashPassword(password);
    this.db.transaction((tx) => {
      tx.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
      tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
    });
  }

  list(): UserRecord[] {
    return this.db
      .select({ id: users.id, username: users.username, createdAt: users.createdAt })
      .from(users)
      .orderBy(asc(users.usernameNormalized))
      .all();
  }

  /** Elimina l'account; sessioni, preferiti, playlist e storico seguono per cascata. */
  delete(username: string): void {
    const user = this.findByUsername(username);
    if (!user) throw notFound(`Utente ${username} non trovato`);
    this.db.delete(users).where(eq(users.id, user.id)).run();
  }
}
