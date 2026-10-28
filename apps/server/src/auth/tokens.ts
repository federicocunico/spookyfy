import { randomBytes } from 'node:crypto';
import type { MeDto } from '@spookyfy/shared';
import { and, desc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';
import { accessTokens, users } from '../db/schema.js';
import { notFound } from '../http-errors.js';
import { hashToken } from './sessions.js';

export const TOKEN_PREFIX = 'spk_';
/** L'ultimo utilizzo viene scritto al massimo una volta all'ora. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AccessTokenDto {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/**
 * Token di accesso personali per il ponte: il valore in chiaro viene mostrato
 * una sola volta, sul server resta solo lo SHA-256.
 */
export class AccessTokenService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  create(userId: string, name: string): { token: string; record: AccessTokenDto } {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const record = { id: ulid(), name, createdAt: this.clock.now(), lastUsedAt: null };
    this.db
      .insert(accessTokens)
      .values({ ...record, userId, tokenHash: hashToken(token) })
      .run();
    return { token, record };
  }

  list(userId: string): AccessTokenDto[] {
    return this.db
      .select({
        id: accessTokens.id,
        name: accessTokens.name,
        createdAt: accessTokens.createdAt,
        lastUsedAt: accessTokens.lastUsedAt,
      })
      .from(accessTokens)
      .where(eq(accessTokens.userId, userId))
      .orderBy(desc(accessTokens.createdAt))
      .all();
  }

  /** Revoca un token dell'utente (con `userId` undefined: qualunque utente, per la CLI). */
  revoke(id: string, userId?: string): void {
    const where = userId
      ? and(eq(accessTokens.id, id), eq(accessTokens.userId, userId))
      : eq(accessTokens.id, id);
    const r = this.db.delete(accessTokens).where(where).run();
    if (r.changes === 0) throw notFound('Token non trovato');
  }

  /** L'utente del token, se valido. */
  validate(token: string | undefined): MeDto | undefined {
    if (!token?.startsWith(TOKEN_PREFIX) || token.length > 128) return undefined;
    const row = this.db
      .select({
        id: accessTokens.id,
        lastUsedAt: accessTokens.lastUsedAt,
        userId: users.id,
        username: users.username,
        createdAt: users.createdAt,
      })
      .from(accessTokens)
      .innerJoin(users, eq(users.id, accessTokens.userId))
      .where(eq(accessTokens.tokenHash, hashToken(token)))
      .get();
    if (!row) return undefined;
    const now = this.clock.now();
    if (row.lastUsedAt === null || now - row.lastUsedAt >= TOUCH_INTERVAL_MS) {
      this.db.update(accessTokens).set({ lastUsedAt: now }).where(eq(accessTokens.id, row.id)).run();
    }
    return { id: row.userId, username: row.username, createdAt: row.createdAt };
  }
}
