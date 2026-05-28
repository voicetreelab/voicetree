import {mkdir, mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect, vi, type MockInstance} from 'vitest'
import {runViewCommand} from '@/shell/edge/main/cli/commands/node/view'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

export type Harness = {
    appSupportPath: string
    root: string
    vault: string
}

export type CommandResult = {
    exitCode: number | null
    stderr: string
    stdout: string
}

function parseStdoutJson<T>(result: CommandResult): T {
    return JSON.parse(result.stdout) as T
}

export async function createHarness(): Promise<Harness> {
    const root: string = await mkdtemp(join(tmpdir(), 'vt-cli-view-'))
    const appSupportPath: string = join(root, 'app-support')
    const vault: string = join(root, 'vault')

    await mkdir(appSupportPath, {recursive: true})
    await mkdir(vault, {recursive: true})

    return {root, appSupportPath, vault}
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

export async function runViewJson(argv: string[]): Promise<unknown> {
    const result: CommandResult = await captureCommand(() => runViewCommand(argv))
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toBe('')
    return parseStdoutJson(result)
}

export function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {
        value,
        configurable: true,
    })
}
