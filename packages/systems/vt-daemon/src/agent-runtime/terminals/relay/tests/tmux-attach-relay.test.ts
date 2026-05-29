import {execFileSync} from 'node:child_process'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {WebSocket, WebSocketServer} from 'ws'
import {getTmuxBinaryPath, getTmuxCommandArgs} from '../../tmux/tmux-server.ts'
import {buildTmuxSessionName, killSession, createSession, hasSession} from '../../tmux/tmux-session-manager.ts'
import {attachTmuxSessionToWebSocket, type TmuxAttachRelayOptions} from '../tmux-attach-relay.ts'

// Bridge-level black-box test. The daemon-side wiring lives in
// vt-daemon/transport/tmuxAttachWiring.ts; here we drive the primitive
// directly via a tiny test-local mount helper so the bridge can be verified
// in isolation from daemon auth.
function mountForTest(server: Server, options: TmuxAttachRelayOptions = {}): {readonly close: () => void} {
    const wss: WebSocketServer = new WebSocketServer({noServer: true})
    const listener = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        wss.handleUpgrade(request, socket, head, (ws: WebSocket): void => {
            void attachTmuxSessionToWebSocket(ws, request, options)
        })
    }
    server.on('upgrade', listener)
    return {close: (): void => { server.off('upgrade', listener) }}
}

const TEST_TIMEOUT_MS: 20000 = 20000

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function tmuxOutput(args: string[]): string {
    return execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(args), {encoding: 'utf8'})
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function sessionCommand(): string {
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
    return `bash -lc ${shellQuote(script)}`
}

function makeSessionName(suffix: string): string {
    return `bf312-relay-test-${process.pid}-${suffix}`
}

function parseDataMessage(raw: Buffer | ArrayBuffer | Buffer[]): string {
    const text: string = Buffer.isBuffer(raw)
        ? raw.toString()
        : Array.isArray(raw)
            ? Buffer.concat(raw).toString()
            : Buffer.from(raw).toString()
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed && (parsed as {type?: unknown}).type === 'data') {
        const payload: unknown = (parsed as {payload?: unknown}).payload
        return typeof payload === 'string' ? payload : ''
    }
    return ''
}

async function connect(url: string): Promise<{readonly ws: WebSocket, readonly output: () => string}> {
    let output: string = ''
    const ws: WebSocket = new WebSocket(url)
    ws.on('message', raw => {
        output += parseDataMessage(raw)
    })
    await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
    })
    return {ws, output: () => output}
}

async function connectAndCollect(url: string): Promise<{
    readonly closed: Promise<void>
    readonly output: () => string
    readonly ws: WebSocket
}> {
    const connection = await connect(url)
    const closed = new Promise<void>((resolve) => {
        connection.ws.on('close', resolve)
    })
    return {...connection, closed}
}

async function waitForOutput(output: () => string, needle: string, timeoutMs: number = 5000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (output().includes(needle)) return
        await delay(10)
    }
    throw new Error(`timed out waiting for ${needle}; output was:\n${output()}`)
}

async function waitForTmuxOutput(sessionName: string, needle: string, timeoutMs: number = 10000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const captured: string = tmuxOutput(['capture-pane', '-p', '-J', '-S', '-50', '-t', sessionName])
        if (captured.includes(needle)) return
        await delay(25)
    }
    throw new Error(`timed out waiting for tmux pane output ${needle}`)
}

async function waitForTmuxPaneSize(sessionName: string, expectedWidth: number, timeoutMs: number = 5000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const width: number = Number(tmuxOutput(['display-message', '-p', '-t', sessionName, '#{pane_width}']).trim())
        if (width === expectedWidth) return
        await delay(10)
    }
    throw new Error(`timed out waiting for tmux pane width ${expectedWidth}`)
}

async function waitForTmuxWindowSizeOption(sessionName: string, expected: string, timeoutMs: number = 2000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const value: string = tmuxOutput(['show-options', '-v', '-t', sessionName, 'window-size']).trim()
        if (value === expected) return
        await delay(10)
    }
    throw new Error(`timed out waiting for tmux window-size=${expected}`)
}

async function waitForTmuxMouseOption(sessionName: string, expected: string, timeoutMs: number = 2000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const value: string = tmuxOutput(['show-options', '-v', '-t', sessionName, 'mouse']).trim()
        if (value === expected) return
        await delay(10)
    }
    throw new Error(`timed out waiting for tmux mouse=${expected}`)
}

async function waitForTmuxPaneInMode(sessionName: string, expected: '1' | '0', timeoutMs: number = 2000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const value: string = tmuxOutput(['display-message', '-p', '-t', sessionName, '#{pane_in_mode}']).trim()
        if (value === expected) return
        await delay(10)
    }
    throw new Error(`timed out waiting for tmux pane_in_mode=${expected}`)
}

describe('tmux attach relay', () => {
    let server: Server | undefined
    let relay: {readonly close: () => void} | undefined
    const sessions: string[] = []

    beforeEach(() => {
        server = createServer((_req, res) => {
            res.writeHead(404)
            res.end('not found')
        })
        relay = mountForTest(server)
    })

    afterEach(async () => {
        relay?.close()
        await new Promise<void>(resolve => {
            if (!server?.listening) {
                resolve()
                return
            }
            const timeout: NodeJS.Timeout = setTimeout(resolve, 1000)
            server.close(() => {
                clearTimeout(timeout)
                resolve()
            })
        })
        for (const session of sessions.splice(0)) {
            await killSession(session)
        }
    })

    it('bridges output, paced input, resize, and detach without killing the tmux session', async () => {
        const sessionName: string = makeSessionName('bridge')
        sessions.push(sessionName)
        await createSession(sessionName, sessionCommand())
        await waitForTmuxOutput(sessionName, 'BF312_READY')

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {ws, output} = await connect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(sessionName)}/attach?cols=120&rows=40`
        )

        try {
            await waitForOutput(output, 'BF312_READY')

            ws.send(JSON.stringify({type: 'input', payload: 'BF312_HELLO\r'}))
            await waitForOutput(output, 'ECHO:BF312_HELLO')
            await waitForOutput(output, 'LEN:11')

            ws.send(JSON.stringify({type: 'input', payload: 'BF312_SECOND\r'}))
            await waitForOutput(output, 'ECHO:BF312_SECOND')

            const pasteLines: string[] = Array.from(
                {length: 64},
                (_value: unknown, index: number): string => `P${String(index).padStart(2, '0')}-${'x'.repeat(11)}`
            )
            const pastePayload: string = pasteLines.map(line => `${line}\r`).join('')
            expect(pastePayload.length).toBe(1024)
            ws.send(JSON.stringify({type: 'input', payload: pastePayload}))
            await delay(4000)
            const captured: string = tmuxOutput(['capture-pane', '-p', '-J', '-S', '-200', '-t', sessionName])
            expect(captured).toContain('COUNT:66 TOTAL:983')

            await waitForTmuxWindowSizeOption(sessionName, 'latest')
            await waitForTmuxMouseOption(sessionName, 'off')

            ws.send(JSON.stringify({type: 'resize', cols: 160, rows: 40}))
            await waitForTmuxPaneSize(sessionName, 160)

            ws.close()
            await delay(100)
            expect(await hasSession(sessionName)).toBe(true)
        } finally {
            ws.close()
        }
    }, TEST_TIMEOUT_MS)

    it('enables tmux mouse mode when the relay option opts in', async () => {
        const sessionName: string = makeSessionName('mouse-on')
        sessions.push(sessionName)
        await createSession(sessionName, sessionCommand())
        await waitForTmuxOutput(sessionName, 'BF312_READY')

        relay?.close()
        relay = mountForTest(server!, {
            getTmuxMouseMode: () => true,
        })

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {ws, output} = await connect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(sessionName)}/attach?cols=120&rows=40`
        )

        try {
            await waitForOutput(output, 'BF312_READY')
            await waitForTmuxMouseOption(sessionName, 'on')
        } finally {
            ws.close()
        }
    }, TEST_TIMEOUT_MS)

    it('scroll RPC drives tmux copy-mode without enabling mouse mode', async () => {
        const sessionName: string = makeSessionName('scroll')
        sessions.push(sessionName)
        await createSession(sessionName, sessionCommand())
        await waitForTmuxOutput(sessionName, 'BF312_READY')

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {ws, output} = await connect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(sessionName)}/attach?cols=120&rows=40`
        )

        try {
            await waitForOutput(output, 'BF312_READY')
            await waitForTmuxMouseOption(sessionName, 'off')
            await waitForTmuxPaneInMode(sessionName, '0')

            ws.send(JSON.stringify({type: 'scroll', direction: 'up', lines: 3}))
            await waitForTmuxPaneInMode(sessionName, '1')

            // scroll-down past the bottom exits copy-mode (`copy-mode -e`).
            ws.send(JSON.stringify({type: 'scroll', direction: 'down', lines: 100}))
            await waitForTmuxPaneInMode(sessionName, '0')
        } finally {
            ws.close()
        }
    }, TEST_TIMEOUT_MS)

    it('drops malformed WS frames without crashing the relay', async () => {
        const sessionName: string = makeSessionName('badframe')
        sessions.push(sessionName)
        await createSession(sessionName, sessionCommand())
        await waitForTmuxOutput(sessionName, 'BF312_READY')

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {ws, output} = await connect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(sessionName)}/attach?cols=120&rows=40`
        )

        try {
            await waitForOutput(output, 'BF312_READY')

            // Sequence: a frame that is invalid JSON, then a frame that is valid
            // JSON but the wrong shape, then a normal input frame. The relay must
            // survive both bad frames and still deliver the third.
            ws.send('{not valid json')
            ws.send(JSON.stringify(['unexpected', 'shape']))
            ws.send(JSON.stringify({type: 'input', payload: 'BF312_AFTER_BAD\r'}))

            await waitForOutput(output, 'ECHO:BF312_AFTER_BAD')
            expect(await hasSession(sessionName)).toBe(true)
        } finally {
            ws.close()
        }
    }, TEST_TIMEOUT_MS)

    it('attaches a raw terminal route to its project-namespaced tmux session', async () => {
        const terminalId: string = makeSessionName('namespaced')
        const env: Record<string, string> = {
            VOICETREE_PROJECT_PATH: `/tmp/${terminalId}-project`,
        }
        const sessionName: string = buildTmuxSessionName(terminalId, env)
        sessions.push(terminalId)
        await createSession(terminalId, sessionCommand(), env)
        await waitForTmuxOutput(sessionName, 'BF312_READY')

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {ws, output} = await connect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(terminalId)}/attach?cols=120&rows=40`
        )

        try {
            await waitForOutput(output, 'BF312_READY')

            ws.send(JSON.stringify({type: 'input', payload: 'BF312_NAMESPACED\r'}))
            await waitForOutput(output, 'ECHO:BF312_NAMESPACED')

            const captured: string = tmuxOutput(['capture-pane', '-p', '-J', '-S', '-50', '-t', sessionName])
            expect(captured).toContain('ECHO:BF312_NAMESPACED')
            expect(await hasSession(terminalId)).toBe(true)
        } finally {
            ws.close()
        }
    }, TEST_TIMEOUT_MS)

    it('reports a missing session once instead of surfacing tmux set failures', async () => {
        const sessionName: string = makeSessionName('missing')

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {closed, output, ws} = await connectAndCollect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(sessionName)}/attach`
        )

        await closed
        expect(output()).toContain('[session ended — agent exited]')
        expect(output()).not.toContain('tmux session configuration failed')
        ws.close()
    }, TEST_TIMEOUT_MS)

    it('reports node-pty load failure at attach time without killing the tmux session', async () => {
        const sessionName: string = makeSessionName('missing-pty')
        sessions.push(sessionName)
        await createSession(sessionName, sessionCommand())
        await waitForTmuxOutput(sessionName, 'BF312_READY')

        relay?.close()
        relay = mountForTest(server!, {
            loadPty: async () => {
                throw new Error('native module missing')
            },
            logger: {
                info: () => undefined,
                warn: () => undefined,
            },
        })

        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
        const port: number = (server!.address() as AddressInfo).port
        const {closed, output, ws} = await connectAndCollect(
            `ws://127.0.0.1:${port}/terminals/${encodeURIComponent(sessionName)}/attach`
        )

        await closed
        expect(output()).toContain('node-pty unavailable: native module missing')
        expect(await hasSession(sessionName)).toBe(true)
        ws.close()
    }, TEST_TIMEOUT_MS)
})
