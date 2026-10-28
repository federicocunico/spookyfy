import { loadGatewayConfig } from './config.js';
import type { GatewayDeps } from './handlers.js';
import { type Kv, MemoryKv, UpstashKv, systemClock } from './kv.js';
import { InnertubeYoutube } from './youtube-innertube.js';

let current: GatewayDeps | null = null;

/**
 * Dipendenze per istanza della funzione (create alla prima richiesta). Nessuno
 * stato persistente: solo client e configurazione.
 */
export function deps(): GatewayDeps {
  if (current) return current;
  const config = loadGatewayConfig();
  let kv: Kv;
  if (config.kv) kv = new UpstashKv(config.kv.url, config.kv.token);
  else if (config.nodeEnv !== 'production') kv = new MemoryKv();
  else throw new Error('Credenziali del KV mancanti (integrazione Upstash Redis su Vercel)');
  current = {
    config,
    kv,
    clock: systemClock,
    youtube: new InnertubeYoutube(),
    fetch: globalThis.fetch.bind(globalThis),
  };
  return current;
}

/** Per test e dev server. */
export function setDeps(d: GatewayDeps | null): void {
  current = d;
}
