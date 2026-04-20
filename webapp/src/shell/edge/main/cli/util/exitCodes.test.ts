import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    DaemonLaunchTimeout,
    DaemonUnreachableError,
    GraphDbClientError,
} from '@vt/graph-db-client'
import { ArgValidationError, EXIT, handleCliError } from './exitCodes'

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

function invokeHandleCliError(
    err: unknown,
    options?: { debug?: string },
): { code: number; stderr: string } {
    const stderrChunks: string[] = []
    const previousDebug: string | undefined = process.env.VT_DEBUG

    if (options?.debug === undefined) {
        delete process.env.VT_DEBUG
    } else {
        process.env.VT_DEBUG = options.debug
    }

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        return true
    }) as typeof process.stderr.write)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ExitCalled(code ?? 0)
    }) as typeof process.exit)

    try {
        handleCliError(err)
    } catch (thrown: unknown) {
        if (thrown instanceof ExitCalled) {
            return { code: thrown.code, stderr: stderrChunks.join('') }
        }
        throw thrown
    } finally {
        stderrSpy.mockRestore()
        exitSpy.mockRestore()

        if (previousDebug === undefined) {
            delete process.env.VT_DEBUG
        } else {
            process.env.VT_DEBUG = previousDebug
        }
    }

    throw new Error('Expected handleCliError to exit the process')
}

afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.VT_DEBUG
})

describe('handleCliError', () => {
    it('maps ArgValidationError to exit code 2 and stderr output', () => {
        const result = invokeHandleCliError(new ArgValidationError('missing path argument'))

        expect(result).toEqual({
            code: EXIT.ARG_VALIDATION,
            stderr: 'error: missing path argument\n',
        })
    })

    it('maps VaultNotDetectedError-shaped failures to exit code 2', () => {
        const result = invokeHandleCliError({
            name: 'VaultNotDetectedError',
            message: 'could not detect a vault from cwd; pass --vault <path>',
        })

        expect(result).toEqual({
            code: EXIT.ARG_VALIDATION,
            stderr: 'error: could not detect a vault from cwd; pass --vault <path>\n',
        })
    })

    it('maps daemon connectivity failures to exit code 3', () => {
        const result = invokeHandleCliError(
            new DaemonUnreachableError('Discovered daemon, but /health was unreachable'),
        )

        expect(result).toEqual({
            code: EXIT.NETWORK,
            stderr: 'error: could not reach daemon: Discovered daemon, but /health was unreachable\n',
        })
    })

    it('maps daemon HTTP errors to exit code 4', () => {
        const result = invokeHandleCliError(
            new GraphDbClientError(422, 'path_invalid', 'Path must exist inside the vault'),
        )

        expect(result).toEqual({
            code: EXIT.DAEMON_HTTP_ERROR,
            stderr: 'error: daemon responded 422 path_invalid: Path must exist inside the vault\n',
        })
    })

    it('maps daemon launch timeouts to exit code 5 with a stable message', () => {
        const result = invokeHandleCliError(
            new DaemonLaunchTimeout('vt-graphd did not become ready within 5000ms'),
        )

        expect(result).toEqual({
            code: EXIT.DAEMON_LAUNCH_FAILURE,
            stderr: 'error: vt-graphd failed to launch within 5s\n',
        })
    })

    it('maps unknown Error instances to exit code 10', () => {
        const result = invokeHandleCliError(new Error('unexpected failure'))

        expect(result).toEqual({
            code: EXIT.UNKNOWN,
            stderr: 'error: unexpected failure\n',
        })
    })

    it('maps non-Error failures to exit code 10 with a generic message', () => {
        const result = invokeHandleCliError({ nope: true })

        expect(result).toEqual({
            code: EXIT.UNKNOWN,
            stderr: 'error: unknown failure\n',
        })
    })

    it('prints stack traces only when VT_DEBUG=1', () => {
        const err = new Error('debug me')
        err.stack = 'Error: debug me\n    at fake-test:1:1'

        const result = invokeHandleCliError(err, { debug: '1' })

        expect(result.code).toBe(EXIT.UNKNOWN)
        expect(result.stderr).toBe(
            'error: debug me\nError: debug me\n    at fake-test:1:1\n',
        )
    })
})
