export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Coda di riproduzione immutabile. `items` è l'ordine originale del contesto
 * (playlist, preferiti…), `order` l'ordine di riproduzione (indici in `items`),
 * `position` l'indice corrente in `order`.
 */
export interface QueueState {
  items: string[];
  order: number[];
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Da dove è partita la riproduzione (es. `playlist:<id>`). */
  context: string | null;
}

export type Rng = () => number;

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

function shuffled<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function createQueue(
  items: string[],
  startIndex = 0,
  opts: { shuffle?: boolean; repeat?: RepeatMode; context?: string | null; rng?: Rng } = {},
): QueueState {
  const start = Math.max(0, Math.min(startIndex, items.length - 1));
  let q: QueueState = {
    items: [...items],
    order: identity(items.length),
    position: start,
    shuffle: false,
    repeat: opts.repeat ?? 'off',
    context: opts.context ?? null,
  };
  if (opts.shuffle) q = setShuffle(q, true, opts.rng);
  return q;
}

export function currentId(q: QueueState): string | undefined {
  const idx = q.order[q.position];
  return idx === undefined ? undefined : q.items[idx];
}

/** Brani che verranno riprodotti dopo quello corrente. */
export function upcoming(q: QueueState): string[] {
  return q.order.slice(q.position + 1).map((i) => q.items[i]!);
}

export interface Step {
  queue: QueueState;
  /** false se la coda è finita e la riproduzione deve fermarsi. */
  play: boolean;
}

/** `auto`: fine naturale del brano (rispetta "ripeti brano"). */
export function next(q: QueueState, { auto = false } = {}): Step {
  if (q.order.length === 0) return { queue: q, play: false };
  if (auto && q.repeat === 'one') return { queue: q, play: true };
  if (q.position + 1 < q.order.length) return { queue: { ...q, position: q.position + 1 }, play: true };
  if (q.repeat === 'all') return { queue: { ...q, position: 0 }, play: true };
  // Fine coda: si resta sull'ultimo brano.
  return { queue: q, play: false };
}

export const RESTART_THRESHOLD_SEC = 3;

/** "Precedente": oltre 3 secondi riparte il brano, altrimenti si torna al precedente. */
export function previous(q: QueueState, currentTimeSec: number): Step & { restart: boolean } {
  if (currentTimeSec > RESTART_THRESHOLD_SEC || q.order.length === 0) {
    return { queue: q, play: true, restart: true };
  }
  if (q.position > 0) return { queue: { ...q, position: q.position - 1 }, play: true, restart: false };
  if (q.repeat === 'all')
    return { queue: { ...q, position: q.order.length - 1 }, play: true, restart: false };
  return { queue: q, play: true, restart: true };
}

/** Salta direttamente a una voce della coda (per posizione nell'ordine di riproduzione). */
export function jumpTo(q: QueueState, position: number): QueueState {
  return { ...q, position: Math.max(0, Math.min(position, q.order.length - 1)) };
}

/** "Riproduci dopo": il brano viene riprodotto subito dopo quello corrente. */
export function playNext(q: QueueState, id: string): QueueState {
  const curIdx = q.order[q.position] ?? -1;
  // Inserito nell'ordine originale subito dopo il brano corrente.
  const insertAt = curIdx + 1;
  const items = [...q.items.slice(0, insertAt), id, ...q.items.slice(insertAt)];
  const shiftedOrder = q.order.map((i) => (i >= insertAt ? i + 1 : i));
  const order = [...shiftedOrder.slice(0, q.position + 1), insertAt, ...shiftedOrder.slice(q.position + 1)];
  return { ...q, items, order };
}

/** Shuffle della parte restante (il brano corrente resta); disattivato ripristina l'ordine originale. */
export function setShuffle(q: QueueState, on: boolean, rng: Rng = Math.random): QueueState {
  const cur = q.order[q.position];
  if (on) {
    const played = q.order.slice(0, q.position + 1);
    const rest = shuffled(q.order.slice(q.position + 1), rng);
    return { ...q, order: [...played, ...rest], shuffle: true };
  }
  const order = identity(q.items.length);
  return { ...q, order, position: cur ?? 0, shuffle: false };
}

export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

/** Rimuove tutte le occorrenze di un brano (es. eliminato dalla libreria). */
export function removeTrack(q: QueueState, id: string): QueueState {
  const removed = new Set(q.items.flatMap((t, i) => (t === id ? [i] : [])));
  if (removed.size === 0) return q;
  const remap = new Map<number, number>();
  let n = 0;
  q.items.forEach((_, i) => {
    if (!removed.has(i)) remap.set(i, n++);
  });
  const curIdx = q.order[q.position];
  const before = q.order.slice(0, q.position).filter((i) => !removed.has(i)).length;
  const order = q.order.filter((i) => !removed.has(i)).map((i) => remap.get(i)!);
  const position = curIdx !== undefined && !removed.has(curIdx) ? before : Math.min(before, order.length - 1);
  return { ...q, items: q.items.filter((_, i) => !removed.has(i)), order, position: Math.max(0, position) };
}
