import {mkdir, mkdtemp, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest'
import {GraphDbClientError, type ProjectState, type SessionInfo} from '@vt/graph-db-client'
import {CliExitError, EXIT} from '../util/exitCodes'
import {
    runProjectCommand,
    type ConnectProjectDaemon,
    type ProjectDaemon,
} from './project.ts'
import {
    runSessionCommand,
    type ConnectSessionDaemon,
    type SessionDaemon,
} from './session.ts'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type CommandResult = {
    exitCode: number | null
    stdout: string
    stderr: string
}

// Capture the runner's observable side effects (stdout, stderr, exit code)
// while forcing a TTY so the human-readable formatter path is exercised — the
// `session show` field-name bug only manifests in human output, not the JSON
// dump. We assert on those observable outputs, never on internal calls.
async function captureCommand(invoke: () => Promise<void>): Promise<CommandResult> {
    const stdoutLines: string[] = []
    const stderrChunks: string[] = []
    const logSpy: MockInstance = vi
        .spyOn(console, 'log')
        .mockImplementation((...values: unknown[]): void => {
            stdoutLines.push(values.map((value: unknown): string => String(value)).join(' '))
        })
    const stderrSpy: MockInstance = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(((chunk: unknown) => {
            stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
            return true
        }) as typeof process.stderr.write)
    const exitSpy: MockInstance = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ExitCalled(code ?? 0)
    }) as typeof process.exit)
    const originalIsTty: boolean | undefined = process.stdout.isTTY
    process.stdout.isTTY = true

    let exitCode: number | null = null
    try {
        await invoke()
    } catch (err) {
        if (err instanceof ExitCalled) {
            exitCode = err.code
        } else if (err instanceof CliExitError) {
            stderrChunks.push(`error: ${err.message}\n`)
            exitCode = err.exitCode
        } else {
            throw err
        }
    } finally {
        process.stdout.isTTY = originalIsTty
        logSpy.mockRestore()
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
    }

    return {exitCode, stdout: stdoutLines.join('\n'), stderr: stderrChunks.join('')}
}

async function makeProject(): Promise<string> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-runtime-test-')))
    await mkdir(join(root, '.voicetree'), {recursive: true})
    return root
}

describe('runProjectCommand set-write-path containment', () => {
    let projectRoot: string
    const originalCwd: string = process.cwd()

    beforeEach(async () => {
        projectRoot = await makeProject()
        process.chdir(projectRoot)
    })

    afterEach(() => {
        process.chdir(originalCwd)
    })

    it('rejects a write path outside the project root and never reaches the daemon', async () => {
        let connectCalled: boolean = false
        const connect: ConnectProjectDaemon = async (): Promise<ProjectDaemon> => {
            connectCalled = true
            throw new Error('daemon should not be contacted for an out-of-project write path')
        }

        const result: CommandResult = await captureCommand(() =>
            runProjectCommand(['set-write-path', '/tmp/definitely-outside'], connect),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toMatch(/outside the project root/i)
        expect(connectCalled).toBe(false)
    })

    it('accepts a write path inside the project root', async () => {
        const insideWritePath: string = join(projectRoot, 'graph')
        const connect: ConnectProjectDaemon = async (): Promise<ProjectDaemon> => ({
            getProject: async (): Promise<ProjectState> => {
                throw new Error('getProject not expected in this test')
            },
            setWriteFolderPath: async (path: string): Promise<ProjectState> => ({
                projectRoot,
                readPaths: [],
                writeFolderPath: path,
            }),
        })

        const result: CommandResult = await captureCommand(() =>
            runProjectCommand(['set-write-path', insideWritePath], connect),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stdout).toContain(`Write Path: ${insideWritePath}`)
    })
})

describe('runSessionCommand show', () => {
    let projectRoot: string
    const originalCwd: string = process.cwd()

    beforeEach(async () => {
        projectRoot = await makeProject()
        process.chdir(projectRoot)
    })

    afterEach(() => {
        process.chdir(originalCwd)
    })

    it('prints the folder-state size from the daemon SessionInfo (not undefined)', async () => {
        const sessionInfo: SessionInfo = {
            id: '11111111-2222-3333-4444-555555555555',
            lastAccessedAt: 1700000000000,
            folderStateSize: 3,
            selectionSize: 2,
        }
        const connect: ConnectSessionDaemon = async (): Promise<SessionDaemon> => ({
            createSession: async (): Promise<{sessionId: string}> => {
                throw new Error('createSession not expected in this test')
            },
            getSession: async (): Promise<SessionInfo> => sessionInfo,
            deleteSession: async (): Promise<void> => {
                throw new Error('deleteSession not expected in this test')
            },
        })

        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['show', sessionInfo.id], connect),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stdout).toContain('Folder State Size: 3')
        expect(result.stdout).not.toContain('undefined')
        expect(result.stdout).toContain(`Session ID: ${sessionInfo.id}`)
        expect(result.stdout).toContain('Selection Size: 2')
    })
})

function connecting(daemon: SessionDaemon): ConnectSessionDaemon {
    return async (): Promise<SessionDaemon> => daemon
}

// The daemon answers an unknown session id with a 404 that the graph-db client
// surfaces as `GraphDbClientError(404, 'http_404', 'Not Found')`. This fake
// reproduces that exact shape so we can assert the command translates it into a
// clean domain outcome instead of leaking the raw transport string.
function notFoundDaemon(): SessionDaemon {
    const notFound = (): never => {
        throw new GraphDbClientError(404, 'http_404', 'Not Found')
    }
    return {
        createSession: async (): Promise<{sessionId: string}> => notFound(),
        getSession: async (): Promise<SessionInfo> => notFound(),
        deleteSession: async (): Promise<void> => notFound(),
    }
}

describe('runSessionCommand show — unknown id', () => {
    let projectRoot: string
    const originalCwd: string = process.cwd()

    beforeEach(async () => {
        projectRoot = await makeProject()
        process.chdir(projectRoot)
    })

    afterEach(() => {
        process.chdir(originalCwd)
    })

    it('maps a daemon 404 to a clean domain error naming the id, not a raw transport string', async () => {
        const id = 'deadbeef-0000-4000-8000-000000000000'
        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['show', id], connecting(notFoundDaemon())),
        )

        expect(result.exitCode).toBe(EXIT.DAEMON_HTTP_ERROR)
        expect(result.stderr).toContain(`Session ${id} not found`)
        expect(result.stderr).not.toContain('http_404')
        expect(result.stderr).not.toContain('daemon responded')
        expect(result.stderr).not.toContain('Not Found')
    })
})

describe('runSessionCommand delete — idempotent', () => {
    let projectRoot: string
    const originalCwd: string = process.cwd()

    beforeEach(async () => {
        projectRoot = await makeProject()
        process.chdir(projectRoot)
    })

    afterEach(() => {
        process.chdir(originalCwd)
    })

    it('treats a 404 (unknown / already-deleted id) as a successful deletion', async () => {
        const id = 'cafef00d-0000-4000-8000-000000000000'
        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['delete', id], connecting(notFoundDaemon())),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stdout).toContain(`Deleted Session: ${id}`)
        expect(result.stderr).not.toContain('http_404')
        expect(result.stderr).not.toContain('daemon responded')
    })

    it('emits {deleted:true} JSON for a 404 under --json so agents get a stable shape', async () => {
        const id = 'cafef00d-0000-4000-8000-000000000001'
        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['delete', id, '--json'], connecting(notFoundDaemon())),
        )

        expect(result.exitCode).toBeNull()
        expect(JSON.parse(result.stdout)).toEqual({deleted: true, sessionId: id})
    })

    it('deletes once then repeats cleanly (real success then idempotent 404)', async () => {
        const id = 'cafef00d-0000-4000-8000-000000000002'
        let deleted = false
        const daemon: SessionDaemon = {
            createSession: async (): Promise<{sessionId: string}> => {
                throw new Error('createSession not expected')
            },
            getSession: async (): Promise<SessionInfo> => {
                throw new Error('getSession not expected')
            },
            deleteSession: async (): Promise<void> => {
                if (deleted) {
                    throw new GraphDbClientError(404, 'http_404', 'Not Found')
                }
                deleted = true
            },
        }

        const first: CommandResult = await captureCommand(() =>
            runSessionCommand(['delete', id], connecting(daemon)),
        )
        expect(first.exitCode).toBeNull()
        expect(first.stdout).toContain(`Deleted Session: ${id}`)

        const second: CommandResult = await captureCommand(() =>
            runSessionCommand(['delete', id], connecting(daemon)),
        )
        expect(second.exitCode).toBeNull()
        expect(second.stdout).toContain(`Deleted Session: ${id}`)
        expect(second.stderr).not.toContain('http_404')
    })

    it('still propagates a non-404 daemon error as a daemon-http failure', async () => {
        const id = 'cafef00d-0000-4000-8000-000000000003'
        const daemon: SessionDaemon = {
            createSession: async (): Promise<{sessionId: string}> => {
                throw new Error('createSession not expected')
            },
            getSession: async (): Promise<SessionInfo> => {
                throw new Error('getSession not expected')
            },
            deleteSession: async (): Promise<void> => {
                throw new GraphDbClientError(409, 'project_busy', 'Project is busy')
            },
        }

        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['delete', id], connecting(daemon)),
        )
        expect(result.exitCode).toBe(EXIT.DAEMON_HTTP_ERROR)
        expect(result.stderr).toContain('project_busy')
    })
})

describe('runSessionCommand --help', () => {
    let connectCalled: boolean
    const neverConnect: ConnectSessionDaemon = async (): Promise<SessionDaemon> => {
        connectCalled = true
        throw new Error('daemon must not be contacted for --help')
    }

    beforeEach(() => {
        connectCalled = false
    })

    it.each([
        ['session --help', ['--help']],
        ['session -h', ['-h']],
        ['session delete --help', ['delete', '--help']],
        ['session show --help', ['show', '--help']],
    ])('%s prints usage on stdout and exits 0 without touching the daemon', async (_label, argv) => {
        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(argv, neverConnect),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stdout).toContain('Usage:')
        expect(result.stdout).toContain('vt session create')
        expect(result.stdout).toContain('vt session delete')
        expect(result.stdout).toContain('vt session show')
        expect(result.stderr).toBe('')
        expect(connectCalled).toBe(false)
    })
})
