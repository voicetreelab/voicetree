import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
    clearWatchFolderState,
    createEmptyGraph,
    setGraph,
} from '@vt/graph-model'
import {type DaemonHandle, startDaemon} from '../../../../../../../packages/graph-db-server/src/server.ts'
import {main} from '../voicetree-cli.ts'
import {EXIT} from '../util/exitCodes.ts'
import {runVaultCommand} from './vault.ts'

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
    const root: string = await mkdtemp(join(tmpdir(), 'vt-cli-vault-'))
    const appSupportPath: string = join(root, 'app-support')
    const vault: string = join(root, 'vault')

    await mkdir(appSupportPath, {recursive: true})
    await mkdir(vault, {recursive: true})

    return {root, appSupportPath, vault}
}

async function invokeVaultCommand(argv: string[]): Promise<CommandResult> {
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
        await runVaultCommand(argv)
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

describe('runVaultCommand', () => {
    let daemonHandle: DaemonHandle
    let harness: Harness
    let originalAppSupportPath: string | undefined
    let originalCwd: string
    let stdoutIsTTYDescriptor: PropertyDescriptor | undefined

    beforeEach(async () => {
        harness = await createHarness()
        originalAppSupportPath = process.env.VOICETREE_APP_SUPPORT
        process.env.VOICETREE_APP_SUPPORT = harness.appSupportPath
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

        await rm(harness.root, {recursive: true, force: true})
        vi.restoreAllMocks()
    })

    it('shows vault state as JSON', async () => {
        const result: CommandResult = await invokeVaultCommand(['show', '--vault', harness.vault])

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({
            vaultPath: harness.vault,
            readPaths: [],
            writePath: harness.vault,
        })
    })

    it('dispatches vault subcommands through the top-level CLI entrypoint', async () => {
        const stdoutLines: string[] = []
        const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
            stdoutLines.push(args.map((value: unknown): string => String(value)).join(' '))
        })

        try {
            await main(['vault', 'show', '--vault', harness.vault])
        } finally {
            logSpy.mockRestore()
        }

        expect(JSON.parse(stdoutLines.join('\n'))).toMatchObject({
            vaultPath: harness.vault,
        })
    })

    it('adds a read path and shows the updated readPaths list', async () => {
        const docsPath: string = join(harness.vault, 'docs')
        await mkdir(docsPath, {recursive: true})

        const addResult: CommandResult = await invokeVaultCommand([
            'add-read-path',
            docsPath,
            '--vault',
            harness.vault,
        ])
        const showResult: CommandResult = await invokeVaultCommand(['show', '--vault', harness.vault])

        expect(addResult.exitCode).toBeNull()
        expect(JSON.parse(addResult.stdout)).toEqual({readPaths: [docsPath]})
        expect(JSON.parse(showResult.stdout)).toMatchObject({
            readPaths: [docsPath],
        })
    })

    it('sets the write path and returns the new writePath', async () => {
        const outputPath: string = join(harness.vault, 'out')
        await mkdir(outputPath, {recursive: true})

        const setResult: CommandResult = await invokeVaultCommand([
            'set-write-path',
            outputPath,
            '--vault',
            harness.vault,
        ])
        const showResult: CommandResult = await invokeVaultCommand(['show', '--vault', harness.vault])

        expect(setResult.exitCode).toBeNull()
        expect(JSON.parse(setResult.stdout)).toEqual({writePath: outputPath})
        expect(JSON.parse(showResult.stdout)).toMatchObject({
            writePath: outputPath,
        })
    })

    it('removes a read path and returns the updated empty list', async () => {
        const docsPath: string = join(harness.vault, 'docs')
        await mkdir(docsPath, {recursive: true})
        await invokeVaultCommand(['add-read-path', docsPath, '--vault', harness.vault])

        const removeResult: CommandResult = await invokeVaultCommand([
            'remove-read-path',
            docsPath,
            '--vault',
            harness.vault,
        ])
        const showResult: CommandResult = await invokeVaultCommand(['show', '--vault', harness.vault])

        expect(removeResult.exitCode).toBeNull()
        expect(JSON.parse(removeResult.stdout)).toEqual({readPaths: []})
        expect(JSON.parse(showResult.stdout)).toMatchObject({
            readPaths: [],
        })
    })

    it('auto-detects the vault from a nested cwd', async () => {
        const nestedPath: string = join(harness.vault, 'projects', 'nested')
        await mkdir(nestedPath, {recursive: true})
        process.chdir(nestedPath)

        const result: CommandResult = await invokeVaultCommand(['show'])

        expect(result.exitCode).toBeNull()
        expect(JSON.parse(result.stdout)).toMatchObject({
            vaultPath: harness.vault,
        })
    })

    it('exits with code 2 when a required path argument is missing', async () => {
        const result: CommandResult = await invokeVaultCommand(['add-read-path', '--vault', harness.vault])

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toContain('error: Missing required <path> for `add-read-path`.')
        expect(result.stderr).toContain('Usage:\n  vt vault show')
    })

    it('exits with code 4 when the daemon rejects an invalid path', async () => {
        const missingPath: string = join(harness.vault, 'missing')
        const result: CommandResult = await invokeVaultCommand([
            'add-read-path',
            missingPath,
            '--vault',
            harness.vault,
        ])

        expect(result.exitCode).toBe(EXIT.DAEMON_HTTP_ERROR)
        expect(result.stderr).toBe(
            'error: daemon responded 400 PATH_NOT_FOUND: Path does not exist\n',
        )
    })
})
