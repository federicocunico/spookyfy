import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const TOKEN = process.env.VERIFY_REGISTRATION_TOKEN ?? '';
const PASSWORD = `Verifica#${Math.random().toString(36).slice(2, 10)}1`;
const created: string[] = [];

test.skip(!TOKEN, 'Imposta VERIFY_REGISTRATION_TOKEN con il token di invito del deploy');

test.afterAll(() => {
  for (const u of created.splice(0)) {
    try {
      // La CLI del gateway legge REDIS_URL dall'ambiente o da apps/gateway/.env.
      execFileSync('pnpm', ['--filter', '@spookyfy/gateway', 'cli', 'user:delete', u], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
      console.log(`account di prova ${u} eliminato`);
    } catch (e) {
      console.warn(
        `account di prova ${u} NON eliminato (${(e as Error).message.split('\n')[0]}): ` +
          `pnpm --filter @spookyfy/gateway cli user:delete ${u}`,
      );
    }
  }
});

test('deploy pubblicato: registrazione, sessione, ricerca e nuovo accesso', async ({ page }, info) => {
  const user = `verify-ui-${info.project.name.replace('remote-', '')}-${Date.now().toString(36)}`;
  const errors: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Crea un account' }).click();
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Conferma password').fill(PASSWORD);
  // Come un incolla dal telefono: spazio in coda al token.
  await page.getByLabel('Token di invito').fill(`${TOKEN} `);
  const register = page.waitForResponse((r) => r.url().endsWith('/api/auth/register'));
  await page.getByRole('button', { name: 'Crea account' }).click();
  const res = await register;
  if (res.status() === 201) created.push(user);
  expect(res.status(), `registrazione: ${await res.text()}`).toBe(201);
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

  // Sessione persistente dopo il ricaricamento (cookie Secure/HttpOnly sul dominio pubblico).
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

  // Ricerca su YouTube dal gateway.
  await page.getByRole('link', { name: 'Cerca' }).click();
  const box = page.getByRole('searchbox');
  await box.fill('nirvana');
  await box.press('Enter');
  await expect(page.getByTestId('remote-result').first()).toBeVisible();

  // Uscita e nuovo accesso.
  await page.goto('/settings');
  await page.getByRole('button', { name: /Esci/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill(user.toUpperCase());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

  expect(errors, 'errori 5xx dalle API').toEqual([]);
});
