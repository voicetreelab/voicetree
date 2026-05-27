import {
    DaemonLaunchTimeout,
    DaemonUnreachableError,
    GraphDbClientError,
} from '@vt/graph-db-client'
import {isRecord} from '../graph/core/util'

export const EXIT: {
    readonly SUCCESS: 0
    readonly ARG_VALIDATION: 2
    readonly NETWORK: 3
    readonly DAEMON_HTTP_ERROR: 4
    readonly DAEMON_LAUNCH_FAILURE: 5
    readonly UNKNOWN: 10
} = {
    SUCCESS: 0,
    ARG_VALIDATION: 2,
    NETWORK: 3,
    DAEMON_HTTP_ERROR: 4,
    DAEMON_LAUNCH_FAILURE: 5,
    UNKNOWN: 10,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

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

/**
 * Pure error carrying an exit code + reclassified message + the original
 * cause (preserved for VT_DEBUG=1 stack-trace printing at the boundary).
 *
 * handleCliError throws this; the entry-point catch in voicetree-cli.ts is
 * the only place that touches process.exit / process.stderr / process.env,
 * keeping handleCliError and every catch site free of the transitive-
 * purity gate.
 */
export class CliExitError extends Error {
    constructor(
        readonly exitCode: ExitCode,
        message: string,
        readonly cause: unknown,
    ) {
        super(message)
        this.name = 'CliExitError'
    }

    get errorClass(): string {
        if (this.cause instanceof Error) return this.cause.name
        if (isVaultNotDetectedError(this.cause)) return this.cause.name
        return 'UnknownError'
    }
}

function isVaultNotDetectedError(err: unknown): err is VaultNotDetectedErrorShape {
    return (
        isRecord(err) &&
        err.name === 'VaultNotDetectedError' &&
        typeof err.message === 'string'
    )
}

export function handleCliError(err: unknown): never {
    if (isVaultNotDetectedError(err)) {
        throw new CliExitError(EXIT.ARG_VALIDATION, err.message, err)
    }

    if (err instanceof ArgValidationError) {
        throw new CliExitError(EXIT.ARG_VALIDATION, err.message, err)
    }

    if (err instanceof DaemonUnreachableError) {
        throw new CliExitError(EXIT.NETWORK, `could not reach daemon: ${err.message}`, err)
    }

    if (err instanceof GraphDbClientError) {
        throw new CliExitError(
            EXIT.DAEMON_HTTP_ERROR,
            `daemon responded ${err.status} ${err.code}: ${err.message}`,
            err,
        )
    }

    if (err instanceof DaemonLaunchTimeout) {
        throw new CliExitError(EXIT.DAEMON_LAUNCH_FAILURE, err.message, err)
    }

    if (err instanceof Error) {
        throw new CliExitError(EXIT.UNKNOWN, err.message, err)
    }

    throw new CliExitError(EXIT.UNKNOWN, 'unknown failure', err)
}
