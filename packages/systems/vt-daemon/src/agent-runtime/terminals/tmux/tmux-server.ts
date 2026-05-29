import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {createTmuxServerCore, type TmuxServerDeps} from './tmux-server-core.ts'

const tmuxServerCore = createTmuxServerCore()
const {
    defaultVoicetreeHomePath,
    defaultDeps,
    execDetachedFilePromise,
    execFilePromise,
    isMissingOrStaleServerError,
    resolveDeps,
    resolveTmuxBinaryPath,
    tmuxErrorText,
} = tmuxServerCore

type TmuxCommandResult = Awaited<ReturnType<typeof tmuxServerCore.execFilePromise>>

interface EnsureTmuxServerOptions {
    readonly voicetreeHomePath?: string
    readonly cleanupLegacyLaunchAgent?: boolean
    readonly deps?: Partial<TmuxServerDeps>
    readonly socketPath?: string
    readonly tmuxBin?: string
}

interface ShutdownTmuxServerOptions {
    readonly voicetreeHomePath?: string
    readonly deps?: Partial<TmuxServerDeps>
    readonly socketPath?: string
    readonly tmuxBin?: string
}

const LEGACY_LAUNCH_AGENT_LABEL: string = 'com.voicetree.tmux'
const LOCK_STALE_MS: number = 30_000
const LOCK_WAIT_MS: number = 5_000
const ROOT_SESSION: string = '__voicetree_root__'
const ROOT_SESSION_COMMAND: string = 'while :; do sleep 2147483647; done'
const SOCKET_NAME: string = 'tmux.sock'
const SOCKET_POLL_MS: number = 50

// AF_UNIX sun_path byte caps incl. NUL: darwin 104→103, linux 108→107.
const SOCKET_PATH_BYTE_LIMIT_DARWIN: number = 103
const SOCKET_PATH_BYTE_LIMIT_LINUX: number = 107
const SOCKET_FALLBACK_PREFIX: string = 'vt-'
const SOCKET_FALLBACK_HASH_HEX_LEN: number = 8

// An orphan tmux daemon is a server process that's alive (ppid=1) but whose
// listening socket file no longer routes to it — typically because the path was
// unlinked or replaced. New `connect()` calls cannot reach it; only its existing
// open client fds can. Sessions inside it are unreachable for new commands and
// will be leaked across app restarts unless we surface them explicitly.
interface OrphanTmuxDaemon {
    readonly pid: number
    readonly shellChildrenPids: readonly number[]
    readonly userSessionCount: number
}

let ensurePromise: Promise<void> | null = null
let legacyCleanupPromise: Promise<void> | null = null
let tmuxBinaryPathCache: string | null = null

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parsePidList(stdout: string): readonly number[] {
    return stdout
        .split('\n')
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line.length > 0)
        .map((line: string): number => Number(line))
        .filter((value: number): boolean => Number.isInteger(value) && value > 0)
}

async function pgrepByPattern(pattern: string, deps: TmuxServerDeps): Promise<readonly number[]> {
    try {
        const result: TmuxCommandResult = await execFilePromise(deps, 'pgrep', ['-f', pattern])
        return parsePidList(result.stdout)
    } catch {
        // pgrep returns non-zero when no matches; that's not an error for us.
        return []
    }
}

async function readPpidAndComm(pid: number, deps: TmuxServerDeps): Promise<{readonly ppid: number, readonly comm: string} | null> {
    try {
        const result: TmuxCommandResult = await execFilePromise(deps, 'ps', ['-p', String(pid), '-o', 'ppid=,comm='])
        const line: string = result.stdout.trim()
        if (!line) return null
        const firstSpace: number = line.search(/\s/)
        if (firstSpace < 0) return null
        const ppid: number = Number(line.slice(0, firstSpace).trim())
        const comm: string = line.slice(firstSpace).trim()
        if (!Number.isFinite(ppid)) return null
        return {ppid, comm}
    } catch {
        return null
    }
}

async function listChildPids(pid: number, deps: TmuxServerDeps): Promise<readonly number[]> {
    try {
        const result: TmuxCommandResult = await execFilePromise(deps, 'pgrep', ['-P', String(pid)])
        return parsePidList(result.stdout)
    } catch {
        return []
    }
}

// Look for tmux daemon processes that mention this socket path in their argv and
// have been reparented to init (ppid==1, i.e. daemonized). At call time this
// function assumes the socket path is unresponsive — any match is therefore an
// orphan, not the currently-live listener.
async function findOrphanTmuxDaemons(socketPath: string, deps: TmuxServerDeps): Promise<readonly OrphanTmuxDaemon[]> {
    const pattern: string = `^.*tmux.*${escapeRegex(socketPath)}`
    const candidates: readonly number[] = await pgrepByPattern(pattern, deps)
    const orphans: OrphanTmuxDaemon[] = []
    for (const pid of candidates) {
        const meta: {readonly ppid: number, readonly comm: string} | null = await readPpidAndComm(pid, deps)
        if (!meta) continue
        if (meta.ppid !== 1) continue
        if (!meta.comm.includes('tmux')) continue
        const shellChildrenPids: readonly number[] = await listChildPids(pid, deps)
        // The __voicetree_root__ keep-alive is one shell child. Anything beyond
        // it is a user session (each tmux session has at least one shell child
        // running directly under the server).
        const userSessionCount: number = Math.max(0, shellChildrenPids.length - 1)
        orphans.push({pid, shellChildrenPids, userSessionCount})
    }
    return orphans
}

function describeOrphans(orphans: readonly OrphanTmuxDaemon[]): string {
    return orphans
        .map((orphan: OrphanTmuxDaemon): string => `pid=${orphan.pid} shellChildren=${orphan.shellChildrenPids.length} userSessions=${orphan.userSessionCount}`)
        .join('; ')
}

async function killOrphan(pid: number, deps: TmuxServerDeps): Promise<void> {
    try {
        await execFilePromise(deps, 'kill', [String(pid)])
    } catch (error) {
        deps.logger.warn(`[tmux-server] kill ${pid} (SIGTERM) failed: ${tmuxErrorText(error).trim()}; trying SIGKILL`)
        try {
            await execFilePromise(deps, 'kill', ['-9', String(pid)])
        } catch (killError) {
            throw new Error(`failed to kill orphan tmux daemon pid=${pid}: ${tmuxErrorText(killError).trim()}`)
        }
    }
}

// Decide what to do with each orphan we find. Returns void on success (caller may
// proceed to unlink + bind a new server); throws with a diagnosable error if any
// orphan still holds user sessions.
async function reconcileOrphans(socketPath: string, deps: TmuxServerDeps): Promise<void> {
    deps.logger.warn(`[tmux-server] scanning ${socketPath} for orphan tmux daemons before reset`)
    const orphans: readonly OrphanTmuxDaemon[] = await findOrphanTmuxDaemons(socketPath, deps)
    if (orphans.length === 0) {
        deps.logger.warn(`[tmux-server] no orphan tmux daemons found on ${socketPath}; proceeding`)
        return
    }
    deps.logger.warn(`[tmux-server] found ${orphans.length} orphan tmux daemon(s) on ${socketPath}: ${describeOrphans(orphans)}`)

    const orphansWithUserSessions: readonly OrphanTmuxDaemon[] = orphans.filter((orphan: OrphanTmuxDaemon): boolean => orphan.userSessionCount > 0)
    if (orphansWithUserSessions.length > 0) {
        const killCmd: string = orphansWithUserSessions.map((orphan: OrphanTmuxDaemon): number => orphan.pid).join(' ')
        throw new Error(
            `Refusing to bind a new tmux server on ${socketPath}: `
            + `${orphansWithUserSessions.length} orphan tmux daemon(s) still hold user agent sessions `
            + `[${describeOrphans(orphansWithUserSessions)}]. `
            + `These sessions are unreachable for new commands but their processes are still alive; `
            + `restarting the app would silently leak them. `
            + `Inspect with: ps -p ${orphansWithUserSessions.map((orphan: OrphanTmuxDaemon): number => orphan.pid).join(',')} -o pid,lstart,command; `
            + `recover by killing manually (loses agent work): kill ${killCmd}`
        )
    }

    for (const orphan of orphans) {
        deps.logger.warn(`[tmux-server] killing orphan tmux daemon pid=${orphan.pid} (no user sessions)`)
        await killOrphan(orphan.pid, deps)
    }
}

function lockPath(voicetreeHomePath: string): string {
    return join(voicetreeHomePath, 'tmux.ensure.lock')
}

async function acquireEnsureLock(voicetreeHomePath: string, deps: TmuxServerDeps): Promise<() => void> {
    const target: string = lockPath(voicetreeHomePath)
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
    await execDetachedFilePromise(deps, tmuxBin, getTmuxCommandArgs([
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
        return
    } catch (error) {
        if (!deps.existsSync(socketPath) || !isMissingOrStaleServerError(error)) throw error
        // Before unlinking the socket and binding a new server, verify there is
        // no orphan daemon still alive on this path — otherwise we silently
        // create a split-brain where the orphan's sessions become unreachable.
        await reconcileOrphans(socketPath, deps)
        deps.logger.warn(`[tmux-server] removing stale tmux socket ${socketPath}: ${tmuxErrorText(error).trim()}`)
        deps.rmSync(socketPath, {force: true})
    }

    await startRootSession(tmuxBin, socketPath, deps)
    await verifyServer(tmuxBin, socketPath, deps)
}

async function removeLegacyLaunchAgentOnce(deps: TmuxServerDeps): Promise<void> {
    if (deps.platform !== 'darwin') return

    const service: string = `gui/${deps.getuid()}/${LEGACY_LAUNCH_AGENT_LABEL}`
    await execFilePromise(deps, 'launchctl', ['bootout', service]).catch(() => undefined)
    deps.rmSync(join(deps.homedir(), 'Library', 'LaunchAgents', `${LEGACY_LAUNCH_AGENT_LABEL}.plist`), {force: true})
}

async function ensureLegacyLaunchAgentRemoved(options: EnsureTmuxServerOptions, deps: TmuxServerDeps): Promise<void> {
    if (options.cleanupLegacyLaunchAgent === false) return
    if (options.deps || options.voicetreeHomePath || options.socketPath || options.tmuxBin) {
        await removeLegacyLaunchAgentOnce(deps)
        return
    }
    if (!legacyCleanupPromise) legacyCleanupPromise = removeLegacyLaunchAgentOnce(deps)
    await legacyCleanupPromise
}

async function ensureTmuxServerOnce(options: EnsureTmuxServerOptions): Promise<void> {
    const deps: TmuxServerDeps = resolveDeps(options.deps)
    const voicetreeHomePath: string = options.voicetreeHomePath ?? defaultVoicetreeHomePath(deps)
    const socketPath: string = options.socketPath ?? getTmuxSocketPath(voicetreeHomePath)
    const tmuxBin: string = options.tmuxBin ?? getTmuxBinaryPath(options.deps)

    deps.mkdirSync(voicetreeHomePath, {recursive: true})
    deps.mkdirSync(dirname(socketPath), {recursive: true})
    await ensureLegacyLaunchAgentRemoved(options, deps)

    if (await serverResponds(tmuxBin, socketPath, deps)) return

    const release: () => void = await acquireEnsureLock(voicetreeHomePath, deps)
    try {
        if (await serverResponds(tmuxBin, socketPath, deps)) return
        await startRootSessionWithStaleSocketRetry(tmuxBin, socketPath, deps)
    } finally {
        release()
    }
}

async function shutdownTmuxServerOnce(options: ShutdownTmuxServerOptions): Promise<void> {
    const deps: TmuxServerDeps = resolveDeps(options.deps)
    const voicetreeHomePath: string = options.voicetreeHomePath ?? defaultVoicetreeHomePath(deps)
    const socketPath: string = options.socketPath ?? getTmuxSocketPath(voicetreeHomePath)
    const tmuxBin: string = options.tmuxBin ?? getTmuxBinaryPath(options.deps)

    if (!(await serverResponds(tmuxBin, socketPath, deps))) return

    try {
        await execFilePromise(deps, tmuxBin, getTmuxCommandArgs(['kill-server'], socketPath))
    } catch (error) {
        if (!isMissingOrStaleServerError(error)) throw error
    } finally {
        deps.rmSync(socketPath, {force: true})
    }
}

export function getTmuxBinaryPath(depsOverrides?: Partial<TmuxServerDeps>): string {
    if (depsOverrides) return resolveTmuxBinaryPath(resolveDeps(depsOverrides))
    if (!tmuxBinaryPathCache) tmuxBinaryPathCache = resolveTmuxBinaryPath(defaultDeps)
    return tmuxBinaryPathCache
}

function platformSocketPathByteLimit(platform: NodeJS.Platform): number {
    if (platform === 'linux') return SOCKET_PATH_BYTE_LIMIT_LINUX
    return SOCKET_PATH_BYTE_LIMIT_DARWIN
}

function fallbackSocketPath(voicetreeHomePath: string): string {
    const hash: string = createHash('sha256').update(voicetreeHomePath).digest('hex').slice(0, SOCKET_FALLBACK_HASH_HEX_LEN)
    return join(tmpdir(), `${SOCKET_FALLBACK_PREFIX}${hash}.sock`)
}

// Fallback to short hashed path when natural exceeds AF_UNIX sun_path byte cap.
export function getTmuxSocketPath(voicetreeHomePath?: string): string {
    const resolved: string = voicetreeHomePath ?? defaultVoicetreeHomePath(defaultDeps)
    const natural: string = join(resolved, SOCKET_NAME)
    if (Buffer.byteLength(natural, 'utf8') <= platformSocketPathByteLimit(defaultDeps.platform)) {
        return natural
    }
    return fallbackSocketPath(resolved)
}

function getTmuxSocketArgs(socketPath: string = getTmuxSocketPath()): readonly [string, string] {
    return ['-S', socketPath]
}

export function getTmuxCommandArgs(args: readonly string[], socketPath: string = getTmuxSocketPath()): string[] {
    return [...getTmuxSocketArgs(socketPath), ...args]
}

export function ensureTmuxServer(options: EnsureTmuxServerOptions = {}): Promise<void> {
    if (options.deps || options.voicetreeHomePath || options.socketPath || options.tmuxBin || options.cleanupLegacyLaunchAgent === false) {
        return ensureTmuxServerOnce(options)
    }
    if (!ensurePromise) {
        ensurePromise = ensureTmuxServerOnce(options).finally(() => {
            ensurePromise = null
        })
    }
    return ensurePromise
}

export async function shutdownTmuxServer(options: ShutdownTmuxServerOptions = {}): Promise<void> {
    if (!options.deps && !options.voicetreeHomePath && !options.socketPath && !options.tmuxBin) {
        const inFlightEnsure: Promise<void> | null = ensurePromise
        ensurePromise = null
        if (inFlightEnsure) await inFlightEnsure.catch(() => undefined)
    }
    await shutdownTmuxServerOnce(options)
}
