import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'
import {
    formatLintReportHuman,
    getGraphStructure,
    lintGraph,
    renderAutoView,
    renderGraphView,
} from '@vt/graph-tools/node'
import {
    clearWatchFolderState,
    createEmptyGraph,
    initGraphModel,
    saveVaultConfigForDirectory,
    setGraph,
} from '@vt/graph-model'
import {type DaemonHandle, startDaemon} from '../../../../../../../packages/graph-db-server/src/server.ts'
import {main} from '../voicetree-cli.ts'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type Harness = {
    appSupportPath: string
    docsPath: string
    root: string
    vault: string
}

type CommandResult = {
    exitCode: number | null
    stderr: string
    stdout: string
}

async function createHarness(): Promise<Harness> {
    const root: string = await mkdtemp(join(tmpdir(), 'vt-cli-graph-'))
    const appSupportPath: string = join(root, 'app-support')
    const vault: string = join(root, 'vault')
    const docsPath: string = join(vault, 'docs')

    await mkdir(appSupportPath, {recursive: true})
    await mkdir(docsPath, {recursive: true})

    return {root, appSupportPath, vault, docsPath}
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

describe('graph daemon migration', () => {
    let daemonHandle: DaemonHandle
    let harness: Harness
    let originalAppSupportPath: string | undefined
    let originalCwd: string
    let stdoutIsTTYDescriptor: PropertyDescriptor | undefined

    function docsRoot(): string {
        return join(harness.vault, 'docs')
    }

    function createClient(): GraphDbClient {
        return new GraphDbClient({
            baseUrl: `http://127.0.0.1:${daemonHandle.port}`,
        })
    }

    beforeAll(async () => {
        harness = await createHarness()
        originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
        process.env.VOICETREE_APP_SUPPORT = harness.appSupportPath
        originalCwd = process.cwd()
        stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        setStdoutIsTTY(true)

        initGraphModel({appSupportPath: harness.appSupportPath})
        clearWatchFolderState()
        setGraph(createEmptyGraph())

        await mkdir(join(harness.docsPath, 'nested'), {recursive: true})
        await saveVaultConfigForDirectory(harness.vault, {
            writePath: harness.docsPath,
            readPaths: [],
        })

        daemonHandle = await startDaemon({vault: harness.vault})
        await writeFile(join(harness.docsPath, 'root.md'), '# Root\n\n[[nested/leaf]]\n', 'utf8')
        await writeFile(join(harness.docsPath, 'nested', 'leaf.md'), '# Leaf\n\n[[root]]\n', 'utf8')
        await writeFile(join(harness.docsPath, 'nested', 'other.md'), '# Other\n', 'utf8')
        process.chdir(harness.vault)

        await waitFor(async () => {
            const graph = await createClient().getGraph()
            return Object.keys(graph.nodes).length === 3 ? graph : null
        })
    }, 10000)

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

        if (originalAppSupportPath === undefined) {
            delete process.env.VOICETREE_APP_SUPPORT
        } else {
            process.env.VOICETREE_APP_SUPPORT = originalAppSupportPath
        }

        await rm(harness.root, {recursive: true, force: true})
        vi.restoreAllMocks()
    })

    it('routes graph structure through daemon graph snapshots with parity to the disk helper', async () => {
        const expected = getGraphStructure(docsRoot(), {withSummaries: false})
        const expectedStdout: string = [
            `${expected.nodeCount} nodes in docs`,
            '',
            expected.ascii,
            ...(expected.orphanCount > 0 ? ['', `Orphans: ${expected.orphanCount}`] : []),
        ].join('\n')

        const result: CommandResult = await captureCommand(() =>
            main(['graph', 'structure', 'docs', '--no-summaries']),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toBe(expectedStdout)
    })

    it('routes explicit graph view rendering through daemon graph snapshots with parity to the disk helper', async () => {
        const expected = renderGraphView(docsRoot(), {
            format: 'ascii',
            collapsedFolders: ['nested'],
            selectedIds: ['root'],
        })
        const expectedStdout: string = `${expected.output}\n\n${expected.nodeCount} nodes — ${expected.folderNodeCount} folder nodes, ${expected.virtualFolderCount} virtual folders, ${expected.fileNodeCount} files`

        const result: CommandResult = await captureCommand(() =>
            main(['graph', 'view', 'docs', '--ascii', '--collapse', 'nested', '--select', 'root']),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toBe(expectedStdout)
    })

    it('routes auto graph view rendering through daemon graph snapshots with parity to the disk helper', async () => {
        const expectedStdout: string = renderAutoView(docsRoot(), {budget: 2}).output

        const result: CommandResult = await captureCommand(() =>
            main(['graph', 'view', 'docs', '--auto', '--budget', '2']),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toBe(expectedStdout)
    })

    it('routes graph lint through daemon graph snapshots with parity to the disk helper', async () => {
        const expectedStdout: string = formatLintReportHuman(lintGraph(docsRoot()))

        const result: CommandResult = await captureCommand(() =>
            main(['graph', 'lint', 'docs']),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toBe(expectedStdout)
    })
})
