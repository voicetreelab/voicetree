import {
    discoverRecoverableAgentSessions,
    defaultDiscoverRecoveryDeps,
    type DiscoverRecoveryDeps,
} from './discovery'
import {buildResumeCommand, type ResumeMode} from '../spawn/resumeCli'
import {detectCliType, type SupportedHeadlessCli} from '../spawn/headlessCli'
import {spawnTmuxBackedTerminal} from '../headless/tmuxHeadlessRuntime'
import type {RecoverableAgentSession} from './types'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'

export type ResumePersistedDeps = {
    readonly discover: () => Promise<readonly RecoverableAgentSession[]>
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
    | {readonly kind: 'stale'; readonly reason: 'not-in-discovery' | 'no-longer-resumable'}
    | {readonly kind: 'unsupported'; readonly reason: 'no-cli-detected' | 'gemini-not-supported' | 'custom-cli-not-supported' | 'empty-session-id' | 'missing-initial-command'}
    | {readonly kind: 'spawn-failed'; readonly error: string}

function findResumable(
    sessions: readonly RecoverableAgentSession[],
    terminalId: TerminalId,
): {readonly kind: 'found'; readonly session: Extract<RecoverableAgentSession, {kind: 'resumable-cli'}>}
    | {readonly kind: 'stale'; readonly reason: 'not-in-discovery' | 'no-longer-resumable'} {
    const matching: RecoverableAgentSession | undefined = sessions.find(
        (s) => (s.kind === 'resumable-cli' && s.terminalId === terminalId)
            || (s.kind === 'attachable-tmux' && s.session.terminalId === terminalId),
    )
    if (!matching) return {kind: 'stale', reason: 'not-in-discovery'}
    if (matching.kind !== 'resumable-cli') return {kind: 'stale', reason: 'no-longer-resumable'}
    return {kind: 'found', session: matching}
}

function modeFor(terminalData: TerminalData): ResumeMode {
    return terminalData.isHeadless ? 'headless' : 'interactive'
}

/**
 * Resume a persisted Claude/Codex agent session under its original terminal id.
 *
 * Flow:
 *  1. Re-runs discovery at action time and locates the resumable-cli row for
 *     `terminalId`. Stale rows (already registered, exited, deleted, now-live in
 *     tmux, no-native-handle) short-circuit without any spawn attempt.
 *  2. Builds the exact resume command via the Phase 2b pure builder using the
 *     persisted `terminalData.initialCommand` so injected hook/env flags survive.
 *  3. Spawns through `spawnTmuxBackedTerminal` with the original terminalId,
 *     persisted env vars, and original spawn directory. The spawn helper writes
 *     fresh running metadata with the new tmux session reference, so subsequent
 *     discovery no longer surfaces the row.
 *  4. If the spawn throws, the metadata file is left untouched (we never call
 *     markTerminalExited), so the row remains resumable on retry — the row also
 *     remains absent from the in-memory registry because `recordTerminalSpawn`
 *     only runs after spawn succeeds.
 */
export async function resumePersistedAgentSession(
    terminalId: TerminalId,
    deps: ResumePersistedDeps = defaultResumePersistedDeps(),
): Promise<ResumePersistedResult> {
    const sessions: readonly RecoverableAgentSession[] = await deps.discover()
    const lookup = findResumable(sessions, terminalId)
    if (lookup.kind === 'stale') return {kind: 'stale', reason: lookup.reason}

    const {session} = lookup
    const initialCommand: string | undefined = session.terminalData.initialCommand
    if (!initialCommand) return {kind: 'unsupported', reason: 'missing-initial-command'}

    const cliType: SupportedHeadlessCli | null = detectCliType(initialCommand)
    const mode: ResumeMode = modeFor(session.terminalData)
    const built = buildResumeCommand({
        cliType,
        nativeSessionId: session.nativeSessionId,
        mode,
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
        spawn: (terminalId, terminalData, command, cwd, env) =>
            spawnTmuxBackedTerminal(terminalId, terminalData, command, cwd, env),
    }
}
