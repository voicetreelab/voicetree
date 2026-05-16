import {spawn} from 'node:child_process'
import {shellQuote} from '../util/shellQuote.ts'

const TMUX: string = 'tmux'

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

export async function createSession(name: string, command: string, env: Record<string, string> = {}): Promise<{pid: number}> {
    const envArgs: string[] = Object.entries(env).flatMap(([key, value]: [string, string]) => ['-e', `${key}=${value}`])
    await runTmux(['new-session', '-d', '-s', name, ...envArgs, command])
    const pid: number = await getPanePid(name)
    return {pid}
}

export async function killSession(name: string): Promise<void> {
    try {
        await runTmux(['kill-session', '-t', name])
    } catch (error) {
        if (!(await hasSession(name))) return
        throw error
    }
}

export async function hasSession(name: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const child = spawn(TMUX, ['has-session', '-t', name], {stdio: ['ignore', 'ignore', 'pipe']})
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
            reject(new Error(`tmux has-session ${name} failed with exit code ${code}: ${stderr}`))
        })
    })
}

export async function sendKeys(name: string, text: string): Promise<void> {
    await runTmux(['send-keys', '-t', name, '-l', '--', text])
    await runTmux(['send-keys', '-t', name, 'Enter'])
}

export async function getPanePid(name: string): Promise<number> {
    const result: TmuxResult = await runTmux(['display-message', '-t', name, '-p', '#{pane_pid}'])
    return parsePid(result.stdout, name)
}

export async function pipePaneToFile(name: string, logPath: string): Promise<void> {
    await runTmux(['pipe-pane', '-t', name, `cat >> ${shellQuote(logPath)}`])
}
