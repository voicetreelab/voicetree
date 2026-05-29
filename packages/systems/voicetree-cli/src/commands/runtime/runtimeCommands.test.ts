import {mkdir, mkdtemp, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest'
import type {ProjectState, SessionInfo} from '@vt/graph-db-client'
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
