// Integration test for the /terminals/:id/attach route on the unified HTTP
// daemon (Step 9f). Brings up a real daemon + a real tmux session and
// exercises the full wire end-to-end:
//
//   - Real `startHttpDaemonServer` (no internal mocks)
//   - Real `ws` client (header-auth + subprotocol-auth paths)
//   - Real `tmux new-session -d` driven via @vt/agent-runtime/terminals
//   - Real `node-pty` bridge (lives inside attachTmuxSessionToWebSocket)
//
// Locks in two route-level decisions made during planning:
//
//   R2 (Lochlan): /terminals/:id/attach uses a SECOND WebSocketServer with
//   maxPayload: undefined — pastes >256 KiB MUST flow through and reach tmux
//   (NOT close 1009 like /events does). See tmuxAttachWiring.ts header.
//
//   R5 (Ayu): the route regex must match against pathname, not req.url —
//   the renderer attaches ?cols=120&rows=40 and the previous code's $ anchor
//   on req.url fell through to 404. Every test below uses a query string.

import {afterEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'

import {generateAuthToken} from '@vt/vt-rpc'
import {
    createSession,
    hasSession,
    killSession,
} from '../../agent-runtime/terminals/tmux/tmux-session-manager.ts'

import {startHttpDaemonServer, type HookHandler, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'

const TEST_TIMEOUT_MS: 20000 = 20000

const noopHook: HookHandler = (): unknown => ({ok: true})

interface Ctx {
    handle: HttpDaemonServerHandle
    token: string
}

const activeDaemons: Ctx[] = []
const activeSessions: string[] = []

afterEach(async (): Promise<void> => {
    while (activeDaemons.length > 0) {
        const c: Ctx = activeDaemons.pop()!
        await c.handle.stop().catch((): void => {})
    }
    while (activeSessions.length > 0) {
        const name: string = activeSessions.pop()!
        await killSession(name).catch((): void => {})
    }
})

async function bringDaemon(): Promise<Ctx> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: new Map() as ToolCatalog,
        hookHandler: noopHook,
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    const ctx: Ctx = {handle, token}
    activeDaemons.push(ctx)
    return ctx
}

function makeSessionName(suffix: string): string {
    return `bf312-relay-test-${process.pid}-${suffix}`
}

async function bringTmuxSession(suffix: string, command: string): Promise<string> {
    const name: string = makeSessionName(suffix)
    activeSessions.push(name)
    await createSession(name, command)
    return name
}

function wsUrlFor(handle: HttpDaemonServerHandle, sessionName: string, query: string = '?cols=120&rows=40'): string {
    return `${handle.url.replace(/^http/, 'ws')}/terminals/${encodeURIComponent(sessionName)}/attach${query}`
}

function parseDataPayload(raw: Buffer | ArrayBuffer | Buffer[]): string {
    const text: string = Buffer.isBuffer(raw)
        ? raw.toString()
        : Array.isArray(raw)
            ? Buffer.concat(raw).toString()
            : Buffer.from(raw).toString()
    try {
        const msg: unknown = JSON.parse(text)
        if (msg && typeof msg === 'object' && (msg as {type?: unknown}).type === 'data') {
            const payload: unknown = (msg as {payload?: unknown}).payload
            return typeof payload === 'string' ? payload : ''
        }
    } catch {
        // non-JSON frames are ignored
    }
    return ''
}

function collectOutput(ws: WebSocket): () => string {
    let buf: string = ''
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
        buf += parseDataPayload(raw)
    })
    return (): string => buf
}

async function delay(ms: number): Promise<void> {
    await new Promise<void>((r): void => { setTimeout((): void => r(), ms) })
}

async function waitForOutput(getter: () => string, needle: string, timeoutMs: number = 5000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (getter().includes(needle)) return
        await delay(10)
    }
    throw new Error(`timed out waiting for "${needle}"; saw:\n${getter()}`)
}

function sessionScriptThatEchoes(): string {
    // bash loop: prints BF312_READY then echoes each input line as ECHO:<line>
    // and reports its byte length. Used to assert both that data made it to
    // tmux AND that paste integrity is preserved at large frame sizes.
    const script: string = [
        'count=0',
        'total=0',
        'stty -echo',
        'printf "BF312_READY\\n"',
        'while IFS= read -r line; do printf "ECHO:%s\\n" "$line"',
        'printf "LEN:%s\\n" "${#line}"',
        'count=$((count + 1))',
        'total=$((total + ${#line}))',
        'printf "COUNT:%s TOTAL:%s\\n" "$count" "$total"',
        'done',
    ].join('; ')
    return `bash -lc '${script.replace(/'/g, `'\\''`)}'`
}

describe('GET /terminals/:id/attach — full integration on unified daemon (Step 9f)', (): void => {
    it('Authorization-header auth → 101 + tmux bytes flow end-to-end with query string (locks R5 fix)', async (): Promise<void> => {
        const {handle, token} = await bringDaemon()
        const sessionName: string = await bringTmuxSession('hdr', sessionScriptThatEchoes())

        const url: string = wsUrlFor(handle, sessionName)
        const ws = new WebSocket(url, {headers: {Authorization: `Bearer ${token}`}})
        const output = collectOutput(ws)
        await new Promise<void>((r, reject): void => {
            ws.once('open', (): void => r())
            ws.once('error', reject)
        })

        await waitForOutput(output, 'BF312_READY')
        ws.send(JSON.stringify({type: 'input', payload: 'BF312_HELLO\r'}))
        await waitForOutput(output, 'ECHO:BF312_HELLO')
        await waitForOutput(output, 'LEN:11')

        ws.close()
    }, TEST_TIMEOUT_MS)

    it('vt-bearer subprotocol auth → 101 + protocol echoed + bytes flow', async (): Promise<void> => {
        const {handle, token} = await bringDaemon()
        const sessionName: string = await bringTmuxSession('sub', sessionScriptThatEchoes())

        const url: string = wsUrlFor(handle, sessionName)
        const ws = new WebSocket(url, ['vt-bearer', token])
        const output = collectOutput(ws)
        await new Promise<void>((r, reject): void => {
            ws.once('open', (): void => r())
            ws.once('error', reject)
        })
        expect(ws.protocol).toBe('vt-bearer')

        await waitForOutput(output, 'BF312_READY')
        ws.send(JSON.stringify({type: 'input', payload: 'BF312_SUBP\r'}))
        await waitForOutput(output, 'ECHO:BF312_SUBP')

        ws.close()
    }, TEST_TIMEOUT_MS)

    it('bad bearer → 401 BEFORE upgrade, no tmux process spawned on the route', async (): Promise<void> => {
        const {handle} = await bringDaemon()
        // Use a session name that does NOT exist on the host — if the route
        // somehow accepted the upgrade and the primitive tried to spawn, the
        // tmux call would fail loudly (and `hasSession` would still be false
        // because we never created it). Asserting `statusCode === 401` plus
        // the session never existing is the tighter wire-level assertion.
        const stranger: string = makeSessionName('stranger-never-created')
        expect(await hasSession(stranger)).toBe(false)

        const url: string = wsUrlFor(handle, stranger)
        const statusCode: number = await new Promise<number>((resolveTest, rejectTest): void => {
            const ws = new WebSocket(url, {headers: {Authorization: 'Bearer wrong'}})
            ws.on('open', (): void => rejectTest(new Error('expected 401, got 101')))
            ws.on('unexpected-response', (_req, res): void => resolveTest(res.statusCode ?? -1))
            ws.on('error', (): void => { /* unexpected-response decides */ })
        })
        expect(statusCode).toBe(401)
        expect(await hasSession(stranger)).toBe(false)
    }, TEST_TIMEOUT_MS)

    it('ws.close() does NOT kill the tmux session (re-attach invariant)', async (): Promise<void> => {
        const {handle, token} = await bringDaemon()
        const sessionName: string = await bringTmuxSession('detach', sessionScriptThatEchoes())

        const url: string = wsUrlFor(handle, sessionName)
        const ws = new WebSocket(url, ['vt-bearer', token])
        const output = collectOutput(ws)
        await new Promise<void>((r, reject): void => {
            ws.once('open', (): void => r())
            ws.once('error', reject)
        })
        await waitForOutput(output, 'BF312_READY')

        ws.close()
        // Give the relay a moment to process the close + kill the pty (which
        // should detach, not destroy the tmux session).
        await delay(200)
        expect(await hasSession(sessionName)).toBe(true)
    }, TEST_TIMEOUT_MS)

    it('paste >256 KiB inbound is accepted (locks R2 option B: no maxPayload cap)', async (): Promise<void> => {
        // Locks in the R2 decision (Lochlan, 2026-05-22): the tmux-attach WSS
        // has NO inbound frame cap, separate from the /events WSS which keeps
        // maxPayload: 256 KiB. A >256 KiB single frame MUST be accepted by
        // the server — NOT trip close 1009 the way /events does for the same
        // size.
        //
        // The /events 256 KiB cap is locked in by `httpServer.test.ts:289-301`
        // ('256 KiB inbound frame cap — server closes with 1009'). This test
        // pins the divergence on /terminals/:id/attach.
        const {handle, token} = await bringDaemon()
        const sessionName: string = await bringTmuxSession('paste', sessionScriptThatEchoes())

        const url: string = wsUrlFor(handle, sessionName)
        const ws = new WebSocket(url, ['vt-bearer', token])
        const output = collectOutput(ws)
        await new Promise<void>((r, reject): void => {
            ws.once('open', (): void => r())
            ws.once('error', reject)
        })
        await waitForOutput(output, 'BF312_READY')

        let closeCode: number | undefined
        ws.on('close', (code: number): void => { closeCode = code })

        // 300 KiB single frame — comfortably over the /events 256 KiB ceiling.
        // The frame ENVELOPE (JSON-stringified) is slightly larger; we assert
        // on the actual frame size so the test fails loudly if the JSON
        // shape ever shifts under us.
        const payload: string = 'x'.repeat(300 * 1024)
        const frame: string = JSON.stringify({type: 'input', payload})
        expect(frame.length).toBeGreaterThan(256 * 1024)
        ws.send(frame)

        // The /events WSS would close immediately with 1009 on a frame this
        // size (asserted by httpServer.test.ts 'B'.repeat(300*1024) → 1009).
        // For the tmux-attach WSS, the frame is accepted: NO close arrives.
        // 500ms of settle time would have surfaced any 1009.
        await delay(500)
        expect(closeCode).toBeUndefined()
        expect(ws.readyState).toBe(WebSocket.OPEN)

        ws.close()
    }, TEST_TIMEOUT_MS)
})
