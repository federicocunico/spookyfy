import type { WsServerEvent } from '@spookyfy/shared';
import { RealtimeClient } from './ws';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.onopen?.();
  }
  drop() {
    this.onclose?.();
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  send() {}
}

function setup() {
  FakeSocket.instances = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const events: WsServerEvent[] = [];
  const onReconnect = vi.fn();
  const client = new RealtimeClient({
    url: 'wss://spk.test/api/ws',
    onEvent: (e) => events.push(e),
    onReconnect,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
  });
  const fire = () => timers.shift()!.fn();
  return { client, timers, events, onReconnect, fire, last: () => FakeSocket.instances.at(-1)! };
}

test('ritardi di backoff: 1, 2, 4, 8, 16, 30, 30 secondi', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(RealtimeClient.delay)).toEqual([
    1000, 2000, 4000, 8000, 16000, 30000, 30000,
  ]);
});

test('riconnessione con backoff crescente e reset dopo una connessione riuscita', () => {
  const { client, timers, fire, last, onReconnect } = setup();
  client.start();
  last().open();
  expect(onReconnect).not.toHaveBeenCalled(); // prima apertura

  last().drop();
  expect(timers.map((t) => t.ms)).toEqual([1000]);
  fire();
  last().drop();
  expect(timers.map((t) => t.ms)).toEqual([2000]);
  fire();
  last().drop();
  expect(timers.map((t) => t.ms)).toEqual([4000]);
  fire();

  // Connessione riuscita: si ricarica lo stato perso e il backoff riparte da 1 s.
  last().open();
  expect(onReconnect).toHaveBeenCalledTimes(1);
  last().drop();
  expect(timers.map((t) => t.ms)).toEqual([1000]);
  client.stop();
});

test('eventi del server inoltrati', () => {
  const { client, last, events } = setup();
  client.start();
  last().open();
  const job = {
    id: 'j',
    sourceId: 'abcdefghijk',
    status: 'queued',
    progress: 0,
    error: null,
    trackId: null,
    requestedBy: 'u',
    createdAt: 1,
    updatedAt: 1,
  } as const;
  last().onmessage?.({ data: JSON.stringify({ type: 'job.queued', job }) });
  last().onmessage?.({ data: 'non json' });
  expect(events).toEqual([{ type: 'job.queued', job }]);
  client.stop();
});

test('stop: nessuna riconnessione; nudge riconnette subito', () => {
  const { client, timers, last } = setup();
  client.start();
  last().open();
  client.stop();
  expect(last().closed).toBe(true);
  expect(timers).toEqual([]);

  client.start();
  last().drop();
  expect(timers).toHaveLength(1);
  const before = FakeSocket.instances.length;
  client.nudge();
  expect(FakeSocket.instances.length).toBe(before + 1);
  client.stop();
});
