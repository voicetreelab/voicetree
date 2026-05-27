import {execFile, execFileSync, spawn} from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    rmSync,
    statSync,
} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {getRuntimeEnv} from '@vt/agent-runtime/runtime/runtime-config'

type ExecFileCallback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void

type TmuxCommandResult = {
    readonly stdout: string
    readonly stderr: string
}

type TmuxCommandError = Error & {
    readonly args: readonly string[]
    readonly file: string
    readonly stderr: string
    readonly stdout: string
}

interface TmuxServerLogger {
    readonly warn: (message: string) => void
}

export interface TmuxServerDeps {
    readonly env: NodeJS.ProcessEnv
    readonly platform: NodeJS.Platform
    readonly homedir: () => string
    readonly getuid: () => number
    readonly existsSync: typeof existsSync
    readonly mkdirSync: typeof mkdirSync
    readonly rmSync: typeof rmSync
    readonly statSync: (path: string) => {readonly mtimeMs: number}
    readonly execFileSync: typeof execFileSync
    readonly execFile: (file: string, args: readonly string[], callback: ExecFileCallback) => void
    readonly execFileDetached?: (file: string, args: readonly string[], callback: ExecFileCallback) => void
    readonly logger: TmuxServerLogger
    readonly now: () => number
    readonly sleep: (ms: number) => Promise<void>
}

const defaultDeps: TmuxServerDeps = {
    env: process.env,
    platform: process.platform,
    homedir,
    getuid: (): number => {
        if (typeof process.getuid === 'function') return process.getuid()
        throw new Error('Cannot remove legacy tmux LaunchAgent: process.getuid() is unavailable')
    },
    existsSync,
    mkdirSync,
    rmSync,
    statSync,
    execFileSync,
    execFile: (file: string, args: readonly string[], callback: ExecFileCallback): void => {
        execFile(file, [...args], {encoding: 'utf8'}, callback)
    },
    execFileDetached: (file: string, args: readonly string[], callback: ExecFileCallback): void => {
        const child = spawn(file, [...args], {detached: true, stdio: 'ignore'})
        let settled = false
        const finish = (error: Error | null, stderr: string = ''): void => {
            if (settled) return
            settled = true
            callback(error, '', stderr)
        }
        child.once('error', (error: Error) => finish(error, error.message))
        child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            if (code === 0) {
                finish(null)
                return
            }
            const reason: string = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
            finish(new Error(`${file} ${args.join(' ')} exited with ${reason}`), reason)
        })
    },
    logger: {
        warn: (message: string): void => console.warn(message),
    },
    now: Date.now,
    sleep: delay,
}

function resolveDeps(overrides: Partial<TmuxServerDeps> | undefined): TmuxServerDeps {
    const merged: TmuxServerDeps = {...defaultDeps, ...overrides}
    if (overrides?.execFile && !overrides.execFileDetached) {
        const {execFileDetached: _execFileDetached, ...depsWithoutDetachedBootstrap} = merged
        return depsWithoutDetachedBootstrap
    }
    return merged
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
    return env.VITEST === 'true' || env.NODE_ENV === 'test' || env.HEADLESS_TEST === '1'
}

function defaultAppSupportPath(deps: TmuxServerDeps): string {
    try {
        const fromRuntime: string | undefined = getRuntimeEnv().getAppSupportPath()?.trim()
        if (fromRuntime) return fromRuntime
    } catch {
        // Runtime env is not configured in low-level tests and direct package use.
    }

    const fromEnv: string | undefined = deps.env.VOICETREE_APP_SUPPORT?.trim()
    if (fromEnv) return fromEnv

    if (isTestRuntime(deps.env)) {
        return join(tmpdir(), `voicetree-agent-runtime-tmux-${process.pid}`)
    }

    const home: string = deps.homedir()
    if (deps.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', 'Voicetree')
    }
    if (deps.platform === 'win32') {
        return join(deps.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Voicetree')
    }
    return join(deps.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Voicetree')
}

function commandError(file: string, args: readonly string[], stdout: string, stderr: string, error: Error): TmuxCommandError {
    return Object.assign(
        new Error(`${file} ${args.join(' ')} failed: ${stderr.trim() || error.message}`),
        {args, file, stderr, stdout},
    )
}

function execFilePromise(deps: TmuxServerDeps, file: string, args: readonly string[]): Promise<TmuxCommandResult> {
    return new Promise<TmuxCommandResult>((resolve, reject) => {
        deps.execFile(file, args, (error: Error | null, stdout: string | Buffer, stderr: string | Buffer): void => {
            const stdoutText: string = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout
            const stderrText: string = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr
            if (!error) {
                resolve({stdout: stdoutText, stderr: stderrText})
                return
            }
            reject(commandError(file, args, stdoutText, stderrText, error))
        })
    })
}

function execDetachedFilePromise(deps: TmuxServerDeps, file: string, args: readonly string[]): Promise<TmuxCommandResult> {
    if (!deps.execFileDetached) return execFilePromise(deps, file, args)
    return new Promise<TmuxCommandResult>((resolve, reject) => {
        deps.execFileDetached?.(file, args, (error: Error | null, stdout: string | Buffer, stderr: string | Buffer): void => {
            const stdoutText: string = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout
            const stderrText: string = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr
            if (!error) {
                resolve({stdout: stdoutText, stderr: stderrText})
                return
            }
            reject(commandError(file, args, stdoutText, stderrText, error))
        })
    })
}

function resolveTmuxBinaryPath(deps: TmuxServerDeps): string {
    try {
        const whichOutput: string = deps.execFileSync('which', ['tmux'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }) as string
        const resolved: string = whichOutput.trim()
        if (resolved) return resolved
    } catch {
        // Fall through to common install locations.
    }

    const candidates: readonly string[] = [
        '/opt/homebrew/bin/tmux',
        '/usr/local/bin/tmux',
        '/usr/bin/tmux',
    ]
    return candidates.find((candidate: string) => deps.existsSync(candidate)) ?? 'tmux'
}

function tmuxErrorText(error: unknown): string {
    if (error instanceof Error) {
        const stderr: unknown = (error as Partial<TmuxCommandError>).stderr
        return `${error.message}\n${typeof stderr === 'string' ? stderr : ''}`
    }
    return String(error)
}

function isMissingOrStaleServerError(error: unknown): boolean {
    const text: string = tmuxErrorText(error)
    return text.includes('no server running')
        || text.includes('error connecting to')
        || text.includes('server exited unexpectedly')
        || text.includes('Connection refused')
        || text.includes('No such file or directory')
}

export function createTmuxServerCore() {
    return {
        defaultAppSupportPath,
        defaultDeps,
        execDetachedFilePromise,
        execFilePromise,
        isMissingOrStaleServerError,
        resolveDeps,
        resolveTmuxBinaryPath,
        tmuxErrorText,
    }
}
