/**
 * Test stub for the daemon /events WebSocket server (Step 9 §4.3).
 *
 * Implements the §4.3 wire byte-for-byte:
 *  - Validates `Authorization: Bearer <token>` on the upgrade (401 if bad).
 *  - Accepts `{ op: 'subscribe', topics: [{ topic, resumeSeq }] }` frames.
 *  - Pushes `{ type: 'event', topic, seq, event, data }` and `{ type: 'gap', ... }` frames.
 *  - Supports closing with codes 1000, 1008, 1009, 1011.
 *
 * Test-only — lives under `src/shell/edge/renderer/live/` so the test file
 * can import it directly. Not for production use.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import type { EventFrame, GapFrame, Topic } from './eventSubscription'

export interface StubServerHandle {
    readonly url: string
    readonly close: () => Promise<void>
    /** Connected clients in connection order. */
    readonly clients: readonly StubClient[]
    /** Promise that resolves when the next client connects. */
    readonly nextClient: () => Promise<StubClient>
    /** Hot-rotate the accepted bearer token (simulates daemon restart). */
    readonly rotateToken: (next: string) => void
}

export interface StubSubscribeFrame {
    readonly topics: readonly { readonly topic: Topic; readonly resumeSeq: number }[]
}

export interface StubClient {
    /** Promise that resolves when the client sends its next subscribe frame. */
    readonly nextSubscribe: () => Promise<StubSubscribeFrame>
    /** Push an event frame to the client. */
    readonly sendEvent: (frame: EventFrame) => void
    /** Push a gap frame to the client. */
    readonly sendGap: (frame: GapFrame) => void
    /** Close the client connection with a code. */
    readonly closeWith: (code: number, reason?: string) => void
}

interface InternalClient extends StubClient {
    readonly ws: WebSocket
}

export interface StubServerOptions {
    readonly initialToken: string
}

export async function startStubEventsServer(options: StubServerOptions): Promise<StubServerHandle> {
    let acceptedToken: string = options.initialToken

    const httpServer: Server = createServer((_req, res) => {
        res.writeHead(404)
        res.end()
    })

    const wss: WebSocketServer = new WebSocketServer({ noServer: true })
    const clients: InternalClient[] = []
    const clientResolvers: ((client: StubClient) => void)[] = []

    function extractBearer(req: IncomingMessage): string | null {
        const raw: string | string[] | undefined = req.headers.authorization
        const header: string | undefined = Array.isArray(raw) ? raw[0] : raw
        if (!header) return null
        const match: RegExpMatchArray | null = header.match(/^Bearer\s+(.+)$/)
        return match?.[1] ?? null
    }

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        if (req.url !== '/events' && !req.url?.startsWith('/events?')) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
            socket.destroy()
            return
        }
        const token: string | null = extractBearer(req)
        if (token !== acceptedToken) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
        }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
            const client: InternalClient = makeClient(ws)
            clients.push(client)
            const resolver: ((client: StubClient) => void) | undefined = clientResolvers.shift()
            resolver?.(client)
        })
    })

    function makeClient(ws: WebSocket): InternalClient {
        const subscribeResolvers: ((value: StubSubscribeFrame) => void)[] = []
        const subscribeBuffer: StubSubscribeFrame[] = []

        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
            const text: string = Buffer.isBuffer(raw)
                ? raw.toString('utf-8')
                : Array.isArray(raw)
                    ? Buffer.concat(raw).toString('utf-8')
                    : Buffer.from(raw as ArrayBuffer).toString('utf-8')
            let parsed: unknown
            try { parsed = JSON.parse(text) } catch { return }
            if (typeof parsed !== 'object' || parsed === null) return
            const p: { readonly op?: unknown; readonly topics?: unknown } = parsed as Record<string, unknown>
            if (p.op === 'subscribe' && Array.isArray(p.topics)) {
                const frame: StubSubscribeFrame = {
                    topics: (p.topics as Array<{ readonly topic: Topic; readonly resumeSeq?: number }>).map(t => ({
                        topic: t.topic,
                        resumeSeq: typeof t.resumeSeq === 'number' ? t.resumeSeq : 0,
                    })),
                }
                const resolver: ((v: StubSubscribeFrame) => void) | undefined = subscribeResolvers.shift()
                if (resolver) {
                    resolver(frame)
                } else {
                    subscribeBuffer.push(frame)
                }
            }
        })

        return {
            ws,
            nextSubscribe: (): Promise<StubSubscribeFrame> => {
                const buffered: StubSubscribeFrame | undefined = subscribeBuffer.shift()
                if (buffered) return Promise.resolve(buffered)
                return new Promise<StubSubscribeFrame>(resolve => subscribeResolvers.push(resolve))
            },
            sendEvent: (frame: EventFrame): void => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
            },
            sendGap: (frame: GapFrame): void => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
            },
            closeWith: (code: number, reason?: string): void => {
                ws.close(code, reason ?? '')
            },
        }
    }

    await new Promise<void>((resolve) => {
        httpServer.listen(0, '127.0.0.1', resolve)
    })
    const address: AddressInfo = httpServer.address() as AddressInfo
    const url: string = `http://127.0.0.1:${address.port}`

    return {
        url,
        clients,
        nextClient: (): Promise<StubClient> => {
            // Skip already-connected clients; return the next-to-arrive.
            return new Promise(resolve => clientResolvers.push(resolve))
        },
        rotateToken: (next: string): void => { acceptedToken = next },
        close: (): Promise<void> => {
            for (const client of clients) {
                try { client.ws.close() } catch { /* ignore */ }
            }
            return new Promise<void>((resolve, reject) => {
                wss.close(() => {
                    httpServer.close((err) => {
                        if (err) { reject(err) } else { resolve() }
                    })
                })
            })
        },
    }
}
