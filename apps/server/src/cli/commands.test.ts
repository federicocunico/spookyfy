import { afterEach, beforeEach, expect, test } from 'vitest';
import { type TestContext, createTestContext } from '../../test/helpers.js';
import { UserService } from '../auth/users.js';
import { type CliIo, runCli } from './commands.js';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());

function io(passwords: string[], interactive = false) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIo = {
    db: ctx.database.db,
    interactive,
    readPassword: async () => passwords.shift() ?? '',
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { cli, out, err };
}

test('user:create crea l’account', async () => {
  const { cli, out } = io(['Luna_2026']);
  expect(await runCli(['user:create', 'anna'], cli)).toBe(0);
  expect(out.join('\n')).toContain('Account anna creato');
  expect(
    await new UserService(ctx.database.db, ctx.clock).verifyCredentials('anna', 'Luna_2026'),
  ).toBeDefined();
});

test('user:create con password "luna" fallisce elencando i requisiti mancanti', async () => {
  const { cli, err } = io(['luna']);
  expect(await runCli(['user:create', 'anna'], cli)).toBe(1);
  const msg = err.join('\n');
  expect(msg).toContain('almeno 8 caratteri');
  expect(msg).toContain('cifra');
  expect(msg).toContain('carattere speciale');
  expect(new UserService(ctx.database.db, ctx.clock).list()).toEqual([]);
});

test('su terminale la password va confermata', async () => {
  const { cli, err } = io(['Luna_2026', 'Altra_2026'], true);
  expect(await runCli(['user:create', 'anna'], cli)).toBe(1);
  expect(err.join()).toContain('non coincidono');
});

test('user:list, user:passwd e user:delete', async () => {
  await runCli(['user:create', 'anna'], io(['Luna_2026']).cli);
  const list = io([]);
  expect(await runCli(['user:list'], list.cli)).toBe(0);
  expect(list.out.join()).toContain('anna');

  expect(await runCli(['user:passwd', 'anna'], io(['Sole_2027']).cli)).toBe(0);
  expect(
    await new UserService(ctx.database.db, ctx.clock).verifyCredentials('anna', 'Sole_2027'),
  ).toBeDefined();

  expect(await runCli(['user:delete', 'anna'], io([]).cli)).toBe(0);
  const missing = io([]);
  expect(await runCli(['user:delete', 'anna'], missing.cli)).toBe(1);
  expect(missing.err.join()).toContain('non trovato');
});

test('comandi sconosciuti o incompleti mostrano l’uso', async () => {
  const a = io([]);
  expect(await runCli(['boh'], a.cli)).toBe(1);
  expect(a.err.join()).toContain('Uso:');
  const b = io([]);
  expect(await runCli(['user:create'], b.cli)).toBe(1);
  expect(b.err.join()).toContain('Manca lo username');
});
