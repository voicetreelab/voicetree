/**
 * Pure interpretation of a `forkAgentSession` RPC result.
 *
 * Forking mirrors resume's recovery-result handling but creates a branched
 * terminal under a fresh terminalId. The daemon reports all outcomes as a
 * discriminated `kind`; `spawned` is the only successful kind.
 */

type JsonRecord = Record<string, unknown>

export type ForkOutcome = {
    readonly ok: boolean
    readonly message: string
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function formatForkResult(sourceTerminalId: string, payload: JsonRecord): ForkOutcome {
    const kind: unknown = payload.kind
    switch (kind) {
        case 'spawned': {
            const forkedTerminalId: string = optionalString(payload.forkedTerminalId) ?? '(unknown terminal)'
            const pid: unknown = payload.pid
            const command: string = optionalString(payload.command) ?? '(unknown command)'
            return {
                ok: true,
                message: `Forked ${sourceTerminalId} → ${forkedTerminalId} (pid ${String(pid)}).\nCommand: ${command}`,
            }
        }
        case 'stale': {
            const reason: string | undefined = optionalString(payload.reason)
            const detail: string = reason === 'no-resume-handle'
                ? 'the session carries no resume handle (not a forkable CLI session)'
                : 'no recoverable session is in discovery (its record may have been removed)'
            return {ok: false, message: `Cannot fork ${sourceTerminalId}: ${detail}.`}
        }
        case 'no-native-session': {
            const cliType: string = optionalString(payload.cliType) ?? 'CLI'
            const reason: string = optionalString(payload.reason) ?? 'not-found'
            const diagnostic: string | undefined = optionalString(payload.diagnosticSessionId)
            const diagnosticSuffix: string = diagnostic ? ` (diagnostic session ${diagnostic})` : ''
            return {
                ok: false,
                message: `Cannot fork ${sourceTerminalId}: no ${cliType} native session found — ${reason}${diagnosticSuffix}.`,
            }
        }
        case 'unsupported': {
            const reason: string = optionalString(payload.reason) ?? 'unsupported session'
            return {ok: false, message: `Cannot fork ${sourceTerminalId}: unsupported — ${reason}.`}
        }
        case 'spawn-failed': {
            const detail: string = optionalString(payload.error) ?? 'unknown spawn error'
            return {ok: false, message: `Failed to fork ${sourceTerminalId}: ${detail}.`}
        }
        default:
            return {
                ok: false,
                message: `Cannot fork ${sourceTerminalId}: daemon returned an unrecognised result kind \`${String(kind)}\`.`,
            }
    }
}
