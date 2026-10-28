import { z } from 'zod';

export const DEFAULT_REGISTRATION_TOKEN = 'spotifymerdacostosa2026';

const booleanString = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    /** Segreto per firmare le sessioni: almeno 32 caratteri casuali. */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET deve avere almeno 32 caratteri'),
    REGISTRATION_TOKEN: z.string().max(256).default(DEFAULT_REGISTRATION_TOKEN),
    PUBLIC_ORIGIN: z
      .string()
      .url()
      .transform((v) => new URL(v).origin)
      .optional(),
    /** Impostata da Vercel: dominio di produzione del progetto. */
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    // Credenziali dell'integrazione Upstash Redis (nomi usati da Vercel o da Upstash).
    KV_REST_API_URL: z.string().url().optional(),
    KV_REST_API_TOKEN: z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    COOKIE_SECURE: booleanString.default('true'),
  })
  .superRefine((e, ctx) => {
    if (!e.PUBLIC_ORIGIN && !e.VERCEL_PROJECT_PRODUCTION_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_ORIGIN'],
        message: 'obbligatoria (su Vercel il default è il dominio di produzione del progetto)',
      });
    }
  });

export interface GatewayConfig {
  nodeEnv: 'development' | 'production' | 'test';
  sessionSecret: string;
  registrationToken: string;
  publicOrigin: string;
  kv: { url: string; token: string } | null;
  cookieSecure: boolean;
  version: string;
}

export class GatewayConfigError extends Error {
  constructor(issues: string[]) {
    super(`Configurazione del gateway non valida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'GatewayConfigError';
  }
}

export const GATEWAY_VERSION = '0.2.0';

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([k, v]) => v !== '' || k === 'REGISTRATION_TOKEN'),
  );
  const r = envSchema.safeParse(cleaned);
  if (!r.success)
    throw new GatewayConfigError(r.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  const e = r.data;
  const url = e.KV_REST_API_URL ?? e.UPSTASH_REDIS_REST_URL;
  const token = e.KV_REST_API_TOKEN ?? e.UPSTASH_REDIS_REST_TOKEN;
  return {
    nodeEnv: e.NODE_ENV,
    sessionSecret: e.SESSION_SECRET,
    registrationToken: e.REGISTRATION_TOKEN,
    publicOrigin: e.PUBLIC_ORIGIN ?? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`,
    kv: url && token ? { url, token } : null,
    cookieSecure: e.COOKIE_SECURE,
    version: GATEWAY_VERSION,
  };
}
