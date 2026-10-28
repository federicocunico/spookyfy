import path from 'node:path';
import { z } from 'zod';

export const DEFAULT_REGISTRATION_TOKEN = 'spotifymerdacostosa2026';

const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().min(1).default('127.0.0.1'),
    DATA_DIR: z.string().min(1).default('./data'),
    MEDIA_DIR: z.string().min(1).default('./media'),
    WEB_DIST_DIR: z.string().min(1).optional(),
    PUBLIC_ORIGIN: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash;
      }, "deve essere solo un'origine, ad esempio https://spookyfy.example.com")
      .transform((v) => new URL(v).origin)
      .optional(),
    YTDLP_PATH: z.string().min(1).default('yt-dlp'),
    /** Solo per test end-to-end: script Node che simula yt-dlp (eseguito con lo stesso Node). */
    YTDLP_NODE_SCRIPT: z.string().min(1).optional(),
    FFMPEG_PATH: z.string().min(1).optional(),
    INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(32).optional(),
    INGEST_NICE: z.coerce.number().int().min(-20).max(19).default(10),
    TRUST_CF_HEADERS: booleanString.default('true'),
    COOKIE_SECURE: booleanString.default('true'),
    REGISTRATION_TOKEN: z.string().max(256).default(DEFAULT_REGISTRATION_TOKEN),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.PUBLIC_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_ORIGIN'],
        message: 'obbligatoria in produzione (es. https://spookyfy.example.com)',
      });
    }
  });

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  port: number;
  host: string;
  dataDir: string;
  mediaDir: string;
  webDistDir: string;
  publicOrigin: string;
  ytdlpPath: string;
  ytdlpNodeScript: string | undefined;
  ffmpegPath: string | undefined;
  /** Valore esplicito; se assente si usa il default calcolato dall'hardware. */
  ingestConcurrency: number | undefined;
  ingestNice: number;
  trustCfHeaders: boolean;
  cookieSecure: boolean;
  /** Stringa vuota = registrazione disabilitata. */
  registrationToken: string;
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configurazione non valida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const packageRoot = path.resolve(import.meta.dirname, '..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  // Le variabili vuote nel file .env valgono come "non impostate", tranne il token
  // di registrazione, dove la stringa vuota ha il significato esplicito "disabilitata".
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([k, v]) => v !== '' || k === 'REGISTRATION_TOKEN'),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.PORT,
    host: e.HOST,
    dataDir: path.resolve(cwd, e.DATA_DIR),
    mediaDir: path.resolve(cwd, e.MEDIA_DIR),
    webDistDir: e.WEB_DIST_DIR ? path.resolve(cwd, e.WEB_DIST_DIR) : path.resolve(packageRoot, '../web/dist'),
    publicOrigin: e.PUBLIC_ORIGIN ?? 'http://localhost:5173',
    ytdlpPath: e.YTDLP_PATH,
    ytdlpNodeScript: e.YTDLP_NODE_SCRIPT ? path.resolve(cwd, e.YTDLP_NODE_SCRIPT) : undefined,
    ffmpegPath: e.FFMPEG_PATH,
    ingestConcurrency: e.INGEST_CONCURRENCY,
    ingestNice: e.INGEST_NICE,
    trustCfHeaders: e.TRUST_CF_HEADERS,
    cookieSecure: e.COOKIE_SECURE,
    registrationToken: e.REGISTRATION_TOKEN,
  };
}
