import path from 'node:path'
import os from 'node:os'
import {resolveClaudeNativeSession, defaultResolveClaudeDeps, type ResolveClaudeResult} from './resolveClaudeNativeSession'
import {resolveCodexNativeSession, defaultResolveCodexDeps, type ResolveCodexResult} from './resolveCodexNativeSession'

export type NativeSessionRequest = {
    readonly cliType: 'claude' | 'codex'
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
}

export type NativeSessionResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath?: string}
    | {readonly kind: 'not-found'}

export type ResolveNativeSession = (request: NativeSessionRequest) => Promise<NativeSessionResult>

/**
 * Lazy dispatcher: maps a per-record resume request to the matching CLI
 * resolver and runs the expensive on-disk scan only when called. Used by the
 * `resume`/`fork` actions, never by discovery polling.
 *
 * Resolver roots can be overridden via env vars (useful for tests and for
 * users with non-default config locations):
 *
 * - `VOICETREE_CLAUDE_PROJECTS_DIR`  → defaults to `~/.claude/projects`
 * - `VOICETREE_CODEX_STATE_DB`       → defaults to `~/.codex/state_5.sqlite`
 */
export async function defaultResolveNativeSession(
    request: NativeSessionRequest,
): Promise<NativeSessionResult> {
    if (request.cliType === 'claude') {
        const root: string = process.env.VOICETREE_CLAUDE_PROJECTS_DIR
            ?? path.join(os.homedir(), '.claude', 'projects')
        const result: ResolveClaudeResult = resolveClaudeNativeSession(
            {terminalId: request.terminalId, projectRoot: request.projectRoot, taskNodePath: request.taskNodePath},
            defaultResolveClaudeDeps(root),
        )
        return result.kind === 'found'
            ? {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
            : {kind: 'not-found'}
    }
    const dbPath: string = process.env.VOICETREE_CODEX_STATE_DB
        ?? path.join(os.homedir(), '.codex', 'state_5.sqlite')
    const result: ResolveCodexResult = resolveCodexNativeSession(
        {terminalId: request.terminalId, projectRoot: request.projectRoot, taskNodePath: request.taskNodePath},
        defaultResolveCodexDeps(dbPath),
    )
    return result.kind === 'found'
        ? {kind: 'found', sessionId: result.sessionId, providerStorePath: result.providerStorePath}
        : {kind: 'not-found'}
}
