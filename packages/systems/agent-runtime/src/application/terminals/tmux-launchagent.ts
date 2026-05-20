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
import {getRuntimeEnv} from '../runtime/runtime-config'

const LABEL: string = 'com.voicetree.tmux'
const ROOT_SESSION: string = '__voicetree_root__'
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
    readonly sleep: (ms: number) => Promise<void>
}

export interface EnsureTmuxLaunchAgentOptions {
    readonly appSupportPath?: string
    readonly deps?: Partial<TmuxLaunchAgentDeps>
    readonly forceInTests?: boolean
    readonly migrateLegacyDefaultSocketSessions?: boolean
    readonly plistPath?: string
    readonly socketPath?: string
    readonly tmuxBin?: string
}

export interface RenderPlistOptions {
    readonly label?: string
    readonly logDir?: string
    readonly socketPath: string
    readonly tmuxBin: string
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

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
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

function migrateLegacyDefaultSocketSessions(tmuxBin: string, deps: TmuxLaunchAgentDeps): void {
    let output: string
    try {
        output = deps.execFileSync(tmuxBin, ['list-sessions', '-F', '#S'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }) as string
    } catch {
        return
    }

    const voicetreeSessions: string[] = output
        .split('\n')
        .map((line: string) => line.trim())
        .filter((name: string) => /^vt-[a-f0-9]{10}-/.test(name))

    for (const sessionName of voicetreeSessions) {
        try {
            deps.execFileSync(tmuxBin, ['kill-session', '-t', sessionName], {stdio: 'ignore'})
        } catch {
            // Best-effort migration. A raced-away session is harmless.
        }
    }
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

export function renderPlist(options: RenderPlistOptions): string {
    const label: string = options.label ?? LABEL
    const logDir: string = options.logDir ?? dirname(options.socketPath)
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.tmuxBin)}</string>
    <string>-S</string><string>${escapeXml(options.socketPath)}</string>
    <string>-f</string><string>/dev/null</string>
    <string>new-session</string><string>-d</string>
    <string>-s</string><string>${escapeXml(ROOT_SESSION)}</string>
    <string>--</string><string>sleep</string><string>infinity</string>
  </array>
  <key>ProcessType</key><string>Interactive</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(join(logDir, 'tmux-server.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(logDir, 'tmux-server.err.log'))}</string>
</dict>
</plist>
`
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

    if (options.migrateLegacyDefaultSocketSessions) {
        migrateLegacyDefaultSocketSessions(tmuxBin, deps)
    }

    const loaded: boolean = await isLaunchAgentLoaded(deps)
    if (!plistMatches) {
        deps.writeFileSync(plistPath, plist, 'utf8')
        if (loaded) await bootoutLaunchAgent(deps)
        await bootstrapLaunchAgent(plistPath, deps)
    } else if (!loaded) {
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
        || options.migrateLegacyDefaultSocketSessions
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
