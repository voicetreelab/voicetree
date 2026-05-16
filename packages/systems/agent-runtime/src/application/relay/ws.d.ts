declare module 'ws' {
    import type {IncomingMessage} from 'node:http'
    import type {Duplex} from 'node:stream'

    export class WebSocket {
        static readonly OPEN: number
        constructor(address: string)
        readonly readyState: number
        send(data: string): void
        close(): void
        on(event: 'open', listener: () => void): this
        on(event: 'message', listener: (raw: Buffer | ArrayBuffer | Buffer[]) => void): this
        on(event: 'close', listener: () => void): this
        on(event: 'error', listener: (error: Error) => void): this
        on(event: string, listener: (...args: unknown[]) => void): this
    }

    export class WebSocketServer {
        constructor(options: {readonly noServer: true})
        handleUpgrade(
            request: IncomingMessage,
            socket: Duplex,
            head: Buffer,
            callback: (ws: WebSocket) => void
        ): void
    }
}
