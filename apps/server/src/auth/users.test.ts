import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { STRONG_PASSWORD, type TestContext, createTestContext } from '../../test/helpers.js';
import { favorites, playlists, sessions } from '../db/schema.js';
import { HttpError } from '../http-errors.js';
import { SessionService } from './sessions.js';
import { UserService } from './users.js';

let ctx: TestContext;
let users: UserService;
beforeEach(async () => {
  ctx = await createTestContext();
  users = new UserService(ctx.database.db, ctx.clock);
});
afterEach(() => ctx.cleanup());

describe('UserService', () => {
  test('crea un account e verifica le credenziali', async () => {
    const u = await users.create('Fede', STRONG_PASSWORD);
    expect(u.username).toBe('Fede');
    expect(await users.verifyCredentials('fede', STRONG_PASSWORD)).toMatchObject({ id: u.id });
    expect(await users.verifyCredentials('fede', 'Sbagliata#1')).toBeUndefined();
    expect(await users.verifyCredentials('nessuno', STRONG_PASSWORD)).toBeUndefined();
  });

  test('salva solo l’hash Argon2id', async () => {
    await users.create('fede', STRONG_PASSWORD);
    const row = users.findByUsername('fede')!;
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(STRONG_PASSWORD);
  });

  test('Fede viene rifiutato se esiste fede', async () => {
    await users.create('fede', STRONG_PASSWORD);
    await expect(users.create('Fede', STRONG_PASSWORD)).rejects.toMatchObject({
      statusCode: 409,
      code: 'USERNAME_TAKEN',
    });
  });

  test('applica i requisiti di password e username', async () => {
    await expect(users.create('fede', 'luna')).rejects.toBeInstanceOf(HttpError);
    await expect(users.create('fe', STRONG_PASSWORD)).rejects.toMatchObject({ statusCode: 400 });
    expect(users.list()).toEqual([]);
  });

  test('cambio password: la nuova funziona e le sessioni vengono chiuse', async () => {
    const u = await users.create('fede', STRONG_PASSWORD);
    const s = new SessionService(ctx.database.db, ctx.clock);
    const { token } = s.create(u.id);
    await users.setPassword('fede', 'Nuova_2026');
    expect(await users.verifyCredentials('fede', 'Nuova_2026')).toBeDefined();
    expect(s.validate(token)).toBeUndefined();
    await expect(users.setPassword('fede', 'corta')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('elenca gli account in ordine alfabetico', async () => {
    await users.create('zeta', STRONG_PASSWORD);
    await users.create('Anna', STRONG_PASSWORD);
    expect(users.list().map((u) => u.username)).toEqual(['Anna', 'zeta']);
  });

  test('l’eliminazione rimuove sessioni e dati personali', async () => {
    const u = await users.create('fede', STRONG_PASSWORD);
    new SessionService(ctx.database.db, ctx.clock).create(u.id);
    const db = ctx.database.db;
    db.insert(playlists).values({ id: 'p1', ownerId: u.id, name: 'Notte', createdAt: 0, updatedAt: 0 }).run();
    users.delete('fede');
    expect(db.select().from(sessions).all()).toEqual([]);
    expect(db.select().from(playlists).all()).toEqual([]);
    expect(db.select().from(favorites).all()).toEqual([]);
    expect(() => users.delete('fede')).toThrow(/non trovato/);
  });
});
