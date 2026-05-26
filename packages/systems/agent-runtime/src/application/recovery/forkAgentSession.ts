import {
    discoverRecoverableAgentSessions,
    defaultDiscoverRecoveryDeps,
    type DiscoverRecoveryDeps,
} from './discovery'
import {buildResumeCommand, type ResumeMode} from '../spawn/cli/resumeCli'
import {spawnTmuxBackedTerminal} from '../headless/tmuxHeadlessRuntime'
import {getExistingAgentNames} from '../terminals/terminal-registry'
import {getUniqueAgentName} from '@vt/graph-model/settings'
import {
    defaultResolveNativeSession,
    type NativeSessionResult,
    type ResolveNativeSession,
} from './resolvers/resolveNativeSession'
import type {RecoverableAgentSession} from './types'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'

export type ForkAgentSessionDeps = {
    readonly discover: () => Promise<readonly RecoverableAgentSession[]>
    readonly resolveNativeSession: ResolveNativeSession
    readonly allocateForkAgentName: (sourceAgentName: string) => string
    readonly spawn: (
        terminalId: TerminalId,
        terminalData: TerminalData,
        command: string,
        cwd: string | undefined,
        env: Record<string, string>,
    ) => Promise<{readonly pid: number}>
}

export type ForkAgentSessionResult =
    | {readonly kind: 'spawned'; readonly forkedTerminalId: TerminalId; readonly pid: number; readonly command: string}
    | {readonly kind: 'stale'; readonly reason: 'not-in-discovery' | 'no-resume-handle'}
    | {readonly kind: 'no-native-session'; readonly cliType: 'claude' | 'codex'}
    | {readonly kind: 'unsupported'; readonly reason: 'gemini-not-supported' | 'custom-cli-not-supported' | 'empty-session-id' | 'missing-initial-command' | 'no-cli-detected' | 'missing-project-root'}
    | {readonly kind: 'spawn-failed'; readonly error: string}

function modeFor(terminalData: TerminalData): ResumeMode {
    return terminalData.isHeadless ? 'headless' : 'interactive'
}

/**
 * Fork a Claude/Codex agent session into a new terminal.
 *
 * Looks up `sourceTerminalId` in current discovery output. If the row has a
 * `resume` capability, resolves the native session id lazily (the expensive
 * `~/.claude/projects` scan happens once per click), then allocates a fresh
 * terminalId/agentName derived from the source's name, copies the source's
 * terminalData onto it, and spawns a new tmux-backed terminal with
 * `claude --resume <id>` / `codex resume <id>`. The fork's parent is set to
 * the source so the tree-style sidebar renders it as a child.
 *
 * Independent of whether the source is currently live (`isClaimed`) — both
 * "fork a running agent" and "fork off an orphan after recovering it" are
 * valid. For just-recover-under-the-original-id semantics, use
 * `resumePersistedAgentSession`.
 */
export async function forkAgentSession(
    sourceTerminalId: TerminalId,
    deps: ForkAgentSessionDeps = defaultForkAgentDeps(),
): Promise<ForkAgentSessionResult> {
    const sessions: readonly RecoverableAgentSession[] = await deps.discover()
    const source: RecoverableAgentSession | undefined = sessions.find((s) => s.terminalId === sourceTerminalId)
    if (!source) return {kind: 'stale', reason: 'not-in-discovery'}
    if (!source.resume) return {kind: 'stale', reason: 'no-resume-handle'}

    const initialCommand: string | undefined = source.terminalData.initialCommand
    if (!initialCommand) return {kind: 'unsupported', reason: 'missing-initial-command'}

    const projectRoot: string | undefined = source.terminalData.initialEnvVars?.VOICETREE_VAULT_PATH
    if (!projectRoot) return {kind: 'unsupported', reason: 'missing-project-root'}
    const taskNodePath: string = source.terminalData.initialEnvVars?.TASK_NODE_PATH ?? ''

    const native: NativeSessionResult = await deps.resolveNativeSession({
        cliType: source.resume.cliType,
        terminalId: sourceTerminalId,
        projectRoot,
        taskNodePath,
    })
    if (native.kind !== 'found') return {kind: 'no-native-session', cliType: source.resume.cliType}

    const built = buildResumeCommand({
        cliType: source.resume.cliType,
        nativeSessionId: native.sessionId,
        mode: modeFor(source.terminalData),
        originalCommand: initialCommand,
    })
    if (built.kind === 'unsupported') return {kind: 'unsupported', reason: built.reason}

    const forkedAgentName: string = deps.allocateForkAgentName(source.agentName)
    const forkedTerminalId: TerminalId = forkedAgentName as TerminalId
    const env: Record<string, string> = {
        ...(source.terminalData.initialEnvVars ?? {}),
        VOICETREE_TERMINAL_ID: forkedTerminalId,
        AGENT_NAME: forkedAgentName,
    }
    const forkedTerminalData: TerminalData = {
        ...source.terminalData,
        terminalId: forkedTerminalId,
        agentName: forkedAgentName,
        title: forkedAgentName,
        parentTerminalId: sourceTerminalId,
        initialEnvVars: env,
        initialCommand,  // preserve the original command so future forks/resumes have the same base
    }
    const cwd: string | undefined = source.terminalData.initialSpawnDirectory
    try {
        const result: {readonly pid: number} = await deps.spawn(
            forkedTerminalId,
            forkedTerminalData,
            built.command,
            cwd,
            env,
        )
        return {kind: 'spawned', forkedTerminalId, pid: result.pid, command: built.command}
    } catch (error) {
        return {kind: 'spawn-failed', error: error instanceof Error ? error.message : String(error)}
    }
}

export function defaultForkAgentDeps(
    discoveryDeps: DiscoverRecoveryDeps = defaultDiscoverRecoveryDeps(),
): ForkAgentSessionDeps {
    return {
        discover: () => discoverRecoverableAgentSessions(discoveryDeps),
        resolveNativeSession: defaultResolveNativeSession,
        allocateForkAgentName: (sourceAgentName: string): string => {
            return getUniqueAgentName(sourceAgentName, getExistingAgentNames())
        },
        spawn: (terminalId, terminalData, command, cwd, env) =>
            spawnTmuxBackedTerminal(terminalId, terminalData, command, cwd, env),
    }
}
