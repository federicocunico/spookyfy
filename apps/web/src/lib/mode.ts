import { type BackendMode, HEALTH_PATH, type HealthDto } from '@spookyfy/shared';

export const MODE_STORAGE_KEY = 'spk-mode';

export interface DetectedMode {
  mode: BackendMode;
  /** null se il backend non era raggiungibile (avvio offline). */
  health: HealthDto | null;
}

/**
 * Modalità del backend dalla health check della propria origine; offline si usa
 * l'ultima modalità nota, così l'app in modalità client si avvia senza rete.
 */
export async function detectMode(
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  storage: Storage | undefined = globalThis.localStorage,
): Promise<DetectedMode> {
  try {
    const res = await fetchImpl(HEALTH_PATH, { cache: 'no-store' });
    if (res.ok) {
      const health = (await res.json()) as HealthDto;
      if (health.mode === 'client' || health.mode === 'onpremise') {
        try {
          storage?.setItem(MODE_STORAGE_KEY, health.mode);
        } catch {}
        return { mode: health.mode, health };
      }
    }
  } catch {}
  let saved: string | null = null;
  try {
    saved = storage?.getItem(MODE_STORAGE_KEY) ?? null;
  } catch {}
  return { mode: saved === 'client' ? 'client' : 'onpremise', health: null };
}
