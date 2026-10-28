import { EventEmitter } from 'node:events';
import type { WsServerEvent } from '@spookyfy/shared';

/** Bus degli eventi dei job, inoltrati ai client sul canale WebSocket. */
export class IngestEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: WsServerEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: WsServerEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
