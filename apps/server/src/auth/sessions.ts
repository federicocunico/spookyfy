import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Il rinnovo "sliding" scrive sul DB al massimo una volta ogni ora per sessione. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface ValidSession {
  sessionId: string;
  user: { id: string; username: string; createdAt: number };
  expiresAt: number;
  /** true se la scadenza è stata appena estesa: il cookie va reimpostato. */
  renewed: boolean;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  create(userId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    const expiresAt = now + SESSION_TTL_MS;
    this.db
      .insert(sessions)
      .values({ id: ulid(), userId, tokenHash: hashToken(token), createdAt: now, lastUsedAt: now, expiresAt })
      .run();
    return { token, expiresAt };
  }

  validate(token: string | undefined): ValidSession | undefined {
    if (!token || token.length > 128) return undefined;
    const row = this.db
      .select({
        id: sessions.id,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        username: users.username,
        createdAt: users.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)))
      .get();
    if (!row) return undefined;
    const now = this.clock.now();
    if (row.expiresAt <= now) {
      this.db.delete(sessions).where(eq(sessions.id, row.id)).run();
      return undefined;
    }
    let expiresAt = row.expiresAt;
    let renewed = false;
    if (now - row.lastUsedAt >= SESSION_TOUCH_INTERVAL_MS) {
      expiresAt = now + SESSION_TTL_MS;
      renewed = true;
      this.db.update(sessions).set({ lastUsedAt: now, expiresAt }).where(eq(sessions.id, row.id)).run();
    }
    return {
      sessionId: row.id,
      user: { id: row.userId, username: row.username, createdAt: row.createdAt },
      expiresAt,
      renewed,
    };
  }

  revoke(token: string): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
  }
}
