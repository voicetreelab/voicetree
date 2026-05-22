/**
 * Local ambient shim for `ws` used only by the eventSubscription test fixture.
 * Webapp has no @types/ws; this exposes the surface we touch.
 */
declare module 'ws' {
    import type { IncomingMessage, Server as HttpServer } from 'node:http'
    import type { Duplex } from 'node:stream'

    export interface ClientOptions {
        readonly headers?: Record<string, string>
    }

    export class WebSocket {
        static readonly CONNECTING: 0
        static readonly OPEN: 1
        static readonly CLOSING: 2
        static readonly CLOSED: 3
        readonly readyState: number
        constructor(address: string, options?: ClientOptions)
        constructor(address: string, protocols?: string | readonly string[], options?: ClientOptions)
        send(data: string): void
        close(code?: number, reason?: string): void
        on(event: 'open', listener: () => void): this
        on(event: 'message', listener: (raw: Buffer | ArrayBuffer | Buffer[]) => void): this
        on(event: 'close', listener: (code: number, reason: Buffer) => void): this
        on(event: 'error', listener: (error: Error) => void): this
        on(event: string, listener: (...args: unknown[]) => void): this
        off(event: string, listener: (...args: unknown[]) => void): this
    }

    export class WebSocketServer {
        constructor(options: { readonly noServer: true } | { readonly server: HttpServer } | { readonly port: number })
        handleUpgrade(
            request: IncomingMessage,
            socket: Duplex,
            head: Buffer,
            callback: (ws: WebSocket) => void
        ): void
        on(event: 'connection', listener: (ws: WebSocket, request: IncomingMessage) => void): this
        close(callback?: (err?: Error) => void): void
    }
}
