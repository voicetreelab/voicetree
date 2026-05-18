import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {shellQuote} from '../util/shellQuote.ts'
import {ensureTmuxAvailable} from './tmux-preflight.ts'

const TMUX: string = 'tmux'
const tmuxSessionAliases: Map<string, string> = new Map()

type TmuxResult = {
    stdout: string
    stderr: string
}

function runTmux(args: string[]): Promise<TmuxResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(TMUX, args, {stdio: ['ignore', 'pipe', 'pipe']})
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

            reject(new Error(`tmux ${args.join(' ')} failed with exit code ${code}: ${stderr.trim()}`))
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

export function buildTmuxSessionName(name: string, env: Record<string, string> = {}): string {
    const namespace: string | undefined = env.VOICETREE_TMUX_NAMESPACE
        ?? env.VOICETREE_PROJECT_DIR
        ?? env.VOICETREE_VAULT_PATH
    if (!namespace) return name

    const hash: string = createHash('sha1').update(namespace).digest('hex').slice(0, 10)
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
    const sessionName: string = resolveTmuxSessionName(name)
    return new Promise((resolve, reject) => {
        const child = spawn(TMUX, ['has-session', '-t', sessionName], {stdio: ['ignore', 'ignore', 'pipe']})
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
}
