import {execFile, execFileSync} from 'node:child_process'
import type {IncomingMessage} from 'node:http'
import type {IPty} from 'node-pty'
import {WebSocket} from 'ws'
import {getTmuxBinaryPath, getTmuxCommandArgs} from '../tmux/tmux-server'
import {hasSession, resolveTmuxSessionName} from '../tmux/tmux-session-manager'

const DEFAULT_COLS: 120 = 120
const DEFAULT_ROWS: 40 = 40
const PASTE_CHUNK_BYTES: 1024 = 1024
const PASTE_CHUNK_DELAY_MS: 25 = 25
const INTERACTIVE_INPUT_BYTES: 64 = 64
const ATTACH_ROUTE: RegExp = /^\/terminals\/([^/]+)\/attach\/?$/

export interface TmuxRelayLogger {
    readonly warn: (message: string) => void
    readonly info: (message: string) => void
}

const defaultLogger: TmuxRelayLogger = {
    warn: (message: string): void => console.warn(message),
    info: (message: string): void => console.log(message),
}

export interface TmuxAttachRelayOptions {
    readonly cwd?: string
    readonly env?: NodeJS.ProcessEnv
    readonly loadPty?: () => Promise<NodePtyModule>
    readonly logger?: TmuxRelayLogger
    readonly getTmuxMouseMode?: () => boolean | Promise<boolean>
}

type ParsedAttachRequest = {
    readonly sessionName: string
    readonly cols: number
    readonly rows: number
} | null

type NodePtyModule = typeof import('node-pty')
type NodePtyLoadResult = NodePtyModule & {readonly default?: NodePtyModule}

async function loadNodePty(): Promise<NodePtyModule> {
    const loaded: NodePtyLoadResult = await import('node-pty') as NodePtyLoadResult
    return loaded.default ?? loaded
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

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

function configureTmuxSession(sessionName: string, tmuxMouseMode: boolean): void {
    // window-size=latest lets the most recently active client drive the window/pane size.
    // The relay's pty (via node-pty's TIOCSWINSZ → SIGWINCH → tmux client → server) is then
    // sufficient to resize panes: no explicit `tmux resize-pane` exec is needed at runtime.
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'window-size', 'latest']), {stdio: 'ignore'})
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'escape-time', '0']), {stdio: 'ignore'})
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'status', 'off']), {stdio: 'ignore'})
    // Mouse mode is user-configurable: off lets the user select terminal text with the
    // mouse for browser-style copy without holding Shift; on lets tmux capture wheel
    // and click events natively. The wheel-scroll RPC below works in both modes.
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'mouse', tmuxMouseMode ? 'on' : 'off']), {stdio: 'ignore'})
    execFileSync(getTmuxBinaryPath(), getTmuxCommandArgs(['set', '-t', sessionName, 'history-limit', '9999']), {stdio: 'ignore'})
}

function execTmuxScroll(sessionName: string, direction: 'up' | 'down', lines: number): void {
    // Drive tmux's scrollback without requiring `mouse on` (which would force users to
    // hold Shift for browser text selection). copy-mode -e enters copy-mode and exits
    // automatically when scroll-down reaches the live view, so the user is never left
    // stranded in copy-mode.
    const action: 'scroll-up' | 'scroll-down' = direction === 'up' ? 'scroll-up' : 'scroll-down'
    execFile(getTmuxBinaryPath(), getTmuxCommandArgs([
        'copy-mode', '-e', '-t', sessionName,
        ';',
        'send-keys', '-t', sessionName, '-X', '-N', String(lines), action,
    ]), () => {})
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

function closeWithRelayMessage(ws: WebSocket, payload: string, code: number): void {
    sendData(ws, payload)
    sendExit(ws, code)
    ws.close()
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

function parseWsMessage(raw: Buffer | ArrayBuffer | Buffer[]): unknown | null {
    const text: string = Buffer.isBuffer(raw)
        ? raw.toString()
        : Array.isArray(raw)
            ? Buffer.concat(raw).toString()
            : Buffer.from(raw).toString()
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

async function prepareExistingTmuxSession(
    ws: WebSocket,
    logger: TmuxRelayLogger,
    sessionName: string
): Promise<boolean> {
    try {
        if (await hasSession(sessionName)) return true
        logger.info(`[tmux-relay] ${sessionName}: session not found, closing client`)
        closeWithRelayMessage(ws, '[session ended — agent exited]\r\n', 0)
        return false
    } catch (error) {
        const message: string = errorMessage(error)
        logger.warn(`[tmux-relay] ${sessionName}: hasSession check failed: ${message}`)
        closeWithRelayMessage(ws, `tmux session check failed: ${message}\r\n`, 1)
        return false
    }
}

async function configureSessionForRelay(
    ws: WebSocket,
    logger: TmuxRelayLogger,
    sessionName: string,
    options: TmuxAttachRelayOptions,
): Promise<boolean> {
    try {
        const tmuxMouseMode: boolean = options.getTmuxMouseMode ? await options.getTmuxMouseMode() : false
        configureTmuxSession(sessionName, tmuxMouseMode)
        return true
    } catch (error) {
        const message: string = errorMessage(error)
        logger.warn(`[tmux-relay] ${sessionName}: configureTmuxSession failed: ${message}`)
        closeWithRelayMessage(ws, `tmux session configuration failed: ${message}\r\n`, 1)
        return false
    }
}

async function loadPtyForRelay(
    ws: WebSocket,
    logger: TmuxRelayLogger,
    sessionName: string,
    loadPty: () => Promise<NodePtyModule>
): Promise<NodePtyModule | null> {
    try {
        return await loadPty()
    } catch (error) {
        const message: string = errorMessage(error)
        logger.warn(`[tmux-relay] ${sessionName}: node-pty load failed: ${message}`)
        closeWithRelayMessage(ws, `node-pty unavailable: ${message}\r\n`, 1)
        return null
    }
}

function attachEnvironment(options: TmuxAttachRelayOptions): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.env,
        PATH: options.env?.PATH ?? process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: options.env?.HOME ?? process.env.HOME ?? process.cwd(),
        TERM: 'xterm-256color',
        LANG: options.env?.LANG ?? process.env.LANG ?? 'en_US.UTF-8',
    }
    delete env.npm_config_prefix
    return env
}

function spawnTmuxAttachPty(
    pty: NodePtyModule,
    ws: WebSocket,
    parsed: Exclude<ParsedAttachRequest, null>,
    sessionName: string,
    options: TmuxAttachRelayOptions
): IPty | null {
    try {
        return pty.spawn(getTmuxBinaryPath(), getTmuxCommandArgs(['attach', '-t', sessionName]), {
            name: 'xterm-256color',
            cols: parsed.cols,
            rows: parsed.rows,
            cwd: options.cwd ?? process.cwd(),
            env: attachEnvironment(options),
        })
    } catch (error) {
        closeWithRelayMessage(ws, `node-pty spawn failed: ${errorMessage(error)}\r\n`, 1)
        return null
    }
}

export async function attachTmuxSessionToWebSocket(
    ws: WebSocket,
    request: IncomingMessage,
    options: TmuxAttachRelayOptions = {}
): Promise<void> {
    const logger: TmuxRelayLogger = options.logger ?? defaultLogger
    const parsed: ParsedAttachRequest = parseAttachRequest(request)
    if (!parsed) {
        ws.close()
        return
    }
    const sessionName: string = resolveTmuxSessionName(parsed.sessionName)

    if (!(await prepareExistingTmuxSession(ws, logger, sessionName))) return
    if (!(await configureSessionForRelay(ws, logger, sessionName, options))) return
    logger.info(`[tmux-relay] ${sessionName}: attached cols=${parsed.cols} rows=${parsed.rows}`)

    const pty: NodePtyModule | null = await loadPtyForRelay(ws, logger, sessionName, options.loadPty ?? loadNodePty)
    if (!pty) return

    const term: IPty | null = spawnTmuxAttachPty(pty, ws, parsed, sessionName, options)
    if (!term) return

    const pendingWrites: string[] = []
    const writeState: {flushing: boolean} = {flushing: false}

    term.onData((payload: string): void => sendData(ws, payload))
    term.onExit(({exitCode}: {readonly exitCode: number}): void => {
        sendExit(ws, exitCode)
        ws.close()
    })

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
        const msg: unknown = parseWsMessage(raw)
        if (msg === null) {
            logger.warn(`[tmux-relay] ${sessionName}: dropped malformed WS frame`)
            return
        }
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
                // term.resize() issues TIOCSWINSZ on the pty master, which delivers SIGWINCH
                // to the tmux client (the foreground pgrp of the pty). The client then notifies
                // the server over its already-open fd, and tmux's `window-size=latest` policy
                // resizes the pane. This runs entirely through the existing tmux connection —
                // no fresh `tmux resize-pane` exec is required, which is critical for surviving
                // the macOS jetsam orphan-daemon split-brain scenario.
                term.resize(cols, rows)
            }
            return
        }

        if (record.type === 'scroll') {
            const lines: number = Number(record.lines)
            const direction: unknown = record.direction
            if (Number.isFinite(lines) && lines > 0 && (direction === 'up' || direction === 'down')) {
                execTmuxScroll(sessionName, direction, lines)
            }
        }
    })

    ws.on('close', (): void => {
        term.kill()
    })
}
