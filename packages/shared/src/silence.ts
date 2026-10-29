/**
 * Auto-trim: il silenzio all'inizio o alla fine di un brano più lungo di
 * SILENCE_MIN_MS viene saltato dal player. Il file audio resta intatto: si
 * salvano solo i punti in cui iniziare e finire la riproduzione.
 */
export const SILENCE_MIN_MS = 5000;
/** Sotto questo livello di picco (dBFS) il segnale è considerato silenzio. */
export const SILENCE_THRESHOLD_DB = -50;
/** Margine lasciato prima del primo suono e dopo l'ultimo, per non tagliare attacchi e code. */
export const SILENCE_MARGIN_MS = 250;

/** Silenzio misurato ai bordi di un brano. */
export interface EdgeSilence {
  leadingMs: number;
  trailingMs: number;
  durationMs: number;
}

/** Dove iniziare e finire la riproduzione; assente = dall'inizio / fino alla fine. */
export interface TrimPoints {
  trimStartMs?: number;
  trimEndMs?: number;
}

export function trimPoints(s: EdgeSilence): TrimPoints {
  const out: TrimPoints = {};
  // Brano senza alcun suono: meglio non toccarlo che saltarlo per intero.
  if (s.leadingMs >= s.durationMs) return out;
  if (s.leadingMs > SILENCE_MIN_MS) out.trimStartMs = Math.round(s.leadingMs - SILENCE_MARGIN_MS);
  if (s.trailingMs > SILENCE_MIN_MS)
    out.trimEndMs = Math.round(s.durationMs - s.trailingMs + SILENCE_MARGIN_MS);
  return out;
}

/** Silenzio ai bordi a partire dai campioni PCM (−1…1) di uno o più canali. */
export function edgeSilenceFromPcm(channels: ArrayLike<number>[], sampleRate: number): EdgeSilence {
  const threshold = 10 ** (SILENCE_THRESHOLD_DB / 20);
  const length = channels[0]?.length ?? 0;
  const loud = (i: number) => channels.some((c) => Math.abs(c[i] ?? 0) > threshold);
  let first = 0;
  while (first < length && !loud(first)) first++;
  let last = length - 1;
  while (last >= first && !loud(last)) last--;
  const ms = (samples: number) => (samples / sampleRate) * 1000;
  return {
    leadingMs: ms(first),
    trailingMs: first >= length ? 0 : ms(length - 1 - last),
    durationMs: ms(length),
  };
}
