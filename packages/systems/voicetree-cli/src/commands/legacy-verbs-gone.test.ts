import {afterAll, beforeAll, describe, expect, it, vi, type MockInstance} from 'vitest'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CliError} from './output.ts'
import {CliExitError, EXIT} from './util/exitCodes'
import {runViewCommand} from './graph-node/view.ts'
import {runProjectCommand} from './runtime/project.ts'
import {main} from '../voicetree-cli.ts'

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

async function captureCommand(invoke: () => Promise<void>): Promise<CommandResult> {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const logSpy: MockInstance = vi.spyOn(console, 'log').mockImplementation(((...values: unknown[]): void => {
        stdoutChunks.push(values.map((value: unknown): string => String(value)).join(' '))
    }) as typeof console.log)
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
            stderrChunks.push(`error: ${err.message}\n`)
            exitCode = err.exitCode
        } else if (err instanceof CliError) {
            // error() throws CliError; the entry-point boundary maps it to exit
            // code 1. We mirror that mapping so callers can assert non-zero exit.
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
        exitCode,
        stdout: stdoutChunks.join('\n'),
        stderr: stderrChunks.join(''),
    }
}

describe('legacy CLI verbs', () => {
    it.each([
        ['vt project add-read-path', () => runProjectCommand(['add-read-path', '/tmp/x'])],
        ['vt project remove-read-path', () => runProjectCommand(['remove-read-path', '/tmp/x'])],
        ['vt view collapse', () => runViewCommand(['collapse', '/tmp/x'])],
        ['vt view expand', () => runViewCommand(['expand', '/tmp/x'])],
    ])('%s is unknown', async (_label, invoke) => {
        const result: CommandResult = await captureCommand(invoke)

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toMatch(/unknown/i)
    })
})

describe('removed graph view alias', () => {
    let telemetryDir: string

    beforeAll((): void => {
        telemetryDir = mkdtempSync(join(tmpdir(), 'vt-legacy-verbs-'))
        // main() installs a telemetry sink that appends to a JSONL file; redirect
        // it to a throwaway dir so the test does not write into the real home.
        process.env.VOICETREE_TELEMETRY_PATH = join(telemetryDir, 'cli-telemetry.jsonl')
    })

    afterAll((): void => {
        delete process.env.VOICETREE_TELEMETRY_PATH
        rmSync(telemetryDir, {recursive: true, force: true})
    })

    it('`vt graph view` is now an unknown subcommand', async () => {
        const result: CommandResult = await captureCommand(() => main(['graph', 'view', '/tmp/x']))

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toMatch(/unknown graph subcommand: view/i)
        expect(result.stderr).not.toMatch(/deprecated/i)
    })
})

describe('agent metrics HTTP-only breadcrumb', () => {
    let telemetryDir: string

    beforeAll((): void => {
        telemetryDir = mkdtempSync(join(tmpdir(), 'vt-metrics-breadcrumb-'))
        process.env.VOICETREE_TELEMETRY_PATH = join(telemetryDir, 'cli-telemetry.jsonl')
    })

    afterAll((): void => {
        delete process.env.VOICETREE_TELEMETRY_PATH
        rmSync(telemetryDir, {recursive: true, force: true})
    })

    it.each([['sessions'], ['append']])(
        '`vt agent metrics %s` points to the daemon HTTP /rpc surface and exits non-zero',
        async (sub: string) => {
            const result: CommandResult = await captureCommand(() => main(['agent', 'metrics', sub]))

            expect(result.exitCode).toBe(1)
            expect(result.stderr).toMatch(/not a CLI subcommand/i)
            expect(result.stderr).toMatch(/\/rpc/)
            expect(result.stderr).toMatch(/metrics\.getSessions/)
            expect(result.stderr).toMatch(/metrics\.appendSession/)
            // It must NOT fall through to the generic unknown-subcommand error.
            expect(result.stderr).not.toMatch(/unknown agent subcommand/i)
        },
    )
})
