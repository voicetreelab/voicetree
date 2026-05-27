import {getRecoveryEnv, type RecoveryEnv} from '@vt/agent-runtime/runtime/runtime-config'
import {
    resolveClaudeNativeSession,
    defaultResolveClaudeDeps,
    type ResolveClaudeResult,
    type ClaudeMissReason,
} from './resolveClaudeNativeSession'
import {
    resolveCodexNativeSession,
    defaultResolveCodexDeps,
    type ResolveCodexResult,
    type CodexMissReason,
} from './resolveCodexNativeSession'

export type NativeSessionRequest = {
    readonly cliType: 'claude' | 'codex'
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
}

/**
 * Discriminant explaining why a native session lookup returned `not-found`.
 * Exhaustive across both CLI families so the UI can render a single switch.
 */
export type NativeSessionMissReason = CodexMissReason | ClaudeMissReason

export type NativeSessionResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath?: string}
    | {
        readonly kind: 'not-found'
        readonly reason: NativeSessionMissReason
        readonly diagnosticSessionId?: string
    }

export type ResolveNativeSession = (request: NativeSessionRequest) => Promise<NativeSessionResult>

/**
 * Lazy dispatcher: maps a per-record resume request to the matching CLI
 * resolver and runs the expensive on-disk scan only when called. Used by the
 * `resume`/`fork` actions, never by discovery polling.
 *
 * On miss the result carries a structured `reason` discriminant (and, for
 * codex outside-recency-window, the diagnostic session id) so the UI can
 * render an actionable toast plus a copy-manual-command escape hatch.
 *
 * Resolver roots come from `env.recoveryConfig`. The shell decides their
 * defaults (typically `~/.claude/projects` and `~/.codex/state_5.sqlite`,
 * overridable by `VOICETREE_CLAUDE_PROJECTS_DIR` / `VOICETREE_CODEX_STATE_DB`).
 */
export async function resolveNativeSessionWithEnv(
    env: RecoveryEnv,
    request: NativeSessionRequest,
): Promise<NativeSessionResult> {
    if (request.cliType === 'claude') {
        const result: ResolveClaudeResult = await resolveClaudeNativeSession(
            {terminalId: request.terminalId, projectRoot: request.projectRoot, taskNodePath: request.taskNodePath},
            defaultResolveClaudeDeps(env, env.recoveryConfig.claudeProjectsDir),
        )
        if (result.kind === 'found') {
            return {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
        }
        return {kind: 'not-found', reason: result.reason}
    }
    const result: ResolveCodexResult = resolveCodexNativeSession(
        {terminalId: request.terminalId, projectRoot: request.projectRoot, taskNodePath: request.taskNodePath},
        defaultResolveCodexDeps(env, env.recoveryConfig.codexStateDb),
    )
    if (result.kind === 'found') {
        return {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
    }
    return result.diagnosticSessionId !== undefined
        ? {kind: 'not-found', reason: result.reason, diagnosticSessionId: result.diagnosticSessionId}
        : {kind: 'not-found', reason: result.reason}
}

/**
 * Convenience binding: reads the recovery env from the configured runtime
 * registry and dispatches. Preserves the `ResolveNativeSession` shape
 * consumed by sessions/* default deps so those callers don't need env
 * threading.
 *
 * The dependency is still visible — calls `getRecoveryEnv()` which throws
 * unambiguously at the shell boundary when the runtime hasn't been wired
 * with a `RecoveryEnv`. Callers that already hold an env should call
 * `resolveNativeSessionWithEnv(env, request)` directly.
 */
export async function defaultResolveNativeSession(request: NativeSessionRequest): Promise<NativeSessionResult> {
    return resolveNativeSessionWithEnv(getRecoveryEnv(), request)
}
