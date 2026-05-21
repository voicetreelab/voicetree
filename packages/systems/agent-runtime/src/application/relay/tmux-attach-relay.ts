import {execFileSync} from 'node:child_process'
import type {IncomingMessage, Server} from 'node:http'
import type {Duplex} from 'node:stream'
import pty, {type IPty} from 'node-pty'
import {WebSocket, WebSocketServer} from 'ws'
import {getTmuxBinaryPath, getTmuxCommandArgs} from '../terminals/tmux/tmux-launchagent'
import {hasSession, resolveTmuxSessionName} from '../terminals/tmux/tmux-session-manager'

const DEFAULT_COLS: 120 = 120
const DEFAULT_ROWS: 40 = 40
const PASTE_CHUNK_BYTES: 1024 = 1024
const PASTE_CHUNK_DELAY_MS: 25 = 25
const INTERACTIVE_INPUT_BYTES: 64 = 64
const ATTACH_ROUTE: RegExp = /^\/terminals\/([^/]+)\/attach\/?$/

export interface TmuxAttachRelayOptions {
    readonly cwd?: string
    readonly env?: NodeJS.ProcessEnv
}

export interface TmuxAttachRelayHandle {
    readonly close: () => void
}

type ParsedAttachRequest = {
    readonly sessionName: string
    readonly cols: number
    readonly rows: number
} | null

function positiveInteger(value: string | null, fallback: number): number {
    const parsed: number = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseAttachRequest(request: IncomingMessage): ParsedAttachRequest {
    if (!request.url) return null
    const url: URL = new URL(request.url, 'http://127.0.0.1')
    const match: RegExpMatchArray | null = url.pathname.match(ATTACH_ROUTE)
    if (!match?.[1]) return null

    return {
        sessionName: decodeURIComponent(match[1]),
        cols: positiveInteger(url.searchParams.get('cols'), DEFAULT_COLS),
        rows: positiveInteger(url.searchParams.get('rows'), DEFAULT_ROWS),
    }
}

function configureTmuxSession(sessionName: string): void {
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'escape-time', '0']), {stdio: 'ignore'})
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'status', 'off']), {stdio: 'ignore'})
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'mouse', 'on']), {stdio: 'ignore'})
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'history-limit', '9999']), {stdio: 'ignore'})
}

function resizeTmuxPane(sessionName: string, cols: number, rows: number): void {
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['resize-pane', '-t', sessionName, '-x', String(cols), '-y', String(rows)]), {stdio: 'ignore'})
}

function sendData(ws: WebSocket, payload: string): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({type: 'data', payload}))
    }
}

function sendExit(ws: WebSocket, code: number | null): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({type: 'exit', code}))
    }
}

function enqueuePacedInput(term: IPty, queue: string[], state: {flushing: boolean}, payload: string): void {
    if (payload.length <= INTERACTIVE_INPUT_BYTES && !state.flushing) {
        term.write(payload)
        return
    }
    for (let offset = 0; offset < payload.length; offset += PASTE_CHUNK_BYTES) {
        queue.push(payload.slice(offset, offset + PASTE_CHUNK_BYTES))
    }
    if (state.flushing) return

    state.flushing = true
    const flushNext = (): void => {
        const chunk: string | undefined = queue.shift()
        if (!chunk) {
            state.flushing = false
            return
        }
        term.write(chunk)
        setTimeout(flushNext, PASTE_CHUNK_DELAY_MS)
    }
    flushNext()
}

function parseWsMessage(raw: Buffer | ArrayBuffer | Buffer[]): unknown {
    const text: string = Buffer.isBuffer(raw)
        ? raw.toString()
        : Array.isArray(raw)
            ? Buffer.concat(raw).toString()
            : Buffer.from(raw).toString()
    return JSON.parse(text)
}

export async function attachTmuxSessionToWebSocket(
    ws: WebSocket,
    request: IncomingMessage,
    options: TmuxAttachRelayOptions = {}
): Promise<void> {
    const parsed: ParsedAttachRequest = parseAttachRequest(request)
    if (!parsed) {
        ws.close()
        return
    }
    const sessionName: string = resolveTmuxSessionName(parsed.sessionName)

    try {
        if (!(await hasSession(sessionName))) {
            sendData(ws, '[session ended — agent exited]\r\n')
            sendExit(ws, 0)
            ws.close()
            return
        }
    } catch (error) {
        sendData(ws, `tmux session check failed: ${error instanceof Error ? error.message : String(error)}\r\n`)
        sendExit(ws, 1)
        ws.close()
        return
    }

    try {
        configureTmuxSession(sessionName)
    } catch (error) {
        sendData(ws, `tmux session configuration failed: ${error instanceof Error ? error.message : String(error)}\r\n`)
        sendExit(ws, 1)
        ws.close()
        return
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.env,
        PATH: options.env?.PATH ?? process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: options.env?.HOME ?? process.env.HOME ?? process.cwd(),
        TERM: 'xterm-256color',
        LANG: options.env?.LANG ?? process.env.LANG ?? 'en_US.UTF-8',
    }
    delete env.npm_config_prefix

    let term: IPty
    try {
        term = pty.spawn(getTmuxBinaryPath(), getTmuxCommandArgs(['attach', '-t', sessionName]), {
            name: 'xterm-256color',
            cols: parsed.cols,
            rows: parsed.rows,
            cwd: options.cwd ?? process.cwd(),
            env,
        })
    } catch (error) {
        sendData(ws, `node-pty spawn failed: ${error instanceof Error ? error.message : String(error)}\r\n`)
        sendExit(ws, 1)
        ws.close()
        return
    }

    const pendingWrites: string[] = []
    const writeState: {flushing: boolean} = {flushing: false}

    term.onData((payload: string): void => sendData(ws, payload))
    term.onExit(({exitCode}: {readonly exitCode: number}): void => {
        sendExit(ws, exitCode)
        ws.close()
    })

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
        const msg: unknown = parseWsMessage(raw)
        if (!msg || typeof msg !== 'object') return
        const record: Record<string, unknown> = msg as Record<string, unknown>

        if ((record.type === 'input' || record.type === 'data') && typeof record.payload === 'string') {
            enqueuePacedInput(term, pendingWrites, writeState, record.payload)
            return
        }

        if (record.type === 'resize') {
            const cols: number = Number(record.cols)
            const rows: number = Number(record.rows)
            if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
                term.resize(cols, rows)
                resizeTmuxPane(sessionName, cols, rows)
            }
        }
    })

    ws.on('close', (): void => {
        term.kill()
    })
}

export function mountTmuxAttachRelay(server: Server, options: TmuxAttachRelayOptions = {}): TmuxAttachRelayHandle {
    const wss: WebSocketServer = new WebSocketServer({noServer: true})
    const upgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        if (!parseAttachRequest(request)) {
            socket.destroy()
            return
        }
        wss.handleUpgrade(request, socket, head, (ws: WebSocket): void => {
            void attachTmuxSessionToWebSocket(ws, request, options)
        })
    }

    server.on('upgrade', upgradeListener)

    return {
        close: (): void => {
            server.off('upgrade', upgradeListener)
        },
    }
}
