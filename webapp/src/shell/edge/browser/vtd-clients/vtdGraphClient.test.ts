// Black-box tests for the typed graph gateway client. A real loopback
// http.Server speaks JSON-RPC; each test asserts the OBSERVABLE wire I/O —
// the dotted method name, the bearer header, the params body, and that the
// parsed `result` is what the client returns. A JSON-RPC `error` body must make
// the call throw. No mocks, no spies — the wire is the contract.

import {afterEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {GRAPH_GATEWAY_METHODS} from '@vt/vt-daemon-protocol'
import {
    vtdApplyDelta,
    vtdCloneView,
    vtdGetPreviewContainedNodeIds,
    vtdOpenProject,
} from './vtdGraphClient'

interface Captured {
    method: string
    params: unknown
    auth: string | undefined
}

type RpcReply = {result: unknown} | {error: {code: number; message: string}}

let server: Server | null = null

afterEach(async () => {
    if (server) await new Promise<void>(res => server!.close(() => res()))
    server = null
})

/** Bring up a loopback /rpc server returning `reply`, capturing the request. */
async function bring(reply: RpcReply): Promise<{url: string; last: () => Captured}> {
    let captured: Captured | null = null
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
            const parsed = JSON.parse(body) as {method: string; params: unknown}
            captured = {method: parsed.method, params: parsed.params, auth: req.headers.authorization}
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({jsonrpc: '2.0', id: 1, ...reply}))
        })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const {port} = server!.address() as AddressInfo
    return {url: `http://127.0.0.1:${port}`, last: () => captured!}
}

describe('vtdGraphClient', () => {
    it('applyDelta posts the dotted method, bearer header and {delta, recordForUndo}', async () => {
        const {url, last} = await bring({result: null})
        const delta = [{kind: 'noop'}] as never
        await vtdApplyDelta(url, 'tok-123', delta, true)
        const req = last()
        expect(req.method).toBe(GRAPH_GATEWAY_METHODS.applyDelta)
        expect(req.method).toBe('graph.applyDelta')
        expect(req.auth).toBe('Bearer tok-123')
        expect(req.params).toEqual({delta, recordForUndo: true})
    })

    it('getPreviewContainedNodeIds returns the bare string[] result verbatim', async () => {
        const {url, last} = await bring({result: ['a', 'b']})
        const ids = await vtdGetPreviewContainedNodeIds(url, 'tok', 'node-1')
        expect(ids).toEqual(['a', 'b'])
        expect(last().params).toEqual({nodeId: 'node-1'})
    })

    it('cloneView carries both srcViewId and the destination name', async () => {
        const {url, last} = await bring({result: {viewId: 'v2', name: 'Focus'}})
        const view = await vtdCloneView(url, 'tok', 'v1', 'Focus')
        expect(view).toEqual({viewId: 'v2', name: 'Focus'})
        expect(last().params).toEqual({srcViewId: 'v1', name: 'Focus'})
    })

    it('openProject returns the boot triple from the result', async () => {
        const triple = {sessionId: 's1', projectState: {readPaths: []}, initialProjectedGraph: {nodes: []}}
        const {url, last} = await bring({result: triple})
        const out = await vtdOpenProject(url, 'tok')
        expect(out).toEqual(triple)
        expect(last().method).toBe('graph.openProject')
        expect(last().params).toEqual({})
    })

    it('throws when the server returns a JSON-RPC error body', async () => {
        const {url} = await bring({error: {code: -32000, message: 'boom'}})
        await expect(vtdOpenProject(url, 'tok')).rejects.toThrow(/boom/)
    })
})
