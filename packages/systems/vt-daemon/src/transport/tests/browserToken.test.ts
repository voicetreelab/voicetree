// Black-box tests for GET /browser-token.
// Brings up a real server via startHttpDaemonServer and exercises the endpoint
// with different Origin headers. Asserts on the observable wire response only —
// no internal mocks.

import {afterEach, describe, expect, it} from 'vitest'
import {generateAuthToken} from '@vt/vt-rpc'
import {startHttpDaemonServer, type HookHandler, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'

const noopHook: HookHandler = (): unknown => ({ok: true})
const emptyCatalog: ToolCatalog = new Map()
const silentLogger = {logRequest: (): void => {}, logError: (): void => {}}

const active: HttpDaemonServerHandle[] = []

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        await active.pop()!.stop().catch((): void => {})
    }
})

async function bringWithCors(allowedOrigins: string[]): Promise<{handle: HttpDaemonServerHandle; token: string}> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: emptyCatalog,
        hookHandler: noopHook,
        token,
        bindHost: '127.0.0.1',
        allowedOrigins,
        projectPath: '/tmp/test-project',
        logger: silentLogger,
    })
    active.push(handle)
    return {handle, token}
}

describe('GET /browser-token', (): void => {
    it('returns 401 when allowedOrigins is empty — route is disabled entirely', async (): Promise<void> => {
        // When allowedOrigins is empty, /browser-token is not registered.
        // The request falls through to the auth gate → 401 (correct: route does not exist).
        const {handle} = await bringWithCors([])
        const res = await fetch(`${handle.url}/browser-token`, {
            headers: {Origin: 'http://localhost:3000'},
        })
        expect(res.status).toBe(401)
    })

    it('returns 200 with token/projectPath (and NO graphdUrl) when Origin is in allowedOrigins', async (): Promise<void> => {
        const {handle, token} = await bringWithCors(['http://localhost:3000'])
        const res = await fetch(`${handle.url}/browser-token`, {
            headers: {Origin: 'http://localhost:3000'},
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {token: string; projectPath: string; graphdUrl?: unknown}
        expect(body.token).toBe(token)
        expect(body.projectPath).toBe('/tmp/test-project')
        // The gateway is structurally enforced: the browser is handed NO graphd address.
        expect(body.graphdUrl).toBeUndefined()
    })

    it('returns 403 when Origin is not in allowedOrigins', async (): Promise<void> => {
        const {handle} = await bringWithCors(['http://localhost:3000'])
        const res = await fetch(`${handle.url}/browser-token`, {
            headers: {Origin: 'http://localhost:5173'},
        })
        expect(res.status).toBe(403)
    })

    it('returns 403 when Origin header is absent (no Origin → not a cross-origin browser request)', async (): Promise<void> => {
        const {handle} = await bringWithCors(['http://localhost:3000'])
        const res = await fetch(`${handle.url}/browser-token`)
        expect(res.status).toBe(403)
    })

    it('returns CORS Allow-Origin header matching the request Origin on success', async (): Promise<void> => {
        const {handle} = await bringWithCors(['http://localhost:3000'])
        const res = await fetch(`${handle.url}/browser-token`, {
            headers: {Origin: 'http://localhost:3000'},
        })
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    })

    it('does not expose CORS headers for denied origins', async (): Promise<void> => {
        const {handle} = await bringWithCors(['http://localhost:3000'])
        const res = await fetch(`${handle.url}/browser-token`, {
            headers: {Origin: 'http://evil.com:3000'},
        })
        expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('preflight OPTIONS returns 204 with CORS headers for allowed origin', async (): Promise<void> => {
        const {handle} = await bringWithCors(['http://localhost:3000'])
        const res = await fetch(`${handle.url}/browser-token`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://localhost:3000',
                'Access-Control-Request-Method': 'GET',
            },
        })
        expect(res.status).toBe(204)
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
        expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
    })
})
