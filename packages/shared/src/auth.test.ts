import { describe, expect, test } from 'vitest';
import {
  checkPassword,
  normalizeUsername,
  passwordSchema,
  registerBodySchema,
  unmetPasswordRequirements,
  usernameSchema,
} from './auth.js';

describe('requisiti della password', () => {
  test('Notte#2026 è valida', () => {
    expect(passwordSchema.safeParse('Notte#2026').success).toBe(true);
    expect(unmetPasswordRequirements('Notte#2026')).toEqual([]);
  });

  test.each([
    ['ab#1', ['length'], 'almeno 8 caratteri'],
    ['notte2026', ['special'], 'carattere speciale'],
    ['notte#notte', ['digit'], 'cifra'],
    ['12345678#', ['letter'], 'lettera'],
  ])('%s non è valida', (pw, unmet, msg) => {
    expect(unmetPasswordRequirements(pw)).toEqual(unmet);
    const r = passwordSchema.safeParse(pw);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(' ')).toContain(msg);
  });

  test('lunghezza massima 128', () => {
    const long = `Aa1#${'x'.repeat(125)}`;
    expect(passwordSchema.safeParse(long).success).toBe(false);
    expect(passwordSchema.safeParse(long.slice(0, 128)).success).toBe(true);
  });

  test('lettere accentate e simboli unicode', () => {
    expect(passwordSchema.safeParse('Città_2026').success).toBe(true);
  });

  test('checklist per notte2026', () => {
    expect(checkPassword('notte2026').map((c) => [c.id, c.ok])).toEqual([
      ['length', true],
      ['letter', true],
      ['digit', true],
      ['special', false],
    ]);
  });
});

describe('username', () => {
  test.each(['fede', 'Fede.Cunico', 'a_b-c', 'x'.repeat(32)])('%s è valido', (u) => {
    expect(usernameSchema.safeParse(u).success).toBe(true);
  });

  test.each([
    ['fe', 'almeno 3'],
    ['fede!', 'solo lettere'],
    ['x'.repeat(33), 'al massimo 32'],
    ['fe de', 'solo lettere'],
  ])('%s non è valido', (u, msg) => {
    const r = usernameSchema.safeParse(u);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain(msg);
  });

  test('normalizzazione case-insensitive', () => {
    expect(normalizeUsername('Fede')).toBe(normalizeUsername('fede'));
  });
});

test('il corpo della registrazione richiede il token', () => {
  expect(registerBodySchema.safeParse({ username: 'fede', password: 'Notte#2026' }).success).toBe(false);
  expect(registerBodySchema.safeParse({ username: 'fede', password: 'Notte#2026', token: 'x' }).success).toBe(
    true,
  );
});

test('username e token senza spazi ai bordi (tastiere dei telefoni)', () => {
  const r = registerBodySchema.safeParse({ username: ' Fede ', password: 'Notte#2026', token: 'tok \n' });
  expect(r.success && r.data).toMatchObject({ username: 'Fede', token: 'tok' });
  // Gli spazi interni restano un errore.
  expect(
    registerBodySchema.safeParse({ username: 'fe de', password: 'Notte#2026', token: 'x' }).success,
  ).toBe(false);
  // La password resta com'è: gli spazi possono farne parte.
  const p = registerBodySchema.safeParse({ username: 'fede', password: ' Notte#2026 ', token: 'x' });
  expect(p.success && p.data.password).toBe(' Notte#2026 ');
});
