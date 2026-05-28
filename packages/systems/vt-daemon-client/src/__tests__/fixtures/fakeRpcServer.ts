/**
 * Tiny per-test loopback HTTP server that speaks JSON-RPC 2.0 on `/rpc`.
 *
 * Real HTTP, real fetch, real wire — no internal client mocks. The
 * fixture exists so wrapper tests can assert two black-box invariants
 * at once:
 *
 *   1. The wire envelope the wrapper produced — `method` name + `params`
 *      payload — matches the protocol contract.
 *   2. The wrapper correctly threads the daemon's typed response back to
 *      its caller.
 *
 * The fixture exposes a `RouteResponder` table keyed by `method` name;
 * each entry returns the JSON-RPC `result` for one call. The server
 * also records every received request envelope in a `received` array
 * the test reads to assert the method + params it produced.
 *
 * Bearer-token check matches the real VTD: a missing or wrong token →
 * 401. The fixture's `authToken` is fixed per server and surfaces via
 * `start()`'s return value alongside the bound port + url.
 */

import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {randomBytes} from 'node:crypto'
import type {AddressInfo} from 'node:net'

import {VtDaemonClient} from '../../VtDaemonClient.ts'

export interface ReceivedRequest {
    readonly method: string
    readonly params: unknown
    readonly id: number | string | null
}

export type RouteResponder = (params: unknown) => unknown

export interface FakeRpcServerHandle {
    readonly baseUrl: string
    readonly authToken: string
    readonly received: ReadonlyArray<ReceivedRequest>
    readonly client: VtDaemonClient
    readonly stop: () => Promise<void>
}

export async function startFakeRpcServer(
    responders: Readonly<Record<string, RouteResponder>>,
): Promise<FakeRpcServerHandle> {
    const authToken: string = randomBytes(16).toString('hex')
    const received: ReceivedRequest[] = []

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
        if (req.method !== 'POST' || req.url !== '/rpc') {
            res.writeHead(404); res.end(); return
        }
        const auth: string | undefined = req.headers.authorization
        if (auth !== `Bearer ${authToken}`) {
            res.writeHead(401); res.end(); return
        }
        let body: string = ''
        req.on('data', (chunk: Buffer): void => { body += chunk.toString('utf8') })
        req.on('end', (): void => {
            let envelope: {
                readonly jsonrpc?: unknown
                readonly id?: unknown
                readonly method?: unknown
                readonly params?: unknown
            }
            try {
                envelope = JSON.parse(body)
            } catch {
                res.writeHead(400); res.end(); return
            }
            const method: string = String(envelope.method)
            const id: number | string | null = (envelope.id ?? null) as number | string | null
            received.push({method, params: envelope.params, id})
            const responder: RouteResponder | undefined = responders[method]
            if (responder === undefined) {
                res.writeHead(200, {'content-type': 'application/json'})
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: {code: -32601, message: `method not found: ${method}`},
                }))
                return
            }
            let result: unknown
            try {
                result = responder(envelope.params)
            } catch (cause) {
                res.writeHead(200, {'content-type': 'application/json'})
                res.end(JSON.stringify({
                    jsonrpc: '2.0', id,
                    error: {code: -32000, message: (cause as Error).message},
                }))
                return
            }
            res.writeHead(200, {'content-type': 'application/json'})
            res.end(JSON.stringify({jsonrpc: '2.0', id, result}))
        })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port: number = (server.address() as AddressInfo).port
    const baseUrl: string = `http://127.0.0.1:${port}`
    const client: VtDaemonClient = new VtDaemonClient({baseUrl, authToken})

    return {
        baseUrl,
        authToken,
        received,
        client,
        stop: async (): Promise<void> => {
            await new Promise<void>((resolve) => server.close(() => resolve()))
        },
    }
}
