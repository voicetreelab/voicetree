import {execFile, execFileSync} from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    rmSync,
    statSync,
} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {getRuntimeEnv} from '@vt/agent-runtime/runtime/runtime-config'

const LEGACY_LAUNCH_AGENT_LABEL: string = 'com.voicetree.tmux'
const LOCK_STALE_MS: number = 30_000
const LOCK_WAIT_MS: number = 5_000
const ROOT_SESSION: string = '__voicetree_root__'
const ROOT_SESSION_COMMAND: string = 'while :; do sleep 2147483647; done'
const SOCKET_NAME: string = 'tmux.sock'
const SOCKET_POLL_MS: number = 50

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

export interface TmuxServerLogger {
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
    readonly logger: TmuxServerLogger
    readonly now: () => number
    readonly sleep: (ms: number) => Promise<void>
}

export interface EnsureTmuxServerOptions {
    readonly appSupportPath?: string
    readonly cleanupLegacyLaunchAgent?: boolean
    readonly deps?: Partial<TmuxServerDeps>
    readonly socketPath?: string
    readonly tmuxBin?: string
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
    logger: {
        warn: (message: string): void => console.warn(message),
    },
    now: Date.now,
    sleep: delay,
}

let ensurePromise: Promise<void> | null = null
let legacyCleanupPromise: Promise<void> | null = null
let tmuxBinaryPathCache: string | null = null

function resolveDeps(overrides: Partial<TmuxServerDeps> | undefined): TmuxServerDeps {
    return {...defaultDeps, ...overrides}
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
    return env.VITEST === 'true' || env.NODE_ENV === 'test' || env.HEADLESS_TEST === '1'
}

function defaultAppSupportPath(deps: TmuxServerDeps): string {
    const fromEnv: string | undefined = deps.env.VOICETREE_APP_SUPPORT?.trim()
    if (fromEnv) return fromEnv

    try {
        const fromRuntime: string | undefined = getRuntimeEnv().getAppSupportPath()?.trim()
        if (fromRuntime) return fromRuntime
    } catch {
        // Runtime env is not configured in low-level tests and direct package use.
    }

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

function lockPath(appSupportPath: string): string {
    return join(appSupportPath, 'tmux.ensure.lock')
}

async function acquireEnsureLock(appSupportPath: string, deps: TmuxServerDeps): Promise<() => void> {
    const target: string = lockPath(appSupportPath)
    const started: number = deps.now()

    while (deps.now() - started < LOCK_WAIT_MS) {
        try {
            deps.mkdirSync(target)
            return (): void => {
                deps.rmSync(target, {force: true, recursive: true})
            }
        } catch (error) {
            const code: unknown = (error as NodeJS.ErrnoException).code
            if (code !== 'EEXIST') throw error

            const mtimeMs: number = deps.statSync(target).mtimeMs
            if (deps.now() - mtimeMs > LOCK_STALE_MS) {
                deps.logger.warn(`[tmux-server] removing stale ensure lock ${target}`)
                deps.rmSync(target, {force: true, recursive: true})
                continue
            }
            await deps.sleep(SOCKET_POLL_MS)
        }
    }

    throw new Error(`Timed out waiting for tmux ensure lock: ${target}`)
}

async function serverResponds(tmuxBin: string, socketPath: string, deps: TmuxServerDeps): Promise<boolean> {
    try {
        await execFilePromise(deps, tmuxBin, getTmuxCommandArgs(['list-sessions'], socketPath))
        return true
    } catch (error) {
        if (isMissingOrStaleServerError(error)) return false
        throw error
    }
}

async function startRootSession(tmuxBin: string, socketPath: string, deps: TmuxServerDeps): Promise<void> {
    await execFilePromise(deps, tmuxBin, getTmuxCommandArgs([
        'new-session',
        '-d',
        '-s',
        ROOT_SESSION,
        '--',
        'sh',
        '-c',
        ROOT_SESSION_COMMAND,
    ], socketPath))
}

async function verifyServer(tmuxBin: string, socketPath: string, deps: TmuxServerDeps): Promise<void> {
    if (await serverResponds(tmuxBin, socketPath, deps)) return
    throw new Error(`tmux server did not respond after ensure: ${socketPath}`)
}

async function startRootSessionWithStaleSocketRetry(tmuxBin: string, socketPath: string, deps: TmuxServerDeps): Promise<void> {
    try {
        await startRootSession(tmuxBin, socketPath, deps)
        await verifyServer(tmuxBin, socketPath, deps)
        await raiseServerPriority(tmuxBin, socketPath, deps)
        return
    } catch (error) {
        if (!deps.existsSync(socketPath) || !isMissingOrStaleServerError(error)) throw error
        deps.logger.warn(`[tmux-server] removing stale tmux socket ${socketPath}: ${tmuxErrorText(error).trim()}`)
        deps.rmSync(socketPath, {force: true})
    }

    await startRootSession(tmuxBin, socketPath, deps)
    await verifyServer(tmuxBin, socketPath, deps)
    await raiseServerPriority(tmuxBin, socketPath, deps)
}

// macOS jetsam reaps high-RSS background daemons under memory pressure. Because tmux
// daemonizes (severs our parent chain to the foreground Electron app), every agent
// pane below the server inherits a background priority band and becomes a target.
// `taskpolicy -c user-interactive` lifts the server's QoS class so the kernel treats
// it (and its descendants) as interactive work, surviving pressure-driven kills.
async function raiseServerPriority(tmuxBin: string, socketPath: string, deps: TmuxServerDeps): Promise<void> {
    if (deps.platform !== 'darwin') return

    let serverPid: string
    try {
        const result: TmuxCommandResult = await execFilePromise(
            deps,
            tmuxBin,
            getTmuxCommandArgs(['display-message', '-p', '#{pid}'], socketPath),
        )
        serverPid = result.stdout.trim()
    } catch (error) {
        deps.logger.warn(`[tmux-server] could not resolve server pid for priority raise: ${tmuxErrorText(error).trim()}`)
        return
    }

    if (!/^\d+$/.test(serverPid)) {
        deps.logger.warn(`[tmux-server] unexpected server pid output: "${serverPid}"`)
        return
    }

    try {
        await execFilePromise(deps, 'taskpolicy', ['-c', 'user-interactive', '-p', serverPid])
    } catch (error) {
        deps.logger.warn(`[tmux-server] taskpolicy raise failed for pid ${serverPid} (best-effort): ${tmuxErrorText(error).trim()}`)
    }
}

async function removeLegacyLaunchAgentOnce(deps: TmuxServerDeps): Promise<void> {
    if (deps.platform !== 'darwin') return

    const service: string = `gui/${deps.getuid()}/${LEGACY_LAUNCH_AGENT_LABEL}`
    await execFilePromise(deps, 'launchctl', ['bootout', service]).catch(() => undefined)
    deps.rmSync(join(deps.homedir(), 'Library', 'LaunchAgents', `${LEGACY_LAUNCH_AGENT_LABEL}.plist`), {force: true})
}

async function ensureLegacyLaunchAgentRemoved(options: EnsureTmuxServerOptions, deps: TmuxServerDeps): Promise<void> {
    if (options.cleanupLegacyLaunchAgent === false) return
    if (options.deps || options.appSupportPath || options.socketPath || options.tmuxBin) {
        await removeLegacyLaunchAgentOnce(deps)
        return
    }
    if (!legacyCleanupPromise) legacyCleanupPromise = removeLegacyLaunchAgentOnce(deps)
    await legacyCleanupPromise
}

async function ensureTmuxServerOnce(options: EnsureTmuxServerOptions): Promise<void> {
    const deps: TmuxServerDeps = resolveDeps(options.deps)
    const appSupportPath: string = options.appSupportPath ?? defaultAppSupportPath(deps)
    const socketPath: string = options.socketPath ?? getTmuxSocketPath(appSupportPath)
    const tmuxBin: string = options.tmuxBin ?? getTmuxBinaryPath(options.deps)

    deps.mkdirSync(appSupportPath, {recursive: true})
    deps.mkdirSync(dirname(socketPath), {recursive: true})
    await ensureLegacyLaunchAgentRemoved(options, deps)

    if (await serverResponds(tmuxBin, socketPath, deps)) return

    const release: () => void = await acquireEnsureLock(appSupportPath, deps)
    try {
        if (await serverResponds(tmuxBin, socketPath, deps)) return
        await startRootSessionWithStaleSocketRetry(tmuxBin, socketPath, deps)
    } finally {
        release()
    }
}

export function resetTmuxServerForTests(): void {
    ensurePromise = null
    legacyCleanupPromise = null
    tmuxBinaryPathCache = null
}

export function getTmuxBinaryPath(depsOverrides?: Partial<TmuxServerDeps>): string {
    if (depsOverrides) return resolveTmuxBinaryPath(resolveDeps(depsOverrides))
    if (!tmuxBinaryPathCache) tmuxBinaryPathCache = resolveTmuxBinaryPath(defaultDeps)
    return tmuxBinaryPathCache
}

export function getTmuxSocketPath(appSupportPath?: string): string {
    return join(appSupportPath ?? defaultAppSupportPath(defaultDeps), SOCKET_NAME)
}

export function getTmuxSocketArgs(socketPath: string = getTmuxSocketPath()): readonly [string, string] {
    return ['-S', socketPath]
}

export function getTmuxCommandArgs(args: readonly string[], socketPath: string = getTmuxSocketPath()): string[] {
    return [...getTmuxSocketArgs(socketPath), ...args]
}

export function ensureTmuxServer(options: EnsureTmuxServerOptions = {}): Promise<void> {
    if (options.deps || options.appSupportPath || options.socketPath || options.tmuxBin || options.cleanupLegacyLaunchAgent === false) {
        return ensureTmuxServerOnce(options)
    }
    if (!ensurePromise) {
        ensurePromise = ensureTmuxServerOnce(options).finally(() => {
            ensurePromise = null
        })
    }
    return ensurePromise
}
