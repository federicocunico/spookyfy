/** Codici d'errore restituiti dall'API nel formato `{ error: { code, message } }`. */
export const ErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  Unauthenticated: 'UNAUTHENTICATED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  InvalidRegistrationToken: 'INVALID_REGISTRATION_TOKEN',
  RegistrationDisabled: 'REGISTRATION_DISABLED',
  UsernameTaken: 'USERNAME_TAKEN',
  TooManyRequests: 'TOO_MANY_REQUESTS',
  ForbiddenOrigin: 'FORBIDDEN_ORIGIN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  RemoteSearchUnavailable: 'REMOTE_SEARCH_UNAVAILABLE',
  Internal: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Errori per campo, quando la validazione fallisce. */
    fields?: Record<string, string[]>;
  };
}
