import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {reapStaleEphemeralTmuxServers, teardownEphemeralTmuxServerForThisProcess} from '../../tmux/tmux-server.ts'
import type {TmuxServerDeps} from '../../tmux/tmux-server-core.ts'

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

const TMPDIR: string = '/tmp'
const TMUX_BIN: string = '/usr/bin/tmux'

function homeDir(pid: number): string {
    return join(TMPDIR, `voicetree-agent-runtime-tmux-${pid}`)
}

function socketOf(pid: number): string {
    return join(homeDir(pid), 'tmux.sock')
}

// A reaper fake modelling a tmpdir full of ephemeral tmux homes. `entries` are the
// raw directory names; `alivePids` decides which owning processes still exist;
// `liveServerSockets` are the sockets that still answer `list-sessions` (orphaned
// servers whose owner is gone but whose detached daemon lives on).
function makeReaperDeps(state: {
    readonly entries: readonly string[]
    readonly alivePids: ReadonlySet<number>
    readonly liveServerSockets: ReadonlySet<string>
}): Partial<TmuxServerDeps> & {
    readonly killedServerSockets: string[]
    readonly removedPaths: string[]
} {
    const killedServerSockets: string[] = []
    const removedPaths: string[] = []
    const liveSockets: Set<string> = new Set<string>(state.liveServerSockets)

    return {
        killedServerSockets,
        removedPaths,
        tmpdir: (): string => TMPDIR,
        readdirSync: (path: string): readonly string[] => {
            if (path !== TMPDIR) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
            return state.entries
        },
        processAlive: (pid: number): boolean => state.alivePids.has(pid),
        existsSync: (path: string): boolean => path === TMUX_BIN || liveSockets.has(path),
        rmSync: (path: string): void => {
            removedPaths.push(path)
            liveSockets.delete(path)
        },
        execFileSync: (file: string, args?: readonly string[]): string => {
            if (file === 'which' && args?.[0] === 'tmux') return `${TMUX_BIN}\n`
            return ''
        },
        execFile: (file: string, args: readonly string[], callback: ExecFileCallback): void => {
            if (file !== TMUX_BIN) {
                callback(new Error(`unexpected command: ${file}`), '', '')
                return
            }
            const socketPath: string = args[1]
            const command: string = args[2]
            if (command === 'list-sessions') {
                if (liveSockets.has(socketPath)) {
                    callback(null, '__voicetree_root__: 1 windows\n', '')
                    return
                }
                callback(new Error('no server running'), '', `no server running on ${socketPath}`)
                return
            }
            if (command === 'kill-server') {
                killedServerSockets.push(socketPath)
                liveSockets.delete(socketPath)
                callback(null, '', '')
                return
            }
            callback(new Error(`unexpected tmux args: ${args.join(' ')}`), '', '')
        },
        logger: {warn: (): void => undefined},
    }
}

describe('reapStaleEphemeralTmuxServers', () => {
    it('kills the orphaned server and removes the home dir of a dead-owner ephemeral home', async () => {
        const deps = makeReaperDeps({
            entries: [`voicetree-agent-runtime-tmux-111`],
            alivePids: new Set<number>(),
            liveServerSockets: new Set<string>([socketOf(111)]),
        })

        const reaped = await reapStaleEphemeralTmuxServers({deps})

        expect(reaped).toEqual([{homeDir: homeDir(111), ownerPid: 111}])
        expect(deps.killedServerSockets).toEqual([socketOf(111)])
        expect(deps.removedPaths).toContain(socketOf(111))
        expect(deps.removedPaths).toContain(homeDir(111))
    })

    it('leaves an ephemeral home whose owning process is still alive untouched', async () => {
        const deps = makeReaperDeps({
            entries: [`voicetree-agent-runtime-tmux-222`],
            alivePids: new Set<number>([222]),
            liveServerSockets: new Set<string>([socketOf(222)]),
        })

        const reaped = await reapStaleEphemeralTmuxServers({deps})

        expect(reaped).toEqual([])
        expect(deps.killedServerSockets).toEqual([])
        expect(deps.removedPaths).toEqual([])
    })

    it('reaps only dead-owner homes and ignores non-ephemeral entries', async () => {
        const deps = makeReaperDeps({
            entries: [
                `voicetree-agent-runtime-tmux-111`,   // dead owner -> reap
                `voicetree-agent-runtime-tmux-222`,   // alive owner -> keep
                `voicetree-agent-runtime-tmux-abc`,   // malformed pid -> ignore
                `some-other-temp-dir`,                // unrelated -> ignore
            ],
            alivePids: new Set<number>([222]),
            liveServerSockets: new Set<string>([socketOf(111), socketOf(222)]),
        })

        const reaped = await reapStaleEphemeralTmuxServers({deps})

        expect(reaped).toEqual([{homeDir: homeDir(111), ownerPid: 111}])
        expect(deps.killedServerSockets).toEqual([socketOf(111)])
        expect(deps.removedPaths).toContain(homeDir(111))
        expect(deps.removedPaths).not.toContain(homeDir(222))
    })

    it('returns nothing when the temp directory cannot be read', async () => {
        const deps: Partial<TmuxServerDeps> = {
            tmpdir: (): string => TMPDIR,
            readdirSync: (): readonly string[] => {
                throw Object.assign(new Error('EACCES'), {code: 'EACCES'})
            },
        }

        await expect(reapStaleEphemeralTmuxServers({deps})).resolves.toEqual([])
    })
})

// Teardown deps for a single home: tracks killed servers + removed paths. The
// socket is treated as a live server until kill-server.
function makeTeardownDeps(socketPath: string): Partial<TmuxServerDeps> & {
    readonly killedServerSockets: string[]
    readonly removedPaths: string[]
} {
    const killedServerSockets: string[] = []
    const removedPaths: string[] = []
    let serverLive: boolean = true

    return {
        killedServerSockets,
        removedPaths,
        tmpdir: (): string => TMPDIR,
        existsSync: (path: string): boolean => path === TMUX_BIN || (path === socketPath && serverLive),
        rmSync: (path: string): void => {
            removedPaths.push(path)
            if (path === socketPath) serverLive = false
        },
        execFileSync: (file: string, args?: readonly string[]): string =>
            (file === 'which' && args?.[0] === 'tmux' ? `${TMUX_BIN}\n` : ''),
        execFile: (file: string, args: readonly string[], callback: (e: Error | null, o: string, s: string) => void): void => {
            const command: string = args[2]
            if (command === 'list-sessions') {
                serverLive
                    ? callback(null, '__voicetree_root__: 1 windows\n', '')
                    : callback(new Error('no server running'), '', 'no server running')
                return
            }
            if (command === 'kill-server') {
                killedServerSockets.push(args[1])
                serverLive = false
                callback(null, '', '')
                return
            }
            callback(new Error(`unexpected tmux args: ${args.join(' ')}`), '', '')
        },
        logger: {warn: (): void => undefined},
    }
}

describe('teardownEphemeralTmuxServerForThisProcess', () => {
    it('kills the server and removes the whole home dir for an ephemeral test home', async () => {
        const home: string = join(TMPDIR, 'voicetree-agent-runtime-tmux-999')
        const socketPath: string = join(home, 'tmux.sock')
        const deps = makeTeardownDeps(socketPath)

        await teardownEphemeralTmuxServerForThisProcess({voicetreeHomePath: home, deps})

        expect(deps.killedServerSockets).toEqual([socketPath])
        expect(deps.removedPaths).toContain(socketPath)
        expect(deps.removedPaths).toContain(home)
    })

    it('kills the server but preserves the home dir for a real (non-ephemeral) home', async () => {
        const home: string = '/home/user/.voicetree'
        const socketPath: string = join(home, 'tmux.sock')
        const deps = makeTeardownDeps(socketPath)

        await teardownEphemeralTmuxServerForThisProcess({voicetreeHomePath: home, deps})

        expect(deps.killedServerSockets).toEqual([socketPath])
        expect(deps.removedPaths).toContain(socketPath)
        expect(deps.removedPaths).not.toContain(home)
    })
})
