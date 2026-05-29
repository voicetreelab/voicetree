// Black-box tests for dispatchRpcRequest's internal_error envelope. The
// production motivation: undici's fetch throws TypeError("fetch failed") with
// the real network reason (ECONNREFUSED, ETIMEDOUT, …) on .cause; without
// walking the cause chain into the JSON-RPC `data` field, callers see only
// the opaque "fetch failed" message. These tests pin the chain-walk
// behavior to the wire.

import {describe, expect, it} from 'vitest'

import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {dispatchRpcRequest} from '../rpcDispatch.ts'
import type {ToolCatalog, ToolHandler} from '../httpServerTypes.ts'

type InternalErrorBody = {
    jsonrpc: '2.0'
    id: number | string | null
    error: {
        code: number
        message: string
        data?: {
            kind: 'internal_error'
            causes: ReadonlyArray<{
                name: string
                message: string
                code?: string | number
                errno?: number
            }>
        }
    }
}

function catalogWith(method: string, handler: ToolHandler): ToolCatalog {
    return new Map<string, ToolHandler>([[method, handler]])
}

function rpcRequest(method: string, id: number = 1): string {
    return JSON.stringify({jsonrpc: '2.0', method, params: {}, id})
}

function makeFetchFailedError(): Error {
    // Shape mirrors undici's wrapping: outer TypeError with message "fetch
    // failed" and a .cause pointing at the syscall-level Error carrying the
    // .code / .errno that callers actually want to see.
    const inner = new Error('connect ECONNREFUSED 127.0.0.1:54321') as Error & {code: string; errno: number}
    inner.code = 'ECONNREFUSED'
    inner.errno = -61
    return new TypeError('fetch failed', {cause: inner})
}

describe('dispatchRpcRequest — internal_error cause chain', (): void => {
    it('surfaces undici-shaped cause (ECONNREFUSED) in error.data.causes', async (): Promise<void> => {
        const catalog = catalogWith('boom', async (): Promise<McpToolResponse> => {
            throw makeFetchFailedError()
        })

        const {status, body} = await dispatchRpcRequest(rpcRequest('boom'), catalog)

        expect(status).toBe(200)
        const envelope = body as InternalErrorBody
        expect(envelope.error.code).toBe(-32603)
        expect(envelope.error.message).toBe('fetch failed')
        expect(envelope.error.data).toBeDefined()
        expect(envelope.error.data!.kind).toBe('internal_error')
        expect(envelope.error.data!.causes).toEqual([
            {name: 'Error', message: 'connect ECONNREFUSED 127.0.0.1:54321', code: 'ECONNREFUSED', errno: -61},
        ])
    })

    it('walks multi-level cause chains up to depth 4', async (): Promise<void> => {
        const level4 = new Error('root')
        const level3 = new Error('mid-b', {cause: level4})
        const level2 = new Error('mid-a', {cause: level3})
        const level1 = new Error('outer', {cause: level2})

        const catalog = catalogWith('deep', async (): Promise<McpToolResponse> => {
            throw new Error('top', {cause: level1})
        })

        const {body} = await dispatchRpcRequest(rpcRequest('deep'), catalog)
        const envelope = body as InternalErrorBody
        const causes = envelope.error.data?.causes ?? []
        expect(causes.map(c => c.message)).toEqual(['outer', 'mid-a', 'mid-b', 'root'])
    })

    it('truncates cause chains longer than 4 to bound response size', async (): Promise<void> => {
        let current: Error | undefined
        for (let i = 6; i >= 1; i--) {
            current = new Error(`level-${i}`, current === undefined ? undefined : {cause: current})
        }
        const catalog = catalogWith('long', async (): Promise<McpToolResponse> => {
            throw new Error('top', {cause: current!})
        })

        const {body} = await dispatchRpcRequest(rpcRequest('long'), catalog)
        const envelope = body as InternalErrorBody
        expect(envelope.error.data?.causes.length).toBe(4)
    })

    it('omits data field entirely when there is no .cause', async (): Promise<void> => {
        const catalog = catalogWith('plain', async (): Promise<McpToolResponse> => {
            throw new Error('something went wrong')
        })

        const {body} = await dispatchRpcRequest(rpcRequest('plain'), catalog)
        const envelope = body as InternalErrorBody
        expect(envelope.error.code).toBe(-32603)
        expect(envelope.error.message).toBe('something went wrong')
        expect(envelope.error.data).toBeUndefined()
    })

    it('serializes a non-Error cause as a NonError link', async (): Promise<void> => {
        const catalog = catalogWith('weird', async (): Promise<McpToolResponse> => {
            throw new Error('wrapper', {cause: 'string-as-cause'})
        })

        const {body} = await dispatchRpcRequest(rpcRequest('weird'), catalog)
        const envelope = body as InternalErrorBody
        expect(envelope.error.data?.causes).toEqual([{name: 'NonError', message: 'string-as-cause'}])
    })

    it('keeps existing happy-path envelope unchanged when handler returns ok', async (): Promise<void> => {
        const catalog = catalogWith('ok', async (): Promise<McpToolResponse> => buildJsonResponse({ok: true}))
        const {status, body} = await dispatchRpcRequest(rpcRequest('ok'), catalog)
        expect(status).toBe(200)
        expect(body).toEqual({jsonrpc: '2.0', id: 1, result: {ok: true}})
    })
})
