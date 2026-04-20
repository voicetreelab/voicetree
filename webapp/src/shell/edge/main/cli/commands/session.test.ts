import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'
import {
    clearWatchFolderState,
    createEmptyGraph,
    setGraph,
} from '@vt/graph-model'
import {type DaemonHandle, startDaemon} from '../../../../../../../packages/graph-db-server/src/server.ts'
import {main} from '../voicetree-cli.ts'
import {EXIT} from '../util/exitCodes.ts'
import {runSessionCommand} from './session.ts'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type Harness = {
    appSupportPath: string
    root: string
    vault: string
}

type CommandResult = {
    exitCode: number | null
    stderr: string
    stdout: string
}

async function createHarness(): Promise<Harness> {
    const root: string = await mkdtemp(join(tmpdir(), 'vt-cli-session-'))
    const appSupportPath: string = join(root, 'app-support')
    const vault: string = join(root, 'vault')

    await mkdir(appSupportPath, {recursive: true})
    await mkdir(vault, {recursive: true})

    return {root, appSupportPath, vault}
}

async function captureCommand(invoke: () => Promise<void>): Promise<CommandResult> {
    const stdoutLines: string[] = []
    const stderrChunks: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
        stdoutLines.push(args.map((value: unknown): string => String(value)).join(' '))
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        return true
    }) as typeof process.stderr.write)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ExitCalled(code ?? 0)
    }) as typeof process.exit)

    let exitCode: number | null = null

    try {
        await invoke()
    } catch (err) {
        if (err instanceof ExitCalled) {
            exitCode = err.code
        } else {
            throw err
        }
    } finally {
        logSpy.mockRestore()
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
    }

    return {
        stdout: stdoutLines.join('\n'),
        stderr: stderrChunks.join(''),
        exitCode,
    }
}

function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {
        value,
        configurable: true,
    })
}

describe('runSessionCommand', () => {
    let daemonHandle: DaemonHandle
    let harness: Harness
    let originalAppSupportPath: string | undefined
    let originalSessionEnv: string | undefined
    let originalCwd: string
    let stdoutIsTTYDescriptor: PropertyDescriptor | undefined

    function createClient(): GraphDbClient {
        return new GraphDbClient({
            baseUrl: `http://127.0.0.1:${daemonHandle.port}`,
        })
    }

    beforeEach(async () => {
        harness = await createHarness()
        originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
        originalSessionEnv = process.env.VT_SESSION
        process.env.VOICETREE_APP_SUPPORT = harness.appSupportPath
        delete process.env.VT_SESSION
        originalCwd = process.cwd()
        stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        setStdoutIsTTY(false)
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        daemonHandle = await startDaemon({vault: harness.vault})
    })

    afterEach(async () => {
        process.chdir(originalCwd)

        if (stdoutIsTTYDescriptor) {
            Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor)
        } else {
            setStdoutIsTTY(true)
        }

        await daemonHandle.stop().catch(() => {})
        clearWatchFolderState()
        setGraph(createEmptyGraph())

        if (originalAppSupportPath === undefined) {
            delete process.env.VOICETREE_APP_SUPPORT
        } else {
            process.env.VOICETREE_APP_SUPPORT = originalAppSupportPath
        }

        if (originalSessionEnv === undefined) {
            delete process.env.VT_SESSION
        } else {
            process.env.VT_SESSION = originalSessionEnv
        }

        await rm(harness.root, {recursive: true, force: true})
        vi.restoreAllMocks()
    })

    it('creates a session and prints the new session id', async () => {
        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['create', '--vault', harness.vault]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')

        const created: {sessionId: string} = JSON.parse(result.stdout)
        expect(created.sessionId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        )
        await expect(createClient().getSession(created.sessionId)).resolves.toMatchObject({
            id: created.sessionId,
        })
    })

    it('shows an existing session by explicit id', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['show', sessionId, '--vault', harness.vault]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            id: sessionId,
            collapseSetSize: 0,
            selectionSize: 0,
        })
    })

    it('shows the current session from VT_SESSION when no id is passed', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()
        process.env.VT_SESSION = sessionId

        const result: CommandResult = await captureCommand(() =>
            runSessionCommand(['show', '--vault', harness.vault]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            id: sessionId,
        })
    })

    it('deletes a session and surfaces a 404 for subsequent reads', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        const deleteResult: CommandResult = await captureCommand(() =>
            runSessionCommand(['delete', sessionId, '--vault', harness.vault]),
        )
        const showResult: CommandResult = await captureCommand(() =>
            runSessionCommand(['show', sessionId, '--vault', harness.vault]),
        )

        expect(deleteResult.exitCode).toBeNull()
        expect(deleteResult.stderr).toBe('')
        expect(JSON.parse(deleteResult.stdout)).toEqual({
            deleted: true,
            sessionId,
        })
        expect(showResult.exitCode).toBe(EXIT.DAEMON_HTTP_ERROR)
        expect(showResult.stderr).toContain('error: daemon responded 404')
    })

    it('dispatches session commands through the top-level CLI entrypoint', async () => {
        const result: CommandResult = await captureCommand(() =>
            main(['session', 'create', '--vault', harness.vault]),
        )

        expect(result.exitCode).toBeNull()
        expect(JSON.parse(result.stdout)).toMatchObject({
            sessionId: expect.any(String),
        })
    })
})
