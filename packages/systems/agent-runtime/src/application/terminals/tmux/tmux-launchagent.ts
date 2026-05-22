import {execFile, execFileSync} from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {getRuntimeEnv} from '@vt/agent-runtime/runtime/runtime-config'
import {
    buildTmuxLaunchAgentDiagnostics,
    logTmuxLaunchAgentEvent,
    type TmuxLaunchAgentLogger,
} from './tmux-launchagent-diagnostics.ts'
import {
    renderPlist,
    TMUX_LAUNCH_AGENT_LABEL,
} from './tmux-launchagent-plist.ts'

export {renderPlist, type RenderPlistOptions} from './tmux-launchagent-plist.ts'

const LABEL: string = TMUX_LAUNCH_AGENT_LABEL
const SOCKET_NAME: string = 'tmux.sock'
const SOCKET_WAIT_MS: number = 3000
const SOCKET_POLL_MS: number = 50

type ExecFileCallback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void

export interface TmuxLaunchAgentDeps {
    readonly env: NodeJS.ProcessEnv
    readonly platform: NodeJS.Platform
    readonly homedir: () => string
    readonly getuid: () => number
    readonly existsSync: typeof existsSync
    readonly mkdirSync: typeof mkdirSync
    readonly readFileSync: typeof readFileSync
    readonly writeFileSync: typeof writeFileSync
    readonly rmSync: typeof rmSync
    readonly execFileSync: typeof execFileSync
    readonly execFile: (file: string, args: readonly string[], callback: ExecFileCallback) => void
    readonly logger: TmuxLaunchAgentLogger
    readonly sleep: (ms: number) => Promise<void>
}

export interface EnsureTmuxLaunchAgentOptions {
    readonly appSupportPath?: string
    readonly deps?: Partial<TmuxLaunchAgentDeps>
    readonly forceInTests?: boolean
    readonly plistPath?: string
    readonly socketPath?: string
    readonly tmuxBin?: string
}

const defaultDeps: TmuxLaunchAgentDeps = {
    env: process.env,
    platform: process.platform,
    homedir,
    getuid: (): number => {
        if (typeof process.getuid === 'function') return process.getuid()
        throw new Error('Cannot manage tmux LaunchAgent: process.getuid() is unavailable')
    },
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
    execFileSync,
    execFile: (file: string, args: readonly string[], callback: ExecFileCallback): void => {
        execFile(file, [...args], {encoding: 'utf8'}, callback)
    },
    logger: {
        error: (message: string): void => console.error(message),
        warn: (message: string): void => console.warn(message),
    },
    sleep: delay,
}

let tmuxBinaryPathCache: string | null = null
let ensurePromise: Promise<void> | null = null

function resolveDeps(overrides: Partial<TmuxLaunchAgentDeps> | undefined): TmuxLaunchAgentDeps {
    return {...defaultDeps, ...overrides}
}

function isTestRuntime(env: NodeJS.ProcessEnv): boolean {
    return env.VITEST === 'true' || env.NODE_ENV === 'test' || env.HEADLESS_TEST === '1'
}

function defaultAppSupportPath(deps: TmuxLaunchAgentDeps): string {
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

function readTextIfExists(path: string, deps: TmuxLaunchAgentDeps): string | null {
    try {
        return deps.readFileSync(path, 'utf8') as string
    } catch {
        return null
    }
}

function execFilePromise(deps: TmuxLaunchAgentDeps, file: string, args: readonly string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        deps.execFile(file, args, (error: Error | null, _stdout: string | Buffer, stderr: string | Buffer): void => {
            if (!error) {
                resolve()
                return
            }
            const stderrText: string = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr
            reject(new Error(`${file} ${args.join(' ')} failed: ${stderrText.trim() || error.message}`))
        })
    })
}

function launchctlTarget(deps: TmuxLaunchAgentDeps): string {
    return `gui/${deps.getuid()}`
}

function launchctlService(deps: TmuxLaunchAgentDeps): string {
    return `${launchctlTarget(deps)}/${LABEL}`
}

async function isLaunchAgentLoaded(deps: TmuxLaunchAgentDeps): Promise<boolean> {
    try {
        await execFilePromise(deps, 'launchctl', ['print', launchctlService(deps)])
        return true
    } catch {
        return false
    }
}

async function bootoutLaunchAgent(deps: TmuxLaunchAgentDeps): Promise<void> {
    try {
        await execFilePromise(deps, 'launchctl', ['bootout', launchctlService(deps)])
    } catch {
        // bootout fails when the service is not loaded; that is already the desired state.
    }
}

async function bootstrapLaunchAgent(plistPath: string, deps: TmuxLaunchAgentDeps): Promise<void> {
    await execFilePromise(deps, 'launchctl', ['bootstrap', launchctlTarget(deps), plistPath])
}

async function waitForSocket(socketPath: string, deps: TmuxLaunchAgentDeps): Promise<void> {
    const started: number = Date.now()
    while (Date.now() - started < SOCKET_WAIT_MS) {
        if (deps.existsSync(socketPath)) return
        await deps.sleep(SOCKET_POLL_MS)
    }
    throw new Error(`tmux LaunchAgent did not create socket within ${SOCKET_WAIT_MS}ms: ${socketPath}`)
}

function resolveTmuxBinaryPath(deps: TmuxLaunchAgentDeps): string {
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

export function resetTmuxLaunchAgentForTests(): void {
    tmuxBinaryPathCache = null
    ensurePromise = null
}

export function getTmuxBinaryPath(depsOverrides?: Partial<TmuxLaunchAgentDeps>): string {
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

export function getLaunchAgentPlistPath(home: string = defaultDeps.homedir()): string {
    return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

async function ensureTmuxLaunchAgentOnce(options: EnsureTmuxLaunchAgentOptions): Promise<void> {
    const deps: TmuxLaunchAgentDeps = resolveDeps(options.deps)
    const appSupportPath: string = options.appSupportPath ?? defaultAppSupportPath(deps)
    const socketPath: string = options.socketPath ?? getTmuxSocketPath(appSupportPath)
    const logDir: string = join(appSupportPath, 'logs')

    deps.mkdirSync(appSupportPath, {recursive: true})
    deps.mkdirSync(logDir, {recursive: true})
    deps.mkdirSync(dirname(socketPath), {recursive: true})

    if (deps.platform !== 'darwin' || (isTestRuntime(deps.env) && !options.forceInTests)) {
        return
    }

    const tmuxBin: string = options.tmuxBin ?? getTmuxBinaryPath(options.deps)
    const plistPath: string = options.plistPath ?? getLaunchAgentPlistPath(deps.homedir())
    const plist: string = renderPlist({tmuxBin, socketPath, logDir})
    const existingPlist: string | null = readTextIfExists(plistPath, deps)
    const plistMatches: boolean = existingPlist === plist

    deps.mkdirSync(dirname(plistPath), {recursive: true})

    const loaded: boolean = await isLaunchAgentLoaded(deps)
    if (!plistMatches) {
        const details: Record<string, unknown> = buildTmuxLaunchAgentDiagnostics({
            appSupportPath,
            existingPlist,
            launchAgentLoaded: loaded,
            logDir,
            plist,
            plistPath,
            socketPath,
            tmuxBin,
        })
        logTmuxLaunchAgentEvent(
            deps.logger,
            loaded ? 'error' : 'warn',
            loaded ? 'PLIST_MISMATCH_REWRITE_WILL_BOOTOUT' : 'PLIST_MISMATCH_REWRITE',
            details,
        )
        deps.writeFileSync(plistPath, plist, 'utf8')
        if (loaded) {
            logTmuxLaunchAgentEvent(deps.logger, 'error', 'BOOTOUT_LOADED_SERVICE', details)
            await bootoutLaunchAgent(deps)
        }
        logTmuxLaunchAgentEvent(deps.logger, 'warn', 'BOOTSTRAP_AFTER_PLIST_REWRITE', details)
        await bootstrapLaunchAgent(plistPath, deps)
    } else if (!loaded) {
        logTmuxLaunchAgentEvent(deps.logger, 'warn', 'BOOTSTRAP_MATCHING_UNLOADED_SERVICE', buildTmuxLaunchAgentDiagnostics({
            appSupportPath,
            existingPlist,
            launchAgentLoaded: loaded,
            logDir,
            plist,
            plistPath,
            socketPath,
            tmuxBin,
        }))
        await bootstrapLaunchAgent(plistPath, deps)
    }

    await waitForSocket(socketPath, deps)
}

export function ensureTmuxLaunchAgent(options: EnsureTmuxLaunchAgentOptions = {}): Promise<void> {
    if (
        options.deps
        || options.forceInTests
        || options.appSupportPath
        || options.socketPath
        || options.plistPath
        || options.tmuxBin
    ) {
        return ensureTmuxLaunchAgentOnce(options)
    }
    if (!ensurePromise) {
        ensurePromise = ensureTmuxLaunchAgentOnce(options).catch((error: Error) => {
            ensurePromise = null
            throw error
        })
    }
    return ensurePromise
}

export async function uninstallTmuxLaunchAgent(options: EnsureTmuxLaunchAgentOptions = {}): Promise<void> {
    const deps: TmuxLaunchAgentDeps = resolveDeps(options.deps)
    if (deps.platform !== 'darwin') return
    await bootoutLaunchAgent(deps)
    deps.rmSync(options.plistPath ?? getLaunchAgentPlistPath(deps.homedir()), {force: true})
    ensurePromise = null
}
