// Black-box tests for GET /settings.
// Brings up a real server via startHttpDaemonServer and exercises the endpoint
// with/without the bearer token. Asserts on the observable wire response only —
// no internal mocks. loadSettings() reads $VOICETREE_HOME_PATH/settings.json,
// so the test points that env at a temp dir with a known agents list.

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {generateAuthToken} from '@vt/vt-rpc'
import {startHttpDaemonServer, type HookHandler, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'

const noopHook: HookHandler = (): unknown => ({ok: true})
const emptyCatalog: ToolCatalog = new Map()
const silentLogger = {logRequest: (): void => {}, logError: (): void => {}}

const active: HttpDaemonServerHandle[] = []
let homeDir: string
let prevHome: string | undefined

beforeEach((): void => {
    homeDir = mkdtempSync(join(tmpdir(), 'vtd-settings-test-'))
    writeFileSync(
        join(homeDir, 'settings.json'),
        JSON.stringify({
            agents: [{name: 'Claude Sonnet'}, {name: 'Gemini'}],
            INJECT_ENV_VARS: {ANTHROPIC_API_KEY: 'sk-super-secret'},
        }),
    )
    prevHome = process.env['VOICETREE_HOME_PATH']
    process.env['VOICETREE_HOME_PATH'] = homeDir
})

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        await active.pop()!.stop().catch((): void => {})
    }
    if (prevHome === undefined) delete process.env['VOICETREE_HOME_PATH']
    else process.env['VOICETREE_HOME_PATH'] = prevHome
    rmSync(homeDir, {recursive: true, force: true})
})

async function bring(): Promise<{handle: HttpDaemonServerHandle; token: string}> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: emptyCatalog,
        hookHandler: noopHook,
        token,
        bindHost: '127.0.0.1',
        allowedOrigins: [],
        projectPath: '/tmp/test-project',
        logger: silentLogger,
    })
    active.push(handle)
    return {handle, token}
}

describe('GET /settings', (): void => {
    it('returns 401 without a bearer token (route is authenticated)', async (): Promise<void> => {
        const {handle} = await bring()
        const res = await fetch(`${handle.url}/settings`)
        expect(res.status).toBe(401)
    })

    it('returns 200 with the resolved settings (incl. agents) when authenticated', async (): Promise<void> => {
        const {handle, token} = await bring()
        const res = await fetch(`${handle.url}/settings`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {agents?: Array<{name: string}>}
        expect(body.agents?.map(a => a.name)).toEqual(['Claude Sonnet', 'Gemini'])
    })

    it('strips INJECT_ENV_VARS secrets from the browser-safe payload', async (): Promise<void> => {
        const {handle, token} = await bring()
        const res = await fetch(`${handle.url}/settings`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(200)
        const raw = await res.text()
        // The secret value must not appear anywhere in the wire payload.
        expect(raw).not.toContain('sk-super-secret')
        const body = JSON.parse(raw) as {INJECT_ENV_VARS?: Record<string, unknown>}
        expect(body.INJECT_ENV_VARS).toEqual({})
    })

    it('rejects a wrong bearer token with 401', async (): Promise<void> => {
        const {handle} = await bring()
        const res = await fetch(`${handle.url}/settings`, {
            headers: {Authorization: 'Bearer not-the-real-token'},
        })
        expect(res.status).toBe(401)
    })
})
