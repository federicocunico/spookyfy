import { type ApiErrorBody, ErrorCode } from '@spookyfy/shared';
import type { ZodType, z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string[]>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(status: number, body: unknown, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: h });
}

export function errorResponse(err: HttpError): Response {
  const body: ApiErrorBody = {
    error: err.fields
      ? { code: err.code, message: err.message, fields: err.fields }
      : { code: err.code, message: err.message },
  };
  return json(err.status, body, err.headers);
}

/** Esegue l'handler traducendo le eccezioni in risposte JSON nel formato dell'API. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    console.error('[gateway] errore non gestito', err);
    return errorResponse(new HttpError(500, ErrorCode.Internal, 'Errore interno del gateway'));
  }
}

export function parseOrThrow<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string[]> = {};
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '_';
    fields[k] = [...(fields[k] ?? []), i.message];
  }
  throw new HttpError(
    400,
    ErrorCode.ValidationFailed,
    r.error.issues[0]?.message ?? 'Richiesta non valida',
    fields,
  );
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 64 * 1024)
    throw new HttpError(413, ErrorCode.ValidationFailed, 'Richiesta troppo grande');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, ErrorCode.ValidationFailed, 'JSON non valido');
  }
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  o: { maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`,
    ...(o.secure ? ['Secure'] : []),
  ].join('; ');
}

/** IP del client impostato dalla piattaforma (Vercel: primo valore di x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Protezione CSRF: le richieste che modificano dati devono venire dall'origine dell'app,
 * cioè quella pubblica configurata o quella da cui è servita la richiesta stessa (gli
 * altri domini dello stesso deploy Vercel, es. `<progetto>-<team>.vercel.app`). Un sito
 * terzo non può falsificare `Origin`, quindi resta escluso in entrambi i casi.
 */
export function assertOrigin(req: Request, publicOrigin: string): void {
  if (!UNSAFE.has(req.method)) return;
  const origin = req.headers.get('origin');
  if (origin !== publicOrigin && origin !== new URL(req.url).origin) {
    throw new HttpError(403, ErrorCode.ForbiddenOrigin, 'Origine della richiesta non consentita');
  }
}

/**
 * Parametro di una rotta dinamica (`[id]`, `[action]`): Vercel lo passa in query
 * (`?id=…`) quando riscrive verso il file; altrimenti è l'ultimo segmento del percorso.
 */
export function routeParam(req: Request, name: string): string {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get(name);
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts.at(-1) ?? '');
}

export function methodNotAllowed(): HttpError {
  return new HttpError(405, ErrorCode.ValidationFailed, 'Metodo non consentito');
}
