import { expect, test } from '@playwright/test';
import { PASSWORD, TOKEN, uniqueUser } from './helpers';

/**
 * Registrazione e accesso dall'interfaccia, come su un telefono: eseguito in tutte e
 * due le modalità (on-premise e client/gateway) con Chromium e WebKit.
 */

test('registrazione: errori spiegati, token incollato con spazi, sessione e nuovo accesso', async ({
  page,
  browserName,
}) => {
  const user = uniqueUser('reg', browserName);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Crea un account' }).click();
  await expect(page).toHaveURL(/\/register$/);

  const submit = page.getByRole('button', { name: 'Crea account' });
  const username = page.getByLabel('Username');
  await expect(submit).toBeDisabled();

  // Username non valido: il motivo è scritto sotto il campo, il pulsante resta disabilitato.
  await username.fill('Mario Rossi');
  await expect(page.getByText('Lo username può contenere solo lettere')).toBeVisible();
  await username.fill('ab');
  await expect(page.getByText('almeno 3 caratteri')).toBeVisible();

  // Password debole e conferma diversa.
  await username.fill(user);
  await page.getByLabel('Password', { exact: true }).fill('password');
  await expect(page.getByRole('list', { name: 'Requisiti della password' })).toContainText('(mancante)');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Conferma password').fill(`${PASSWORD}x`);
  await expect(page.getByText('Le password non coincidono')).toBeVisible();
  await page.getByLabel('Conferma password').fill(PASSWORD);

  // Token sbagliato: errore del server sotto il campo del token.
  const token = page.getByLabel('Token di invito');
  await token.fill('token-sbagliato');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Token di invito non valido')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);

  // Token e username con spazi ai bordi (incolla o suggerimento della tastiera): accettati.
  await username.fill(`${user} `);
  await token.fill(` ${TOKEN} `);
  await submit.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();

  // La sessione sopravvive al ricaricamento.
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login$/);

  // Uscita, password sbagliata, poi accesso con lo username in maiuscolo.
  await page.goto('/settings');
  await page.getByRole('button', { name: /Esci/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill(user.toUpperCase());
  await page.getByLabel('Password').fill('Sbagliata#2026');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText('Username o password non validi')).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
});

test('registrazione: username già usato (maiuscole comprese) segnalato sul campo', async ({
  page,
  browser,
  browserName,
}) => {
  const user = uniqueUser('dup', browserName);
  const first = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const res = await first.request.post('/api/auth/register', {
    data: { username: user, password: PASSWORD, token: TOKEN },
    headers: { origin: new URL(test.info().project.use.baseURL!).origin },
  });
  expect(res.status()).toBe(201);
  await first.close();

  await page.goto('/register');
  await page.getByLabel('Username').fill(user.toUpperCase());
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Conferma password').fill(PASSWORD);
  await page.getByLabel('Token di invito').fill(TOKEN);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByText('Username non disponibile')).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

test('rotte: app, health e API di autenticazione rispondono come in produzione', async ({ request }) => {
  const base = test.info().project.use.baseURL!;
  const origin = new URL(base).origin;

  // L'app a pagina singola risponde anche sui percorsi profondi (apertura diretta da Home).
  for (const p of ['/', '/login', '/register', '/settings']) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(200);
    expect(r.headers()['content-type'], p).toContain('text/html');
  }
  expect((await request.get('/manifest.webmanifest')).status()).toBe(200);
  expect((await request.get('/sw.js')).status()).toBe(200);

  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok' });

  expect((await request.get('/api/auth/me')).status()).toBe(401);

  // Validazione: errori per campo in JSON.
  const invalid = await request.post('/api/auth/register', { data: {}, headers: { origin } });
  expect(invalid.status()).toBe(400);
  const body = await invalid.json();
  expect(body.error.code).toBe('VALIDATION_FAILED');
  expect(Object.keys(body.error.fields)).toEqual(expect.arrayContaining(['username', 'password', 'token']));

  // Protezione CSRF: un sito terzo non può registrare né accedere.
  for (const p of ['/api/auth/register', '/api/auth/login']) {
    const r = await request.post(p, { data: {}, headers: { origin: 'https://evil.example' } });
    expect(r.status(), p).toBe(403);
    expect((await r.json()).error.code, p).toBe('FORBIDDEN_ORIGIN');
  }
});
