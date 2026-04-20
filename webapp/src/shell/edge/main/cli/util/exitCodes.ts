import {
    DaemonLaunchTimeout,
    DaemonUnreachableError,
    GraphDbClientError,
} from '@vt/graph-db-client'

export const EXIT = {
    SUCCESS: 0,
    ARG_VALIDATION: 2,
    NETWORK: 3,
    DAEMON_HTTP_ERROR: 4,
    DAEMON_LAUNCH_FAILURE: 5,
    UNKNOWN: 10,
} as const

type ExitCode = (typeof EXIT)[keyof typeof EXIT]

interface VaultNotDetectedErrorShape {
    name: 'VaultNotDetectedError'
    message: string
}

export class ArgValidationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ArgValidationError'
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function isVaultNotDetectedError(err: unknown): err is VaultNotDetectedErrorShape {
    return (
        isRecord(err) &&
        err.name === 'VaultNotDetectedError' &&
        typeof err.message === 'string'
    )
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`)
}

function writeDebugStack(err: unknown): void {
    if (process.env.VT_DEBUG !== '1') {
        return
    }

    if (!(err instanceof Error) || typeof err.stack !== 'string' || err.stack.length === 0) {
        return
    }

    process.stderr.write(err.stack.endsWith('\n') ? err.stack : `${err.stack}\n`)
}

function exitWith(code: ExitCode, message: string, err: unknown): never {
    writeStderrLine(`error: ${message}`)
    writeDebugStack(err)
    process.exit(code)
}

export function handleCliError(err: unknown): never {
    if (isVaultNotDetectedError(err)) {
        exitWith(EXIT.ARG_VALIDATION, err.message, err)
    }

    if (err instanceof ArgValidationError) {
        exitWith(EXIT.ARG_VALIDATION, err.message, err)
    }

    if (err instanceof DaemonUnreachableError) {
        exitWith(EXIT.NETWORK, `could not reach daemon: ${err.message}`, err)
    }

    if (err instanceof GraphDbClientError) {
        exitWith(
            EXIT.DAEMON_HTTP_ERROR,
            `daemon responded ${err.status} ${err.code}: ${err.message}`,
            err,
        )
    }

    if (err instanceof DaemonLaunchTimeout) {
        exitWith(EXIT.DAEMON_LAUNCH_FAILURE, 'vt-graphd failed to launch within 5s', err)
    }

    if (err instanceof Error) {
        exitWith(EXIT.UNKNOWN, err.message, err)
    }

    exitWith(EXIT.UNKNOWN, 'unknown failure', err)
}
