import type {RecoveryEnv} from '@vt/agent-runtime/runtime/runtime-config'
import {resolveClaudeNativeSession, type ResolveClaudeResult, type ClaudeMissReason} from './resolveClaudeNativeSession'
import {resolveCodexNativeSession, type ResolveCodexResult, type CodexMissReason} from './resolveCodexNativeSession'

type NativeSessionRequest = {
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
export async function resolveNativeSession(
    env: RecoveryEnv,
    request: NativeSessionRequest,
): Promise<NativeSessionResult> {
    if (request.cliType === 'claude') {
        const result: ResolveClaudeResult = await resolveClaudeNativeSession(env, {
            terminalId: request.terminalId,
            projectRoot: request.projectRoot,
            taskNodePath: request.taskNodePath,
        })
        if (result.kind === 'found') {
            return {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
        }
        return {kind: 'not-found', reason: result.reason}
    }
    const result: ResolveCodexResult = resolveCodexNativeSession(env, {
        terminalId: request.terminalId,
        projectRoot: request.projectRoot,
        taskNodePath: request.taskNodePath,
    })
    if (result.kind === 'found') {
        return {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
    }
    return result.diagnosticSessionId !== undefined
        ? {kind: 'not-found', reason: result.reason, diagnosticSessionId: result.diagnosticSessionId}
        : {kind: 'not-found', reason: result.reason}
}
