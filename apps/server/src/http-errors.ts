import { type ApiErrorBody, ErrorCode } from '@spookyfy/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, type ZodType, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string[]>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message = 'Risorsa non trovata') => new HttpError(404, ErrorCode.NotFound, message);

/** Valida `data` con uno schema Zod e lancia un 400 con gli errori per campo. */
export function parseOrThrow<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function validationError(err: ZodError): HttpError {
  const fields: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] = [...(fields[key] ?? []), issue.message];
  }
  const first = err.issues[0]?.message ?? 'Richiesta non valida';
  return new HttpError(400, ErrorCode.ValidationFailed, first, fields);
}

export function errorBody(code: ErrorCode, message: string, fields?: Record<string, string[]>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError | ZodError, request, reply) => {
    if (error instanceof HttpError) {
      if (error.headers) reply.headers(error.headers);
      return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.fields));
    }
    if (error instanceof ZodError) {
      const e = validationError(error);
      return reply.status(400).send(errorBody(e.code, e.message, e.fields));
    }
    const status = (error as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      // Es. 416 da @fastify/send con `Content-Range: bytes */<dimensione>`.
      const headers = (error as { headers?: unknown }).headers;
      if (headers && typeof headers === 'object') reply.headers(headers as Record<string, string>);
      const code = status === 404 ? ErrorCode.NotFound : ErrorCode.ValidationFailed;
      return reply.status(status).send(errorBody(code, error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(errorBody(ErrorCode.Internal, 'Errore interno del server'));
  });
}
