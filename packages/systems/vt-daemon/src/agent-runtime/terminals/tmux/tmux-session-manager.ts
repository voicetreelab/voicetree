import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {appendFileSync, statSync} from 'node:fs'
import {shellQuote} from '../util/shellQuote.ts'
import {
    ensureTmuxServer,
    getTmuxBinaryPath,
    getTmuxCommandArgs,
} from './tmux-server.ts'
import {ensureTmuxAvailable} from './tmux-preflight.ts'

const tmuxSessionAliases: Map<string, string> = new Map()

type TmuxResult = {
    stdout: string
    stderr: string
}

export type TmuxListedSession = {
    readonly sessionName: string
    readonly createdAtSeconds: number
    readonly panePid: number
}

async function runTmux(args: string[]): Promise<TmuxResult> {
    await ensureTmuxServer()
    return new Promise((resolve, reject) => {
        const child = spawn(getTmuxBinaryPath(), getTmuxCommandArgs(args), {stdio: ['ignore', 'pipe', 'pipe']})
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
        child.on('error', reject)
        child.on('close', (code: number | null) => {
            const stdout: string = Buffer.concat(stdoutChunks).toString('utf8')
            const stderr: string = Buffer.concat(stderrChunks).toString('utf8')

            if (code === 0) {
                resolve({stdout, stderr})
                return
            }

            reject(new Error(`tmux ${getTmuxCommandArgs(args).join(' ')} failed with exit code ${code}: ${stderr.trim()}`))
        })
    })
}

function parsePid(output: string, sessionName: string): number {
    const pid: number = Number(output.trim())
    if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error(`tmux pane pid for ${sessionName} was not a positive integer: ${output.trim()}`)
    }
    return pid
}

function sanitizeTmuxName(name: string): string {
    const safe: string = name.replace(/[^A-Za-z0-9_.-]/g, '_')
    return safe.length > 80 ? safe.slice(-80) : safe
}

export function buildTmuxNamespaceHash(namespace: string): string {
    return createHash('sha1').update(namespace).digest('hex').slice(0, 10)
}

export function buildTmuxSessionName(name: string, env: Record<string, string> = {}): string {
    const namespace: string | undefined = env.VOICETREE_TMUX_NAMESPACE
        ?? env.VOICETREE_PROJECT_DIR
        ?? env.VOICETREE_VAULT_PATH
    if (!namespace) return name

    const hash: string = buildTmuxNamespaceHash(namespace)
    return `vt-${hash}-${sanitizeTmuxName(name)}`
}

export function registerTmuxSessionAlias(name: string, sessionName: string): void {
    tmuxSessionAliases.set(name, sessionName)
}

export function resolveTmuxSessionName(name: string): string {
    return tmuxSessionAliases.get(name) ?? name
}

export async function createSession(name: string, command: string, env: Record<string, string> = {}): Promise<{pid: number}> {
    await ensureTmuxAvailable()
    const sessionName: string = buildTmuxSessionName(name, env)
    registerTmuxSessionAlias(name, sessionName)
    const envArgs: string[] = Object.entries(env).flatMap(([key, value]: [string, string]) => ['-e', `${key}=${value}`])
    await runTmux(['new-session', '-d', '-s', sessionName, ...envArgs, command])
    const pid: number = await getPanePid(name)
    return {pid}
}

export async function killSession(name: string): Promise<void> {
    const sessionName: string = resolveTmuxSessionName(name)
    try {
        await runTmux(['kill-session', '-t', sessionName])
    } catch (error) {
        if (!(await hasSession(name))) return
        throw error
    }
}

export async function hasSession(name: string): Promise<boolean> {
    await ensureTmuxServer()
    const sessionName: string = resolveTmuxSessionName(name)
    return new Promise((resolve, reject) => {
        const child = spawn(getTmuxBinaryPath(), getTmuxCommandArgs(['has-session', '-t', sessionName]), {stdio: ['ignore', 'ignore', 'pipe']})
        const stderrChunks: Buffer[] = []

        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
        child.on('error', reject)
        child.on('close', (code: number | null) => {
            if (code === 0) {
                resolve(true)
                return
            }
            if (code === 1) {
                resolve(false)
                return
            }

            const stderr: string = Buffer.concat(stderrChunks).toString('utf8').trim()
            reject(new Error(`tmux has-session ${sessionName} failed with exit code ${code}: ${stderr}`))
        })
    })
}

// tmux 3.6a on macOS strips literal tab characters from -F output and replaces
// them with '_', so any tab-separated format silently collapses fields into one
// unparsable string. '|' is safe because sanitizeTmuxName rejects it from
// session names.
const LIST_SESSIONS_SEPARATOR: string = '|'
const LIST_SESSIONS_FORMAT: string = `#{session_name}${LIST_SESSIONS_SEPARATOR}#{session_created}${LIST_SESSIONS_SEPARATOR}#{pane_pid}`

export async function listSessions(): Promise<readonly TmuxListedSession[]> {
    try {
        const result: TmuxResult = await runTmux([
            'list-sessions',
            '-F',
            LIST_SESSIONS_FORMAT,
        ])
        return result.stdout
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0)
            .map((line: string): TmuxListedSession => {
                const [sessionName, createdRaw, panePidRaw] = line.split(LIST_SESSIONS_SEPARATOR)
                const createdAtSeconds: number = Number(createdRaw)
                const panePid: number = Number(panePidRaw)
                if (!sessionName || !Number.isFinite(createdAtSeconds) || !Number.isInteger(panePid)) {
                    throw new Error(`Unexpected tmux list-sessions output: ${line}`)
                }
                return {sessionName, createdAtSeconds, panePid}
            })
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        if (message.includes('no server running') || message.includes('no sessions')) return []
        throw error
    }
}

export async function getSessionEnvironment(name: string): Promise<Record<string, string>> {
    const sessionName: string = resolveTmuxSessionName(name)
    const result: TmuxResult = await runTmux(['show-environment', '-t', sessionName])
    const env: Record<string, string> = {}
    for (const line of result.stdout.split('\n')) {
        if (!line || line.startsWith('-')) continue
        const equalsIndex: number = line.indexOf('=')
        if (equalsIndex <= 0) continue
        env[line.slice(0, equalsIndex)] = line.slice(equalsIndex + 1)
    }
    return env
}

// Write raw bytes to the pane's pty. -l (literal) bypasses tmux's key-name
// table so every byte — including control bytes (\x1b, \x15, \r) and the
// bracketed-paste markers (\x1b[200~ / \x1b[201~) — reaches the TUI verbatim.
// Use this when reproducing a byte-level input ceremony (see
// inject/send-text-to-terminal.ts).
export async function sendKeysLiteral(name: string, text: string): Promise<void> {
    const sessionName: string = resolveTmuxSessionName(name)
    await runTmux(['send-keys', '-t', sessionName, '-l', '--', text])
}

// Literal text followed by a plain Enter. Suitable for typing a single shell
// command into a `bash`-rooted pane (see tmuxPromptFile.injectAgentCommandHeadful).
// NOT suitable for injecting input into a TUI's chat field — use
// sendTextToTerminal for that, which performs the vi-mode + bracketed-paste +
// dual-submit ceremony required by claude / codex / gemini.
export async function sendKeys(name: string, text: string): Promise<void> {
    const sessionName: string = resolveTmuxSessionName(name)
    await runTmux(['send-keys', '-t', sessionName, '-l', '--', text])
    await runTmux(['send-keys', '-t', sessionName, 'Enter'])
}

export async function getPanePid(name: string): Promise<number> {
    const sessionName: string = resolveTmuxSessionName(name)
    const result: TmuxResult = await runTmux(['display-message', '-t', sessionName, '-p', '#{pane_pid}'])
    return parsePid(result.stdout, name)
}

export async function pipePaneToFile(name: string, logPath: string): Promise<void> {
    const sessionName: string = resolveTmuxSessionName(name)
    await runTmux(['pipe-pane', '-t', sessionName, `cat >> ${shellQuote(logPath)}`])
    const bufferName: string = `vt-backfill-${createHash('sha1').update(`${sessionName}:${logPath}`).digest('hex').slice(0, 12)}`
    const backfillCommand: string = [
        `capture-pane -b ${bufferName} -J -S - -t ${sessionName}`,
        `save-buffer -a -b ${bufferName} ${shellQuote(logPath)}`,
        `delete-buffer -b ${bufferName}`,
    ].join(' ; ')
    await runTmux([
        'if-shell',
        `test -s ${shellQuote(logPath)}`,
        'display-message "voicetree log backfill skipped"',
        backfillCommand,
    ])
}
