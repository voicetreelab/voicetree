import {type ExecFileSyncOptionsWithStringEncoding, execFile, execFileSync, spawn} from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
    statSync,
} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {basename, dirname, join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {getVoicetreeHomePath, VOICETREE_HOME_PATH_ENV} from '@vt/paths'

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
    // Narrowed to the string-path surface this module actually uses (like
    // `statSync`/`execFile` below) so test doubles are typeable. The real
    // `node:fs` functions remain assignable — they accept wider `PathLike`.
    readonly existsSync: (path: string) => boolean
    readonly mkdirSync: (path: string, options?: {readonly recursive?: boolean}) => void
    readonly readdirSync: (path: string) => readonly string[]
    readonly rmSync: (path: string, options?: {readonly force?: boolean; readonly recursive?: boolean}) => void
    readonly statSync: (path: string) => {readonly mtimeMs: number}
    // Temp directory under which ephemeral test-runtime tmux homes live (see
    // `ephemeralTestHomeDir`). The reaper scans this directory.
    readonly tmpdir: () => string
    // True iff a process with this pid currently exists (alive, or alive-but-not-ours).
    // Used by the reaper to decide whether an ephemeral home's owning test process
    // is gone, leaving its detached tmux server orphaned.
    readonly processAlive: (pid: number) => boolean
    readonly execFileSync: (file: string, args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding) => string
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
    readdirSync,
    rmSync,
    statSync,
    tmpdir,
    processAlive: (pid: number): boolean => {
        try {
            process.kill(pid, 0)
            return true
        } catch (error) {
            // ESRCH => no such process (dead). EPERM => exists but not signalable by us (alive).
            return (error as NodeJS.ErrnoException).code === 'EPERM'
        }
    },
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

// Test runs must not touch the user's real ~/.voicetree tmux server, so each test
// process gets its own ephemeral home keyed by pid. The pid in the directory name
// is the load-bearing signal the reaper uses to detect orphans: when that process
// is gone, its detached tmux server is leaked (the server daemonizes and survives
// its creator — see execFileDetached). Keep this prefix in sync with the reaper's
// matcher; both go through `ephemeralTestHomeDir` / `parseEphemeralHomeOwnerPid`.
const EPHEMERAL_TEST_HOME_PREFIX: string = 'voicetree-agent-runtime-tmux-'

function ephemeralTestHomeDir(deps: TmuxServerDeps, pid: number): string {
    return join(deps.tmpdir(), `${EPHEMERAL_TEST_HOME_PREFIX}${pid}`)
}

// Inverse of `ephemeralTestHomeDir`'s naming: extract the owning pid from a temp
// directory entry name, or null if it does not match the ephemeral-home shape.
function parseEphemeralHomeOwnerPid(entryName: string): number | null {
    if (!entryName.startsWith(EPHEMERAL_TEST_HOME_PREFIX)) return null
    const suffix: string = entryName.slice(EPHEMERAL_TEST_HOME_PREFIX.length)
    if (!/^\d+$/.test(suffix)) return null
    const pid: number = Number(suffix)
    return Number.isInteger(pid) && pid > 0 ? pid : null
}

// True iff `homePath` is an ephemeral per-process test home (a direct child of
// tmpdir named by the ephemeral prefix + pid), as opposed to the real
// ~/.voicetree home. Gates destructive whole-dir removal so production teardown
// never recursively deletes the user's home.
function isEphemeralTestHome(deps: TmuxServerDeps, homePath: string): boolean {
    return dirname(homePath) === deps.tmpdir()
        && parseEphemeralHomeOwnerPid(basename(homePath)) !== null
}

function defaultVoicetreeHomePath(deps: TmuxServerDeps): string {
    const fromEnv: string | undefined = deps.env[VOICETREE_HOME_PATH_ENV]?.trim()
    if (fromEnv) return fromEnv

    if (isTestRuntime(deps.env)) {
        return ephemeralTestHomeDir(deps, process.pid)
    }

    return getVoicetreeHomePath({env: deps.env, homePath: deps.homedir()})
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
        defaultVoicetreeHomePath,
        defaultDeps,
        ephemeralTestHomeDir,
        execDetachedFilePromise,
        execFilePromise,
        isEphemeralTestHome,
        isMissingOrStaleServerError,
        parseEphemeralHomeOwnerPid,
        resolveDeps,
        resolveTmuxBinaryPath,
        tmuxErrorText,
    }
}
