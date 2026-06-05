import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi, type MockInstance} from 'vitest'
import {GraphDbClient, type GraphState} from '@vt/graph-db-client'
import {setGraph} from '@vt/graph-db-server/state/graph-store'
import {clearWatchFolderState} from '@vt/graph-db-server/state/watch-folder-store'
import {
    formatLintReportHuman,
    lintGraph,
} from '@vt/graph-tools/node-runtime'
import {
    createEmptyGraph,
} from '@vt/graph-model'
import {saveProjectConfigForDirectory} from '@vt/app-config/project-config'
import {loadAndMergeProjectPath} from '@vt/graph-db-server/watch-folder/project-allowlist'
import {type DaemonHandle, startDaemon} from '@vt/graph-db-server/server'
import {main} from '../../../voicetree-cli.ts'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type Harness = {
    voicetreeHomePath: string
    docsPath: string
    root: string
    project: string
}

type CommandResult = {
    exitCode: number | null
    stderr: string
    stdout: string
}

async function createHarness(): Promise<Harness> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-cli-graph-')))
    const voicetreeHomePath: string = join(root, 'voicetree-home')
    const project: string = join(root, 'project')
    const docsPath: string = join(project, 'docs')

    await mkdir(voicetreeHomePath, {recursive: true})
    await mkdir(docsPath, {recursive: true})

    return {root, voicetreeHomePath, project, docsPath}
}

async function waitFor<T>(
    fn: () => Promise<T | null>,
    opts: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<T> {
    const timeoutMs: number = opts.timeoutMs ?? 5000
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

async function captureCommand(invoke: () => Promise<void>): Promise<CommandResult> {
    const stdoutLines: string[] = []
    const stderrChunks: string[] = []
    const logSpy: MockInstance<typeof console.log> = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
        stdoutLines.push(args.map((value: unknown): string => String(value)).join(' '))
    })
    const stderrSpy: MockInstance<typeof process.stderr.write> = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        return true
    }) as typeof process.stderr.write)
    const exitSpy: MockInstance<typeof process.exit> = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
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

describe('graph daemon migration', () => {
    let daemonHandle: DaemonHandle
    let harness: Harness
    let originalVoicetreeHomePath: string | undefined
    let originalCwd: string
    let stdoutIsTTYDescriptor: PropertyDescriptor | undefined

    function docsRoot(): string {
        return join(harness.project, 'docs')
    }

    function createClient(): GraphDbClient {
        return new GraphDbClient({
            baseUrl: `http://127.0.0.1:${daemonHandle.port}`,
        })
    }

    beforeAll(async () => {
        harness = await createHarness()
        originalVoicetreeHomePath = process.env.VOICETREE_HOME_PATH
        process.env.VOICETREE_HOME_PATH = harness.voicetreeHomePath
        originalCwd = process.cwd()
        stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        setStdoutIsTTY(true)

        process.env.VOICETREE_HOME_PATH = harness.voicetreeHomePath
        clearWatchFolderState()
        setGraph(createEmptyGraph())

        await mkdir(join(harness.docsPath, 'nested'), {recursive: true})
        await saveProjectConfigForDirectory(harness.project, {
            writeFolderPath: harness.docsPath,
            readPaths: [],
        })

        await writeFile(join(harness.docsPath, 'root.md'), '# Root\n\n[[nested/leaf]]\n', 'utf8')
        await writeFile(join(harness.docsPath, 'nested', 'leaf.md'), '# Leaf\n\n[[root]]\n', 'utf8')
        await writeFile(join(harness.docsPath, 'nested', 'other.md'), '# Other\n', 'utf8')

        daemonHandle = await startDaemon({project: harness.project})
        const loadResult = await loadAndMergeProjectPath(harness.docsPath, {isWriteFolderPath: true})
        expect(loadResult).toEqual({kind: 'ok'})
        process.chdir(harness.project)

        await waitFor(async () => {
            const graph: GraphState = await createClient().getGraph()
            return Object.keys(graph.nodes).length === 3 ? graph : null
        })
    }, 30000)

    afterAll(async () => {
        process.chdir(originalCwd)

        if (stdoutIsTTYDescriptor) {
            Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor)
        } else {
            setStdoutIsTTY(true)
        }

        await daemonHandle?.stop().catch(() => {})
        clearWatchFolderState()
        setGraph(createEmptyGraph())

        if (originalVoicetreeHomePath === undefined) {
            delete process.env.VOICETREE_HOME_PATH
        } else {
            process.env.VOICETREE_HOME_PATH = originalVoicetreeHomePath
        }

        await rm(harness.root, {recursive: true, force: true})
        vi.restoreAllMocks()
    })

    it('routes graph structure through daemon-rendered graph snapshots', async () => {
        const expectedStdout: string = (await createClient().getView('cli')).output

        const result: CommandResult = await captureCommand(() =>
            main(['graph', 'structure', 'docs']),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toBe(expectedStdout)
    }, 15000)

    it('routes graph lint through daemon graph snapshots with parity to the disk helper', async () => {
        const expectedStdout: string = formatLintReportHuman(lintGraph(docsRoot()))

        const result: CommandResult = await captureCommand(() =>
            main(['graph', 'lint', 'docs']),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toBe(expectedStdout)
    }, 15000)
})
