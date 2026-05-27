export type RelayConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface TerminalRelayClientConfig {
  readonly url: string;
  readonly createWebSocket?: (url: string) => WebSocket;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  readonly onData: (data: string) => void;
  readonly onStatus: (status: RelayConnectionStatus) => void;
}

const INITIAL_RECONNECT_DELAY_MS: number = 200;
const MAX_RECONNECT_DELAY_MS: number = 5000;

function parseRelayMessage(rawData: unknown): { readonly type: string; readonly payload?: string; readonly code?: number } | null {
  if (typeof rawData !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!parsed || typeof parsed !== 'object') return null;
    const msg = parsed as { readonly type?: unknown; readonly payload?: unknown; readonly code?: unknown };
    if (typeof msg.type !== 'string') return null;
    return {
      type: msg.type,
      payload: typeof msg.payload === 'string' ? msg.payload : undefined,
      code: typeof msg.code === 'number' ? msg.code : undefined,
    };
  } catch {
    return null;
  }
}

export class TerminalRelayClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number = INITIAL_RECONNECT_DELAY_MS;
  private disposed: boolean = false;

  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(private readonly config: TerminalRelayClientConfig) {
    this.createWebSocket = config.createWebSocket ?? ((url: string): WebSocket => new WebSocket(url));
    this.setTimeoutFn = config.setTimeoutFn ?? (setTimeout.bind(globalThis) as typeof setTimeout);
    this.clearTimeoutFn = config.clearTimeoutFn ?? (clearTimeout.bind(globalThis) as typeof clearTimeout);
  }

  connect(): void {
    if (this.disposed) return;
    this.clearReconnectTimer();
    this.config.onStatus(this.socket ? 'reconnecting' : 'connecting');

    const socket: WebSocket = this.createWebSocket(this.config.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.disposed) return;
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      this.config.onStatus('connected');
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== socket || this.disposed) return;
      const msg = parseRelayMessage(event.data);
      if (!msg) return;
      if (msg.type === 'data' && msg.payload !== undefined) {
        this.config.onData(msg.payload);
      } else if (msg.type === 'exit') {
        this.config.onStatus('closed');
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket || this.disposed) return;
      this.config.onStatus('error');
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket || this.disposed) return;
      this.scheduleReconnect();
    });
  }

  sendData(payload: string): boolean {
    return this.send({ type: 'data', payload });
  }

  sendResize(cols: number, rows: number): boolean {
    return this.send({ type: 'resize', cols, rows });
  }

  sendScroll(direction: 'up' | 'down', lines: number): boolean {
    return this.send({ type: 'scroll', direction, lines });
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    const socket: WebSocket | null = this.socket;
    this.socket = null;
    socket?.close();
  }

  private send(message: object): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private scheduleReconnect(): void {
    this.config.onStatus('reconnecting');
    const delayMs: number = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export const terminalRelayReconnectPolicy = {
  initialDelayMs: INITIAL_RECONNECT_DELAY_MS,
  maxDelayMs: MAX_RECONNECT_DELAY_MS,
} as const;
