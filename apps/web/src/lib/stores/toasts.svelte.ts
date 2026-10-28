export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

let nextId = 1;

export class Toasts {
  items = $state<Toast[]>([]);

  show(
    message: string,
    opts: { kind?: Toast['kind']; action?: Toast['action']; durationMs?: number } = {},
  ): number {
    const id = nextId++;
    this.items = [...this.items.slice(-2), { id, message, kind: opts.kind ?? 'info', action: opts.action }];
    setTimeout(() => this.dismiss(id), opts.durationMs ?? 4000);
    return id;
  }

  error(message: string): number {
    return this.show(message, { kind: 'error', durationMs: 6000 });
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}
