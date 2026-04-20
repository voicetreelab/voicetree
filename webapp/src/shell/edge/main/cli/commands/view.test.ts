import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
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
import {runViewCommand} from './view.ts'

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
    const root: string = await mkdtemp(join(tmpdir(), 'vt-cli-view-'))
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

describe('runViewCommand', () => {
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

    it('sets pan for a pinned session', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            runViewCommand([
                'layout',
                'set-pan',
                '10',
                '20',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                pan: {x: 10, y: 20},
                zoom: 1,
            },
        })
    })

    it('uses VT_SESSION when set-zoom is run without an explicit session flag', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()
        process.env.VT_SESSION = sessionId

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-zoom', '1.5', '--vault', harness.vault]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                zoom: 1.5,
            },
        })
        await expect(createClient().getSessionState(sessionId)).resolves.toMatchObject({
            layout: {
                zoom: 1.5,
            },
        })
    })

    it('loads positions from a JSON file and preserves existing pan', async () => {
        const client: GraphDbClient = createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        const filePath: string = join(harness.root, 'positions.json')

        await client.updateLayout(sessionId, {
            pan: {x: 7, y: 8},
        })
        await writeFile(
            filePath,
            JSON.stringify({
                alpha: {x: 1, y: 2},
                beta: {x: 3, y: 4},
            }),
            'utf8',
        )

        const result: CommandResult = await captureCommand(() =>
            runViewCommand([
                'layout',
                'set-positions',
                filePath,
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({
            layout: {
                positions: {
                    alpha: {x: 1, y: 2},
                    beta: {x: 3, y: 4},
                },
                pan: {x: 7, y: 8},
                zoom: 1,
            },
        })
    })

    it('exits with an argument-validation code when the positions file is invalid JSON', async () => {
        const filePath: string = join(harness.root, 'invalid-positions.json')
        await writeFile(filePath, '{not valid json', 'utf8')

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-positions', filePath, '--vault', harness.vault]),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toContain('error: Could not parse positions JSON')
    })

    it('dispatches view commands through the top-level CLI entrypoint', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            main([
                'view',
                'layout',
                'set-pan',
                '4',
                '9',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                pan: {x: 4, y: 9},
            },
        })
    })
})
