import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

export type PasswordRequirementId = 'length' | 'letter' | 'digit' | 'special';

export interface PasswordRequirement {
  id: PasswordRequirementId;
  label: string;
  /** Messaggio d'errore quando il requisito non è soddisfatto. */
  message: string;
  test(password: string): boolean;
}

export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    id: 'length',
    label: `Almeno ${PASSWORD_MIN_LENGTH} caratteri`,
    message: `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri`,
    test: (p) => [...p].length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'letter',
    label: 'Almeno una lettera',
    message: 'La password deve contenere almeno una lettera',
    test: (p) => /\p{L}/u.test(p),
  },
  {
    id: 'digit',
    label: 'Almeno una cifra',
    message: 'La password deve contenere almeno una cifra',
    test: (p) => /\p{N}/u.test(p),
  },
  {
    id: 'special',
    label: 'Almeno un carattere speciale',
    message: 'La password deve contenere almeno un carattere speciale',
    test: (p) => /[^\p{L}\p{N}]/u.test(p),
  },
];

export interface PasswordCheck {
  id: PasswordRequirementId;
  label: string;
  ok: boolean;
}

/** Stato di ogni requisito, per la checklist in tempo reale dell'app. */
export function checkPassword(password: string): PasswordCheck[] {
  return PASSWORD_REQUIREMENTS.map((r) => ({ id: r.id, label: r.label, ok: r.test(password) }));
}

export function unmetPasswordRequirements(password: string): PasswordRequirementId[] {
  return PASSWORD_REQUIREMENTS.filter((r) => !r.test(password)).map((r) => r.id);
}

export const passwordSchema = z
  .string({ required_error: 'La password è obbligatoria' })
  .superRefine((p, ctx) => {
    if ([...p].length > PASSWORD_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `La password può avere al massimo ${PASSWORD_MAX_LENGTH} caratteri`,
      });
      return;
    }
    for (const r of PASSWORD_REQUIREMENTS) {
      if (!r.test(p))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.message, params: { requirement: r.id } });
    }
  });

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export const usernameSchema = z
  .string({ required_error: 'Lo username è obbligatorio' })
  .min(USERNAME_MIN_LENGTH, `Lo username deve avere almeno ${USERNAME_MIN_LENGTH} caratteri`)
  .max(USERNAME_MAX_LENGTH, `Lo username può avere al massimo ${USERNAME_MAX_LENGTH} caratteri`)
  .regex(USERNAME_PATTERN, 'Lo username può contenere solo lettere, cifre, punto, trattino e underscore');

/** Forma usata per l'unicità: maiuscole e minuscole non contano. */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

// Username e token senza spazi ai bordi: le tastiere dei telefoni li aggiungono dopo un
// suggerimento o un incolla, e un token giusto con uno spazio in coda verrebbe rifiutato.
export const registerBodySchema = z.object({
  username: z.string({ required_error: 'Lo username è obbligatorio' }).trim().pipe(usernameSchema),
  password: passwordSchema,
  token: z
    .string({ required_error: 'Il token di invito è obbligatorio' })
    .trim()
    .max(256, 'Token troppo lungo'),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  username: z.string().trim().min(1, 'Inserisci lo username').max(64),
  password: z
    .string()
    .min(1, 'Inserisci la password')
    .max(PASSWORD_MAX_LENGTH * 4),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export interface MeDto {
  id: string;
  username: string;
  createdAt: number;
}
