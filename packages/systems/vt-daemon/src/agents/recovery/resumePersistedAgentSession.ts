import {
    discoverRecoverableAgentSessions,
    defaultDiscoverRecoveryDeps,
    type DiscoverRecoveryDeps,
} from './discovery'
import {buildResumeCommand, type ResumeMode} from '@vt/vt-daemon/spawn/cli/resumeCli.ts'
import {spawnTmuxBackedTerminal} from '../headless/tmuxHeadlessRuntime'
import {
    defaultResolveNativeSession,
    type NativeSessionResult,
    type ResolveNativeSession,
} from './resolvers/resolveNativeSession'
import type {RecoverableAgentSession} from './types'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/terminals/terminal-registry/types.ts'

export type ResumePersistedDeps = {
    readonly discover: () => Promise<readonly RecoverableAgentSession[]>
    readonly resolveNativeSession: ResolveNativeSession
    readonly spawn: (
        terminalId: TerminalId,
        terminalData: TerminalData,
        command: string,
        cwd: string | undefined,
        env: Record<string, string>,
    ) => Promise<{readonly pid: number}>
}

export type ResumePersistedResult =
    | {readonly kind: 'spawned'; readonly pid: number; readonly command: string}
    | {readonly kind: 'stale'; readonly reason: 'not-in-discovery' | 'already-claimed' | 'no-resume-handle'}
    | {readonly kind: 'no-native-session'; readonly cliType: 'claude' | 'codex'}
    | {readonly kind: 'unsupported'; readonly reason: 'gemini-not-supported' | 'custom-cli-not-supported' | 'empty-session-id' | 'missing-initial-command' | 'no-cli-detected' | 'missing-project-root'}
    | {readonly kind: 'spawn-failed'; readonly error: string}

function modeFor(terminalData: TerminalData): ResumeMode {
    return terminalData.isHeadless ? 'headless' : 'interactive'
}

/**
 * Recover an orphaned Claude/Codex agent session under its original terminal id.
 *
 * Looks up `terminalId` in current discovery output and acts only if the row is
 * unclaimed (no live in-memory registry entry) and carries a `resume`
 * capability. Resolves the native session id LAZILY here (the expensive scan
 * of `~/.claude/projects` happens once per click — never on the 10s discovery
 * poll). Spawns a new tmux-backed terminal with the resume command under the
 * original terminalId — registry slot is reclaimed.
 *
 * For forking a live agent into a new tab, use `forkAgentSession` instead.
 *
 * Stale rows (already claimed, no resume capability, deleted, foreign vault)
 * short-circuit without any spawn or resolver work. When the resolver returns
 * not-found the result is `{kind: 'no-native-session'}` so the UI can surface
 * a clean message instead of a generic spawn failure.
 */
export async function resumePersistedAgentSession(
    terminalId: TerminalId,
    deps: ResumePersistedDeps = defaultResumePersistedDeps(),
): Promise<ResumePersistedResult> {
    const sessions: readonly RecoverableAgentSession[] = await deps.discover()
    const session: RecoverableAgentSession | undefined = sessions.find((s) => s.terminalId === terminalId)
    if (!session) return {kind: 'stale', reason: 'not-in-discovery'}
    if (session.isClaimed) return {kind: 'stale', reason: 'already-claimed'}
    if (!session.resume) return {kind: 'stale', reason: 'no-resume-handle'}

    const initialCommand: string | undefined = session.terminalData.initialCommand
    if (!initialCommand) return {kind: 'unsupported', reason: 'missing-initial-command'}

    const projectRoot: string | undefined = session.terminalData.initialEnvVars?.VOICETREE_VAULT_PATH
    if (!projectRoot) return {kind: 'unsupported', reason: 'missing-project-root'}
    const taskNodePath: string = session.terminalData.initialEnvVars?.TASK_NODE_PATH ?? ''

    const native: NativeSessionResult = await deps.resolveNativeSession({
        cliType: session.resume.cliType,
        terminalId,
        projectRoot,
        taskNodePath,
    })
    if (native.kind !== 'found') return {kind: 'no-native-session', cliType: session.resume.cliType}

    const built = buildResumeCommand({
        cliType: session.resume.cliType,
        nativeSessionId: native.sessionId,
        mode: modeFor(session.terminalData),
        originalCommand: initialCommand,
    })
    if (built.kind === 'unsupported') return {kind: 'unsupported', reason: built.reason}

    const env: Record<string, string> = session.terminalData.initialEnvVars ?? {}
    const cwd: string | undefined = session.terminalData.initialSpawnDirectory
    try {
        const result: {readonly pid: number} = await deps.spawn(
            terminalId,
            session.terminalData,
            built.command,
            cwd,
            env,
        )
        return {kind: 'spawned', pid: result.pid, command: built.command}
    } catch (error) {
        return {kind: 'spawn-failed', error: error instanceof Error ? error.message : String(error)}
    }
}

export function defaultResumePersistedDeps(
    discoveryDeps: DiscoverRecoveryDeps = defaultDiscoverRecoveryDeps(),
): ResumePersistedDeps {
    return {
        discover: () => discoverRecoverableAgentSessions(discoveryDeps),
        resolveNativeSession: defaultResolveNativeSession,
        spawn: (terminalId, terminalData, command, cwd, env) =>
            spawnTmuxBackedTerminal(terminalId, terminalData, command, cwd, env),
    }
}
