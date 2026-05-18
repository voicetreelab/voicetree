import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TerminalRelayClient, terminalRelayReconnectPolicy, type RelayConnectionStatus} from './terminalRelayClient';

type Listener = (event: { readonly data?: string }) => void;

class FakeWebSocket {
  static readonly OPEN: number = 1;

  readonly listeners: Map<string, Listener[]> = new Map();
  readonly sent: string[] = [];
  readyState: number = FakeWebSocket.OPEN;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    const listeners: Listener[] = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({data});
    }
  }
}

describe('TerminalRelayClient', () => {
  const originalWebSocket: typeof WebSocket | undefined = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'WebSocket', {
      value: FakeWebSocket,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'WebSocket', {
      value: originalWebSocket,
      configurable: true,
    });
  });

  it('maps relay data messages into terminal output and sends input/resize JSON', () => {
    const sockets: FakeWebSocket[] = [];
    const writes: string[] = [];
    const statuses: RelayConnectionStatus[] = [];
    const client = new TerminalRelayClient({
      url: 'ws://localhost:3002/terminals/Timi/attach',
      createWebSocket: (url: string): WebSocket => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onData: (data: string): void => { writes.push(data); },
      onStatus: (status: RelayConnectionStatus): void => { statuses.push(status); },
    });

    client.connect();
    sockets[0].emit('open');
    sockets[0].emit('message', JSON.stringify({type: 'data', payload: 'hello\r\n'}));

    expect(writes).toEqual(['hello\r\n']);
    expect(client.sendData('abc')).toBe(true);
    expect(client.sendResize(101, 33)).toBe(true);
    expect(sockets[0].sent).toEqual([
      JSON.stringify({type: 'data', payload: 'abc'}),
      JSON.stringify({type: 'resize', cols: 101, rows: 33}),
    ]);
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('reconnects on close with exponential backoff capped at 5 seconds', () => {
    const sockets: FakeWebSocket[] = [];
    const statuses: RelayConnectionStatus[] = [];
    const client = new TerminalRelayClient({
      url: 'ws://localhost:3002/terminals/Timi/attach',
      createWebSocket: (url: string): WebSocket => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onData: (): void => {},
      onStatus: (status: RelayConnectionStatus): void => { statuses.push(status); },
    });

    client.connect();
    sockets[0].emit('close');
    expect(statuses).toEqual(['connecting', 'reconnecting']);

    vi.advanceTimersByTime(terminalRelayReconnectPolicy.initialDelayMs - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1].emit('close');
    vi.advanceTimersByTime(399);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    sockets[2].emit('close');
    vi.advanceTimersByTime(800);
    sockets[3].emit('close');
    vi.advanceTimersByTime(1600);
    sockets[4].emit('close');
    vi.advanceTimersByTime(3200);
    sockets[5].emit('close');
    vi.advanceTimersByTime(terminalRelayReconnectPolicy.maxDelayMs - 1);
    expect(sockets).toHaveLength(6);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(7);

    client.dispose();
  });

  it('default setTimeoutFn fallback survives browser-style host-binding check on setTimeout', () => {
    // Browsers throw "Illegal invocation" when setTimeout is invoked with a `this`
    // other than `window`/`globalThis`. Node's setTimeout has no such check, so we
    // simulate it here to lock in the fix against regression.
    vi.useRealTimers();
    const realSetTimeout = globalThis.setTimeout;
    const strictSetTimeout = function (this: unknown, ...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return (realSetTimeout as (...a: Parameters<typeof setTimeout>) => ReturnType<typeof setTimeout>)(...args);
    } as unknown as typeof setTimeout;
    globalThis.setTimeout = strictSetTimeout;

    try {
      const sockets: FakeWebSocket[] = [];
      const client = new TerminalRelayClient({
        url: 'ws://localhost:3002/terminals/Timi/attach',
        createWebSocket: (url: string): WebSocket => {
          const socket = new FakeWebSocket(url);
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
        onData: (): void => {},
        onStatus: (): void => {},
      });

      client.connect();
      expect(() => sockets[0].emit('close')).not.toThrow();
      client.dispose();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
