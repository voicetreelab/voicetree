// Black-box wire tests for GET /health (BF-372).
//
// Brings up a real http.createServer via startHttpDaemonServer on port 0,
// hits /health with fetch, and asserts on observable wire behaviour. No
// spies, no internal mocks — the wire is the contract.
//
// Covers the four route-level cases from the BF-372 acceptance section
// (no auth → 200, wrong auth → 200, /rpc no auth → 401 regression guard,
// POST /health → 404 method fallthrough) plus the optional-readHealth
// 503 path that this leaf added for the parallel decomposition (see
// StartHttpDaemonOptions.readHealth doc comment).

import {afterEach, describe, expect, it} from 'vitest'

import {generateAuthToken} from '@vt/vt-rpc'

import type {VtDaemonHealthResponse} from '../../contract.ts'
import {VtDaemonHealthResponseSchema} from '../../contract.ts'
import {
    startHttpDaemonServer,
    type HttpDaemonServerHandle,
    type ToolCatalog,
} from '../httpServer.ts'

interface Ctx {
    handle: HttpDaemonServerHandle
    token: string
}

const active: Ctx[] = []

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        const c: Ctx = active.pop()!
        await c.handle.stop().catch((): void => {})
    }
})

async function bring(
    readHealth?: () => VtDaemonHealthResponse,
): Promise<Ctx> {
    const token: string = generateAuthToken()
    const catalog: ToolCatalog = new Map()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog,
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
        readHealth,
    })
    const ctx: Ctx = {handle, token}
    active.push(ctx)
    return ctx
}

const fakeBody: VtDaemonHealthResponse = {
    version: '0.1.0',
    project: '/abs/project',
    uptimeSeconds: 7,
    daemonKind: 'vtd',
    owner: {
        schemaVersion: 1,
        canonicalProject: '/abs/project',
        pid: 99_999,
        ppid: 1,
        port: 51_888,
        ownerNonce: 'nonce-abc',
        contractVersion: '0.1.0',
    },
}

describe('GET /health (BF-372)', (): void => {
    it('returns 200 + body parsing against VtDaemonHealthResponseSchema with NO auth header', async (): Promise<void> => {
        const {handle} = await bring(() => fakeBody)
        const res = await fetch(`${handle.url}/health`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('application/json')
        const body: unknown = await res.json()
        const parsed = VtDaemonHealthResponseSchema.safeParse(body)
        expect(parsed.success).toBe(true)
        expect(body).toEqual(fakeBody)
    })

    it('IGNORES the Authorization header — wrong bearer still returns 200', async (): Promise<void> => {
        const {handle} = await bring(() => fakeBody)
        const res = await fetch(`${handle.url}/health`, {
            headers: {Authorization: 'Bearer nonsense'},
        })
        expect(res.status).toBe(200)
        const body: unknown = await res.json()
        expect(body).toEqual(fakeBody)
    })

    it('REGRESSION GUARD: POST /rpc with no auth still returns 401 (the /health branch must not have unauth-ed everything)', async (): Promise<void> => {
        const {handle} = await bring(() => fakeBody)
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', method: 'x', id: 1}),
        })
        expect(res.status).toBe(401)
    })

    it('POST /health falls through to 404 (GET-only, per BF-372 Gotcha 5)', async (): Promise<void> => {
        const {handle, token} = await bring(() => fakeBody)
        // Send WITH valid auth so the 404 we assert is the method-fallthrough,
        // not the auth gate. POST /health with no token would 401 — that's
        // not the regression we want to assert here.
        const res = await fetch(`${handle.url}/health`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: '{}',
        })
        expect(res.status).toBe(404)
    })

    it('returns 503 + json error when readHealth is undefined (Phase-1 optional-wiring path)', async (): Promise<void> => {
        const {handle} = await bring(undefined)
        const res = await fetch(`${handle.url}/health`)
        expect(res.status).toBe(503)
        expect(res.headers.get('content-type')).toBe('application/json')
        const body = (await res.json()) as {error: string}
        expect(body).toEqual({error: 'health probe not wired'})
    })

    it('reads owner identity LIVE on every request (live ownerHandle.health() pattern, BF-372 Gotcha 6)', async (): Promise<void> => {
        // The readHealth callback is invoked on every request. A daemon
        // whose owner identity flips between requests (e.g. ownerHandle
        // re-binds a different port) MUST surface that to the next
        // probe, otherwise BF-374's storm test sees stale ownerNonce
        // and flips reuse decisions to unsafe-owner. Verify the
        // request-time invocation by mutating between fetches.
        let counter = 0
        const live: () => VtDaemonHealthResponse = () => ({
            ...fakeBody,
            uptimeSeconds: counter++,
        })
        const {handle} = await bring(live)
        const r1 = (await (await fetch(`${handle.url}/health`)).json()) as VtDaemonHealthResponse
        const r2 = (await (await fetch(`${handle.url}/health`)).json()) as VtDaemonHealthResponse
        expect(r1.uptimeSeconds).toBe(0)
        expect(r2.uptimeSeconds).toBe(1)
    })
})
