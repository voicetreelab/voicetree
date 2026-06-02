import path from 'node:path'
import os from 'node:os'
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
import {getRecoveryHorizonMs} from '../horizon'

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
 * Resolver roots can be overridden via env vars (useful for tests and for
 * users with non-default config locations):
 *
 * - `VOICETREE_CLAUDE_PROJECTS_DIR`  → defaults to `~/.claude/projects`
 * - `VOICETREE_CODEX_STATE_DB`       → defaults to `~/.codex/state_5.sqlite`
 *
 * The resolver recency window is the discovery horizon (`getRecoveryHorizonMs()`,
 * default 7d, `VOICETREE_RECOVERY_HORIZON_DAYS`) — a single source of truth, so
 * every row that discovery surfaces a Resume button for is actually resolvable.
 */
export async function defaultResolveNativeSession(
    request: NativeSessionRequest,
): Promise<NativeSessionResult> {
    const recencyWindowMs: number = getRecoveryHorizonMs()
    if (request.cliType === 'claude') {
        const root: string = process.env.VOICETREE_CLAUDE_PROJECTS_DIR
            ?? path.join(os.homedir(), '.claude', 'projects')
        const result: ResolveClaudeResult = await resolveClaudeNativeSession(
            {terminalId: request.terminalId, projectRoot: request.projectRoot, taskNodePath: request.taskNodePath, recencyWindowMs},
            defaultResolveClaudeDeps(root),
        )
        if (result.kind === 'found') {
            return {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
        }
        return result.diagnosticSessionId !== undefined
            ? {kind: 'not-found', reason: result.reason, diagnosticSessionId: result.diagnosticSessionId}
            : {kind: 'not-found', reason: result.reason}
    }
    const dbPath: string = process.env.VOICETREE_CODEX_STATE_DB
        ?? path.join(os.homedir(), '.codex', 'state_5.sqlite')
    const result: ResolveCodexResult = resolveCodexNativeSession(
        {terminalId: request.terminalId, projectRoot: request.projectRoot, taskNodePath: request.taskNodePath, recencyWindowMs},
        defaultResolveCodexDeps(dbPath),
    )
    if (result.kind === 'found') {
        return {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
    }
    return result.diagnosticSessionId !== undefined
        ? {kind: 'not-found', reason: result.reason, diagnosticSessionId: result.diagnosticSessionId}
        : {kind: 'not-found', reason: result.reason}
}
