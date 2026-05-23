import {join} from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'
import {
    ensureTmuxServer,
    getTmuxCommandArgs,
    getTmuxSocketPath,
    resetTmuxServerForTests,
    type TmuxServerDeps,
} from '../tmux/tmux-server.ts'

type FakeCall = {
    readonly args: readonly string[]
    readonly file: string
}

type FakeState = {
    readonly platform?: NodeJS.Platform
    failNextStart: boolean
    lockExists: boolean
    lockMtimeMs: number
    now: number
    serverRunning: boolean
    socketExists: boolean
}

function errno(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(code), {code})
}

function makeDeps(state: Partial<FakeState> = {}): TmuxServerDeps & {
    readonly calls: FakeCall[]
    readonly removedPaths: string[]
    readonly warnLogs: string[]
} {
    const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
    const socketPath: string = join(appSupportPath, 'tmux.sock')
    const lockPath: string = join(appSupportPath, 'tmux.ensure.lock')
    const calls: FakeCall[] = []
    const removedPaths: string[] = []
    const warnLogs: string[] = []
    const mutable: FakeState = {
        failNextStart: false,
        lockExists: false,
        lockMtimeMs: 0,
        now: 1_000,
        platform: 'linux',
        serverRunning: false,
        socketExists: false,
        ...state,
    }

    const deps: TmuxServerDeps & {calls: FakeCall[], removedPaths: string[], warnLogs: string[]} = {
        calls,
        removedPaths,
        warnLogs,
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
            if (file === 'taskpolicy') {
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
            if (command === 'display-message') {
                callback(null, '12345\n', '')
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
    beforeEach(() => {
        resetTmuxServerForTests()
    })

    it('builds socket-scoped tmux args from the app support path', () => {
        const appSupportPath: string = '/tmp/vt support'
        expect(getTmuxSocketPath(appSupportPath)).toBe('/tmp/vt support/tmux.sock')
        expect(getTmuxCommandArgs(['list-sessions'], getTmuxSocketPath(appSupportPath))).toEqual([
            '-S',
            '/tmp/vt support/tmux.sock',
            'list-sessions',
        ])
    })

    it('starts a root session when the socket-scoped tmux server is missing', async () => {
        const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(appSupportPath, 'tmux.sock')
        const deps = makeDeps()

        await ensureTmuxServer({appSupportPath, deps, cleanupLegacyLaunchAgent: false})
        await ensureTmuxServer({appSupportPath, deps, cleanupLegacyLaunchAgent: false})

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

    it('removes a stale socket and retries root session startup once', async () => {
        const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(appSupportPath, 'tmux.sock')
        const deps = makeDeps({failNextStart: true, socketExists: true})

        await ensureTmuxServer({appSupportPath, deps, cleanupLegacyLaunchAgent: false})

        expect(deps.removedPaths).toContain(socketPath)
        expect(commandTuples(deps.calls).filter((call: readonly string[]) => call[3] === 'new-session')).toHaveLength(2)
        expect(deps.warnLogs[0]).toContain('[tmux-server] removing stale tmux socket')
    })

    it('raises tmux server jetsam priority on darwin after starting it', async () => {
        const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
        const socketPath: string = join(appSupportPath, 'tmux.sock')
        const deps = makeDeps({platform: 'darwin'})

        await ensureTmuxServer({appSupportPath, deps, cleanupLegacyLaunchAgent: false})

        const tuples: readonly string[][] = commandTuples(deps.calls)
        expect(tuples).toContainEqual([
            '/opt/homebrew/bin/tmux',
            '-S',
            socketPath,
            'display-message',
            '-p',
            '#{pid}',
        ])
        expect(tuples).toContainEqual(['taskpolicy', '-c', 'user-interactive', '-p', '12345'])
        // priority raise must follow the start, not precede it
        const startIdx: number = tuples.findIndex((call: readonly string[]) => call.includes('new-session'))
        const policyIdx: number = tuples.findIndex((call: readonly string[]) => call[0] === 'taskpolicy')
        expect(startIdx).toBeGreaterThanOrEqual(0)
        expect(policyIdx).toBeGreaterThan(startIdx)
    })

    it('still completes server start when taskpolicy raise fails (best-effort)', async () => {
        const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
        const deps = makeDeps({platform: 'darwin'})
        const originalExecFile = deps.execFile
        ;(deps as {execFile: typeof originalExecFile}).execFile = (file, args, callback): void => {
            if (file === 'taskpolicy') {
                callback(new Error('not permitted'), '', 'not permitted')
                return
            }
            originalExecFile(file, args, callback)
        }

        await expect(
            ensureTmuxServer({appSupportPath, deps, cleanupLegacyLaunchAgent: false}),
        ).resolves.toBeUndefined()
        expect(deps.warnLogs.some((line: string) => line.includes('taskpolicy raise failed'))).toBe(true)
    })

    it('removes the legacy macOS LaunchAgent instead of bootstrapping it', async () => {
        const appSupportPath: string = '/Users/test/Library/Application Support/Voicetree'
        const deps = makeDeps({platform: 'darwin', serverRunning: true, socketExists: true})

        await ensureTmuxServer({appSupportPath, deps})

        expect(commandTuples(deps.calls)).toContainEqual([
            'launchctl',
            'bootout',
            'gui/501/com.voicetree.tmux',
        ])
        expect(commandTuples(deps.calls).some((call: readonly string[]) => call.includes('bootstrap'))).toBe(false)
        expect(deps.removedPaths).toContain('/Users/test/Library/LaunchAgents/com.voicetree.tmux.plist')
    })
})
