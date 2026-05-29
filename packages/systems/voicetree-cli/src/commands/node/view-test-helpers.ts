import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, expect, vi, type MockInstance} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'
import {setGraph} from '@vt/graph-db-server/state/graph-store'
import {clearWatchFolderState} from '@vt/graph-db-server/state/watch-folder-store'
import {type DaemonHandle, startDaemon} from '@vt/graph-db-server/server'
import {createEmptyGraph} from '@vt/graph-model'
import {CliError} from '../output'
import {CliExitError} from '../util/exitCodes'

export class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

export type Harness = {
    voicetreeHomePath: string
    root: string
    project: string
}

export type CommandResult = {
    exitCode: number | null
    stderr: string
    stdout: string
}

export function parseStdoutJson<T>(result: CommandResult): T {
    return JSON.parse(result.stdout) as T
}

export async function createHarness(): Promise<Harness> {
    const root: string = await mkdtemp(join(tmpdir(), 'vt-cli-view-'))
    const voicetreeHomePath: string = join(root, 'voicetree-home')
    const project: string = join(root, 'project')

    await mkdir(voicetreeHomePath, {recursive: true})
    await mkdir(project, {recursive: true})

    return {root, voicetreeHomePath, project}
}

export async function waitFor<T>(
    fn: () => Promise<T | null>,
    opts: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<T> {
    const timeoutMs: number = opts.timeoutMs ?? 2000
    const intervalMs: number = opts.intervalMs ?? 50
    const deadline: number = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        const value: T | null = await fn()
        if (value !== null) {
            return value
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(`condition not met within ${timeoutMs}ms`)
}

export async function captureCommand(invoke: () => Promise<void>): Promise<CommandResult> {
    const stdoutLines: string[] = []
    const stderrChunks: string[] = []
    const logSpy: MockInstance = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
        stdoutLines.push(args.map((value: unknown): string => String(value)).join(' '))
    })
    const stderrSpy: MockInstance = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        return true
    }) as typeof process.stderr.write)
    const exitSpy: MockInstance = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ExitCalled(code ?? 0)
    }) as typeof process.exit)

    let exitCode: number | null = null

    try {
        await invoke()
    } catch (err) {
        if (err instanceof ExitCalled) {
            exitCode = err.code
        } else if (err instanceof CliExitError) {
            // Pure path: handleCliError now throws CliExitError. captureCommand
            // emulates the entry-point catch by writing the message to stderr
            // and recording the requested exit code.
            stderrChunks.push(`error: ${err.message}\n`)
            exitCode = err.exitCode
        } else if (err instanceof CliError) {
            stderrChunks.push(`error: ${err.message}\n`)
            exitCode = 1
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

export function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {
        value,
        configurable: true,
    })
}

export type ViewTestContext = {
    /** The temp harness (root/project/voicetreeHomePath) for the current test. */
    harness: () => Harness
    /** The daemon handle backing the current test. */
    daemonHandle: () => DaemonHandle
    /** A fresh client bound to the current test's daemon port. */
    createClient: () => GraphDbClient
}

/**
 * Registers the shared `vt view` integration lifecycle (temp project, env
 * pinning, fresh in-process daemon, graph/watch-folder reset) via Vitest's
 * beforeEach/afterEach and returns getters scoped to the current test.
 *
 * Both `view.test.ts` and `view.layout.test.ts` consume this so the lifecycle
 * is defined exactly once. Getters (rather than captured values) are returned
 * because the underlying handles are re-created per test.
 */
export function setupViewTestContext(): ViewTestContext {
    let harness: Harness
    let daemonHandle: DaemonHandle
    let originalVoicetreeHomePath: string | undefined
    let originalSessionEnv: string | undefined
    let originalCwd: string
    let stdoutIsTTYDescriptor: PropertyDescriptor | undefined

    beforeEach(async () => {
        harness = await createHarness()
        originalVoicetreeHomePath = process.env.VOICETREE_HOME_PATH
        originalSessionEnv = process.env.VT_SESSION
        process.env.VOICETREE_HOME_PATH = harness.voicetreeHomePath
        delete process.env.VT_SESSION
        originalCwd = process.cwd()
        stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        setStdoutIsTTY(false)
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        daemonHandle = await startDaemon({project: harness.project, createStarterIfEmpty: false})
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

        if (originalVoicetreeHomePath === undefined) {
            delete process.env.VOICETREE_HOME_PATH
        } else {
            process.env.VOICETREE_HOME_PATH = originalVoicetreeHomePath
        }

        if (originalSessionEnv === undefined) {
            delete process.env.VT_SESSION
        } else {
            process.env.VT_SESSION = originalSessionEnv
        }

        await rm(harness.root, {recursive: true, force: true})
        vi.restoreAllMocks()
    })

    return {
        harness: () => harness,
        daemonHandle: () => daemonHandle,
        createClient: () =>
            new GraphDbClient({baseUrl: `http://127.0.0.1:${daemonHandle.port}`}),
    }
}
