/**
 * Pure interpretation of a `resumePersistedAgentSession` RPC result.
 *
 * The daemon route never throws — it always returns a `ResumePersistedResult`
 * discriminated on `kind` (see vt-daemon `recovery/resumePersistedAgentSession.ts`
 * and the `ResumePersistedAgentSession` protocol contract). So the CLI decides
 * success vs. failure from the returned `kind`, not from a thrown error:
 * `spawned` is the only success; every other kind is a clear, named reason the
 * resume could not happen and must exit non-zero.
 *
 * Keeping this mapping pure (record in → `{ok, message}` out) makes it a
 * black-box-testable unit and keeps `agent.ts` focused on I/O wiring.
 */

type JsonRecord = Record<string, unknown>

export type ResumeOutcome = {
    readonly ok: boolean
    readonly message: string
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Map a `ResumePersistedResult` payload to a single user-facing line. Unknown
 * `kind`s degrade to a non-ok line rather than throwing, so a future
 * daemon-side variant surfaces legibly instead of crashing the CLI.
 */
export function formatResumeResult(terminalId: string, payload: JsonRecord): ResumeOutcome {
    const kind: unknown = payload.kind
    switch (kind) {
        case 'spawned': {
            const pid: unknown = payload.pid
            const command: string = optionalString(payload.command) ?? '(unknown command)'
            return {
                ok: true,
                message: `Resumed agent ${terminalId} (pid ${String(pid)}).\nCommand: ${command}`,
            }
        }
        case 'stale': {
            const reason: string | undefined = optionalString(payload.reason)
            const detail: string = reason === 'already-claimed'
                ? 'a live agent already holds this terminal'
                : reason === 'no-resume-handle'
                    ? 'the session carries no resume handle (not a resumable CLI session)'
                    : 'no recoverable session is in discovery (its record may have been removed)'
            return {ok: false, message: `Cannot resume ${terminalId}: ${detail}.`}
        }
        case 'no-native-session': {
            const cliType: string = optionalString(payload.cliType) ?? 'CLI'
            const reason: string = optionalString(payload.reason) ?? 'not-found'
            const diagnostic: string | undefined = optionalString(payload.diagnosticSessionId)
            const diagnosticSuffix: string = diagnostic ? ` (diagnostic session ${diagnostic})` : ''
            return {
                ok: false,
                message: `Cannot resume ${terminalId}: no ${cliType} native session found — ${reason}${diagnosticSuffix}.`,
            }
        }
        case 'unsupported': {
            const reason: string = optionalString(payload.reason) ?? 'unsupported session'
            return {ok: false, message: `Cannot resume ${terminalId}: unsupported — ${reason}.`}
        }
        case 'spawn-failed': {
            const detail: string = optionalString(payload.error) ?? 'unknown spawn error'
            return {ok: false, message: `Failed to resume ${terminalId}: ${detail}.`}
        }
        default:
            return {
                ok: false,
                message: `Cannot resume ${terminalId}: daemon returned an unrecognised result kind \`${String(kind)}\`.`,
            }
    }
}
