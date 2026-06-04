// Black-box test for vtdSubscribeEvents over a REAL WebSocket server. The hub
// delivers nothing until the client declares its topics with a {op:'subscribe'}
// frame; this asserts the OBSERVABLE wire behaviour — that on open the client
// sends exactly that frame for the requested topics, and offers the vt-bearer
// subprotocol carrying the token. No mocks: the socket is the contract.
// Runs in the suite's default jsdom env, whose global WebSocket connects to the
// ws server below.

import {afterEach, describe, expect, it} from 'vitest'
import {WebSocketServer, type WebSocket as WsServerSocket} from 'ws'
import type {AddressInfo} from 'node:net'
import {vtdSubscribeEvents} from './vtdRpc'

let wss: WebSocketServer | null = null
let cleanup: (() => void) | null = null

afterEach(async () => {
    cleanup?.()
    cleanup = null
    if (wss) await new Promise<void>(res => wss!.close(() => res()))
    wss = null
})

interface Connection {
    readonly protocols: readonly string[]
    readonly firstMessage: Promise<string>
}

function startServer(): Promise<{url: string; next: Promise<Connection>}> {
    return new Promise(resolve => {
        wss = new WebSocketServer({port: 0, path: '/events'})
        const next: Promise<Connection> = new Promise(resolveConn => {
            wss!.on('connection', (socket: WsServerSocket, req) => {
                const proto = (req.headers['sec-websocket-protocol'] ?? '')
                    .split(',').map(s => s.trim()).filter(Boolean)
                const firstMessage: Promise<string> = new Promise(resolveMsg => {
                    socket.once('message', (data: Buffer) => resolveMsg(data.toString()))
                })
                resolveConn({protocols: proto, firstMessage})
            })
        })
        wss!.on('listening', () => {
            const {port} = wss!.address() as AddressInfo
            resolve({url: `http://127.0.0.1:${port}`, next})
        })
    })
}

describe('vtdSubscribeEvents', () => {
    it('sends a {op:subscribe} frame for the requested topics on open', async () => {
        const {url, next} = await startServer()
        cleanup = vtdSubscribeEvents(url, 'tok-123', ['graph', 'agent-events'], () => {}, () => {})

        const conn = await next
        const msg = JSON.parse(await conn.firstMessage)
        expect(msg).toEqual({op: 'subscribe', topics: [{topic: 'graph'}, {topic: 'agent-events'}]})
    })

    it('offers the vt-bearer subprotocol carrying the token', async () => {
        const {url, next} = await startServer()
        cleanup = vtdSubscribeEvents(url, 'tok-xyz', ['graph'], () => {}, () => {})

        const conn = await next
        expect(conn.protocols).toEqual(['vt-bearer', 'tok-xyz'])
    })
})
