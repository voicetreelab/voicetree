import {describe, expect, it, vi, type MockInstance} from 'vitest'
import {CliExitError, EXIT} from './util/exitCodes'
import {runViewCommand} from './node/view.ts'
import {runProjectCommand} from './runtime/project.ts'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type CommandResult = {
    exitCode: number | null
    stderr: string
}

async function captureCommand(invoke: () => Promise<void>): Promise<CommandResult> {
    const stderrChunks: string[] = []
    const logSpy: MockInstance = vi.spyOn(console, 'log').mockImplementation((): void => {})
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
