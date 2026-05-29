import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
    ensureTmuxServer,
    getTmuxCommandArgs,
    getTmuxSocketPath,
    shutdownTmuxServer,
} from '../tmux/tmux-server.ts'
import type {TmuxServerDeps} from '../tmux/tmux-server-core.ts'

type FakeCall = {
    readonly args: readonly string[]
    readonly file: string
}

type FakeProcess = {
    readonly pid: number
    readonly comm: string
    readonly ppid: number
    readonly argvMentions: readonly string[]   // strings that appear in the process's argv (for pgrep -f)
    readonly childPids: readonly number[]
}

type FakeState = {
    readonly platform?: NodeJS.Platform
    failNextStart: boolean
    lockExists: boolean
    lockMtimeMs: number
    now: number
    serverRunning: boolean
    socketExists: boolean
    processes: FakeProcess[]
    killFailures: ReadonlySet<number>
}

function errno(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(code), {code})
}

function makeDeps(state: Partial<FakeState> = {}): TmuxServerDeps & {
    readonly calls: FakeCall[]
    readonly removedPaths: string[]
    readonly warnLogs: string[]
    readonly killedPids: number[]
    readonly processes: FakeProcess[]
} {
    const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
    const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
    const lockPath: string = join(voicetreeHomePath, 'tmux.ensure.lock')
    const calls: FakeCall[] = []
    const removedPaths: string[] = []
    const warnLogs: string[] = []
    const killedPids: number[] = []
    const mutable: FakeState = {
        failNextStart: false,
        lockExists: false,
        lockMtimeMs: 0,
        now: 1_000,
        platform: 'linux',
        serverRunning: false,
        socketExists: false,
        processes: [],
        killFailures: new Set<number>(),
        ...state,
    }

    const deps: TmuxServerDeps & {
        calls: FakeCall[],
        removedPaths: string[],
        warnLogs: string[],
        killedPids: number[],
        processes: FakeProcess[],
    } = {
        calls,
        removedPaths,
        warnLogs,
        killedPids,
        processes: mutable.processes,
        env: {},
        platform: mutable.platform ?? 'linux',
        homedir: () => '/Users/test',
        getuid: () => 501,
        existsSync: (path: string): boolean =>
            path === '/opt/homebrew/bin/tmux'
            || (path === socketPath && mutable.socketExists)
            || (path === lockPath && mutable.lockExists),
        mkdirSync: (path: string): string | undefined => {
            if (path === lockPath) {
                if (mutable.lockExists) throw errno('EEXIST')
                mutable.lockExists = true
                mutable.lockMtimeMs = mutable.now
            }
            return undefined
        },
        rmSync: (path: string): void => {
            removedPaths.push(path)
            if (path === socketPath) mutable.socketExists = false
            if (path === lockPath) mutable.lockExists = false
        },
        statSync: (path: string): {mtimeMs: number} => {
            if (path !== lockPath || !mutable.lockExists) throw errno('ENOENT')
            return {mtimeMs: mutable.lockMtimeMs}
        },
        execFileSync: (file: string, args?: readonly string[] | undefined): string => {
            if (file === 'which' && args?.[0] === 'tmux') return '/opt/homebrew/bin/tmux\n'
            return ''
        },
        execFile: (file: string, args: readonly string[], callback): void => {
            calls.push({file, args})
            if (file === 'launchctl') {
                callback(new Error('not loaded'), '', 'not loaded')
                return
            }
            if (file === 'pgrep') {
                // Two forms: `pgrep -f <pattern>` for argv match, `pgrep -P <ppid>` for children.
                if (args[0] === '-f' && typeof args[1] === 'string') {
                    const pattern: string = args[1]
                    // Pattern is `^.*tmux.*<escapedPath>`; we just match against argvMentions.
                    const target: string = pattern.replace(/^\^\.\*tmux\.\*/, '').replace(/\\(.)/g, '$1')
                    const matches: number[] = mutable.processes
                        .filter((proc: FakeProcess): boolean => proc.argvMentions.some((mention: string): boolean => mention.includes(target)))
                        .map((proc: FakeProcess): number => proc.pid)
                    if (matches.length === 0) {
                        callback(new Error('no matches'), '', '')
                        return
                    }
                    callback(null, `${matches.join('\n')}\n`, '')
                    return
                }
                if (args[0] === '-P' && typeof args[1] === 'string') {
                    const ppid: number = Number(args[1])
                    const proc: FakeProcess | undefined = mutable.processes.find((p: FakeProcess): boolean => p.pid === ppid)
                    if (!proc || proc.childPids.length === 0) {
                        callback(new Error('no matches'), '', '')
                        return
                    }
                    callback(null, `${proc.childPids.join('\n')}\n`, '')
                    return
                }
                callback(new Error(`unexpected pgrep args: ${args.join(' ')}`), '', '')
                return
            }
            if (file === 'ps') {
                // `ps -p <pid> -o ppid=,comm=`
                if (args[0] === '-p' && typeof args[1] === 'string' && args[2] === '-o' && args[3] === 'ppid=,comm=') {
                    const pid: number = Number(args[1])
                    const proc: FakeProcess | undefined = mutable.processes.find((p: FakeProcess): boolean => p.pid === pid)
                    if (!proc) {
                        callback(new Error('no such process'), '', '')
                        return
                    }
                    callback(null, `${proc.ppid} ${proc.comm}\n`, '')
                    return
                }
                callback(new Error(`unexpected ps args: ${args.join(' ')}`), '', '')
                return
            }
            if (file === 'kill') {
                const pidArg: string | undefined = args.find((arg: string): boolean => /^\d+$/.test(arg))
                const pid: number = Number(pidArg)
                if (mutable.killFailures.has(pid)) {
                    callback(new Error('operation not permitted'), '', 'operation not permitted')
                    return
                }
                killedPids.push(pid)
                mutable.processes = mutable.processes.filter((p: FakeProcess): boolean => p.pid !== pid)
                callback(null, '', '')
                return
            }
            if (file !== '/opt/homebrew/bin/tmux') {
                callback(new Error(`unexpected command: ${file}`), '', '')
                return
            }

            const command: string | undefined = args[2]
            if (command === 'list-sessions') {
                if (mutable.serverRunning) {
                    callback(null, '__voicetree_root__: 1 windows\n', '')
                    return
                }
                callback(new Error('no server running'), '', `no server running on ${socketPath}`)
                return
            }
            if (command === 'new-session') {
                if (mutable.failNextStart) {
                    mutable.failNextStart = false
                    mutable.socketExists = true
                    callback(new Error('server exited unexpectedly'), '', 'server exited unexpectedly')
                    return
                }
                mutable.serverRunning = true
                mutable.socketExists = true
                callback(null, '', '')
                return
            }
            if (command === 'kill-server') {
                mutable.serverRunning = false
                mutable.socketExists = false
                callback(null, '', '')
                return
            }
            callback(new Error(`unexpected tmux args: ${args.join(' ')}`), '', '')
        },
        logger: {
            warn: (message: string): void => {
                warnLogs.push(message)
            },
        },
        now: () => mutable.now,
        sleep: async (ms: number): Promise<void> => {
            mutable.now += ms
        },
    }
    return deps
}

function commandTuples(calls: readonly FakeCall[]): readonly string[][] {
    return calls.map((call: FakeCall): string[] => [call.file, ...call.args])
}

describe('tmux-server', () => {
    it('builds socket-scoped tmux args from the app support path', () => {
        const voicetreeHomePath: string = '/tmp/vt support'
        expect(getTmuxSocketPath(voicetreeHomePath)).toBe('/tmp/vt support/tmux.sock')
        expect(getTmuxCommandArgs(['list-sessions'], getTmuxSocketPath(voicetreeHomePath))).toEqual([
            '-S',
            '/tmp/vt support/tmux.sock',
            'list-sessions',
        ])
    })

    it('starts a root session when the socket-scoped tmux server is missing', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        const deps = makeDeps()

        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})
        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})

        expect(commandTuples(deps.calls)).toEqual([
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'list-sessions'],
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'list-sessions'],
            [
                '/opt/homebrew/bin/tmux',
                '-S',
                socketPath,
                'new-session',
                '-d',
                '-s',
                '__voicetree_root__',
                '--',
                'sh',
                '-c',
                'while :; do sleep 2147483647; done',
            ],
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'list-sessions'],
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'list-sessions'],
        ])
    })

    it('starts the root tmux server through the detached command path', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        const deps = makeDeps()
        const detachedCalls: FakeCall[] = []
        const execFile = deps.execFile
        ;(deps as {execFileDetached: NonNullable<TmuxServerDeps['execFileDetached']>}).execFileDetached = (file, args, callback): void => {
            detachedCalls.push({file, args})
            execFile(file, args, callback)
        }

        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})

        expect(commandTuples(detachedCalls)).toEqual([[
            '/opt/homebrew/bin/tmux',
            '-S',
            socketPath,
            'new-session',
            '-d',
            '-s',
            '__voicetree_root__',
            '--',
            'sh',
            '-c',
            'while :; do sleep 2147483647; done',
        ]])
    })

    it('removes a stale socket and retries root session startup once', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        const deps = makeDeps({failNextStart: true, socketExists: true})

        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})

        expect(deps.removedPaths).toContain(socketPath)
        expect(commandTuples(deps.calls).filter((call: readonly string[]) => call[3] === 'new-session')).toHaveLength(2)
        expect(deps.warnLogs.some((line: string) => line.includes('[tmux-server] removing stale tmux socket'))).toBe(true)
    })

    it('does not run unsupported post-start priority commands on darwin', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const deps = makeDeps({platform: 'darwin'})

        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})

        const tuples: readonly string[][] = commandTuples(deps.calls)
        expect(tuples.some((call: readonly string[]) => call[0] === 'taskpolicy')).toBe(false)
        expect(tuples.some((call: readonly string[]) => call.includes('display-message'))).toBe(false)
    })

    it('kills an orphan tmux daemon with no user sessions before unlinking a stale socket', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        // State 3: socket file exists, but the daemon bound to it has been orphaned
        // (listener gone, process still alive, only the __voicetree_root__ keep-alive).
        const orphanPid: number = 20810
        const deps = makeDeps({
            failNextStart: true,
            socketExists: true,
            processes: [{
                pid: orphanPid,
                comm: '/opt/homebrew/bin/tmux',
                ppid: 1,
                argvMentions: [socketPath],
                childPids: [99001], // exactly one shell → root keep-alive only, no user sessions
            }],
        })

        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})

        expect(deps.killedPids).toContain(orphanPid)
        expect(deps.removedPaths).toContain(socketPath)
        expect(deps.warnLogs.some((line: string) => line.includes(`killing orphan tmux daemon pid=${orphanPid}`))).toBe(true)
        expect(deps.warnLogs.some((line: string) => line.includes('scanning') && line.includes('orphan'))).toBe(true)
    })

    it('refuses to unlink the socket when an orphan daemon holds user agent sessions', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        const orphanPid: number = 20810
        const deps = makeDeps({
            failNextStart: true,
            socketExists: true,
            processes: [{
                pid: orphanPid,
                comm: '/opt/homebrew/bin/tmux',
                ppid: 1,
                argvMentions: [socketPath],
                // 1 root keep-alive + 4 user sessions
                childPids: [99001, 30001, 30002, 30003, 30004],
            }],
        })

        await expect(
            ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})
        ).rejects.toThrow(/orphan tmux daemon.*hold user agent sessions/)

        expect(deps.killedPids).not.toContain(orphanPid)   // do no harm — don't kill user sessions
        expect(deps.removedPaths).not.toContain(socketPath) // and don't unlink the socket
    })

    it('ignores tmux client processes when scanning for orphan daemons', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        // A `tmux attach` client (ppid != 1) mentioning the same socket path
        // must NOT be treated as an orphan daemon.
        const deps = makeDeps({
            failNextStart: true,
            socketExists: true,
            processes: [{
                pid: 16750,
                comm: '/opt/homebrew/bin/tmux',
                ppid: 91545,             // spawned by Electron main, not init
                argvMentions: [socketPath],
                childPids: [],
            }],
        })

        await ensureTmuxServer({voicetreeHomePath, deps, cleanupLegacyLaunchAgent: false})

        expect(deps.killedPids).toEqual([])
        expect(deps.removedPaths).toContain(socketPath)
        expect(deps.warnLogs.some((line: string) => line.includes('no orphan'))).toBe(true)
    })

    it('removes the legacy macOS LaunchAgent instead of bootstrapping it', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const deps = makeDeps({platform: 'darwin', serverRunning: true, socketExists: true})

        await ensureTmuxServer({voicetreeHomePath, deps})

        expect(commandTuples(deps.calls)).toContainEqual([
            'launchctl',
            'bootout',
            'gui/501/com.voicetree.tmux',
        ])
        expect(commandTuples(deps.calls).some((call: readonly string[]) => call.includes('bootstrap'))).toBe(false)
        expect(deps.removedPaths).toContain('/Users/test/Library/LaunchAgents/com.voicetree.tmux.plist')
    })

    it('shuts down the socket-scoped tmux server and removes its socket', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        const deps = makeDeps({serverRunning: true, socketExists: true})

        await shutdownTmuxServer({voicetreeHomePath, deps})

        expect(commandTuples(deps.calls)).toEqual([
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'list-sessions'],
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'kill-server'],
        ])
        expect(deps.removedPaths).toContain(socketPath)
    })

    it('treats a missing tmux server shutdown as a no-op', async () => {
        const voicetreeHomePath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(voicetreeHomePath, 'tmux.sock')
        const deps = makeDeps({serverRunning: false, socketExists: false})

        await shutdownTmuxServer({voicetreeHomePath, deps})

        expect(commandTuples(deps.calls)).toEqual([
            ['/opt/homebrew/bin/tmux', '-S', socketPath, 'list-sessions'],
        ])
        expect(deps.removedPaths).toEqual([])
    })
})
