import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../lib/api';
import { ME, type TestServices, setupServices } from '../test/fixtures';
import LoginView from './LoginView.svelte';
import RegisterView from './RegisterView.svelte';

let s: TestServices;
beforeEach(async () => {
  s = await setupServices();
  s.session.user = null;
  s.session.status = 'anonymous';
});

describe('login', () => {
  test('login riuscito e redirect alla destinazione iniziale', async () => {
    s.router.navigate('/login?next=%2Fplaylist%2Fp1', { replace: true });
    render(LoginView);
    await userEvent.type(screen.getByLabelText('Username'), 'fede');
    await userEvent.type(screen.getByLabelText('Password'), 'Notte#2026');
    await userEvent.click(screen.getByRole('button', { name: 'Accedi' }));
    expect(s.fake.auth.login).toHaveBeenCalledWith('fede', 'Notte#2026');
    await vi.waitFor(() => expect(s.router.route).toMatchObject({ name: 'playlist', params: { id: 'p1' } }));
    expect(s.session.status).toBe('authenticated');
  });

  test('credenziali errate: messaggio d’errore', async () => {
    s.fake.auth.login.mockRejectedValue(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Username o password non validi'),
    );
    render(LoginView);
    await userEvent.type(screen.getByLabelText('Username'), 'fede');
    await userEvent.type(screen.getByLabelText('Password'), 'sbagliata');
    await userEvent.click(screen.getByRole('button', { name: 'Accedi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Username o password non validi');
    expect(s.session.status).toBe('anonymous');
  });

  test('il link porta alla registrazione', async () => {
    render(LoginView);
    await userEvent.click(screen.getByRole('link', { name: 'Crea un account' }));
    expect(s.router.route.name).toBe('register');
  });
});

describe('registrazione', () => {
  async function fill(o: { username?: string; password?: string; confirm?: string; token?: string }) {
    if (o.username !== undefined) await userEvent.type(screen.getByLabelText('Username'), o.username);
    if (o.password !== undefined) await userEvent.type(screen.getByLabelText('Password'), o.password);
    if (o.confirm !== undefined) await userEvent.type(screen.getByLabelText('Conferma password'), o.confirm);
    if (o.token !== undefined) await userEvent.type(screen.getByLabelText('Token di invito'), o.token);
  }
  const submit = () => screen.getByRole('button', { name: 'Crea account' });

  test('conferma diversa: pulsante disabilitato e avviso', async () => {
    render(RegisterView);
    await fill({ username: 'fede', password: 'Notte#2026', confirm: 'Notte#2027', token: 'x' });
    expect(submit()).toBeDisabled();
    expect(screen.getByText('Le password non coincidono')).toBeInTheDocument();
  });

  test('checklist in tempo reale per notte2026', async () => {
    render(RegisterView);
    await fill({ password: 'notte2026' });
    const items = screen.getByRole('list', { name: 'Requisiti della password' }).querySelectorAll('li');
    expect([...items].map((li) => [li.dataset.requirement, li.dataset.ok])).toEqual([
      ['length', 'true'],
      ['letter', 'true'],
      ['digit', 'true'],
      ['special', 'false'],
    ]);
  });

  test('registrazione riuscita', async () => {
    render(RegisterView);
    await fill({
      username: 'fede',
      password: 'Notte#2026',
      confirm: 'Notte#2026',
      token: 'spotifymerdacostosa2026',
    });
    expect(submit()).toBeEnabled();
    await fireEvent.submit(submit().closest('form')!);
    await vi.waitFor(() => expect(s.session.status).toBe('authenticated'));
    expect(s.fake.auth.register).toHaveBeenCalledWith({
      username: 'fede',
      password: 'Notte#2026',
      token: 'spotifymerdacostosa2026',
    });
    expect(s.session.user).toEqual(ME);
    expect(s.router.route.name).toBe('home');
  });

  test('username non disponibile: errore sotto il campo e valori mantenuti', async () => {
    s.fake.auth.register.mockRejectedValue(
      new ApiError(409, 'USERNAME_TAKEN', 'Username non disponibile', {
        username: ['Username non disponibile'],
      }),
    );
    render(RegisterView);
    await fill({ username: 'fede', password: 'Notte#2026', confirm: 'Notte#2026', token: 'tok' });
    await userEvent.click(submit());
    const alert = await screen.findByText('Username non disponibile');
    expect(alert).toHaveAttribute('id', 'reg-username-help');
    expect(screen.getByLabelText('Username')).toHaveValue('fede');
    expect(screen.getByLabelText('Password')).toHaveValue('Notte#2026');
    expect(screen.getByLabelText('Token di invito')).toHaveValue('tok');
  });

  test('token errato: errore sul campo token', async () => {
    s.fake.auth.register.mockRejectedValue(
      new ApiError(403, 'INVALID_REGISTRATION_TOKEN', 'Token di invito non valido', {
        token: ['Token di invito non valido'],
      }),
    );
    render(RegisterView);
    await fill({ username: 'fede', password: 'Notte#2026', confirm: 'Notte#2026', token: 'abc' });
    await userEvent.click(submit());
    expect(await screen.findByText('Token di invito non valido')).toBeInTheDocument();
    expect(screen.getByLabelText('Token di invito')).toHaveAttribute('aria-invalid', 'true');
  });
});
