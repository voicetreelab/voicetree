import path from 'node:path'
import {detectCliType} from '../spawn/headlessCli'
import {getTerminalRecords, type TerminalRecord} from '../terminals/terminal-registry'
import {readMetadata, type TmuxTerminalMetadata} from '../terminals/terminal-registry/terminal-metadata'
import {persistRecoveryNative, type PersistRecoveryRequest, type PersistRecoveryResult} from './persistRecoveryNative'
import {resolveClaudeNativeSession, type ResolveClaudeRequest, type ResolveClaudeResult} from './resolvers/resolveClaudeNativeSession'
import {resolveCodexNativeSession, type ResolveCodexRequest, type ResolveCodexResult} from './resolvers/resolveCodexNativeSession'

export type CaptureMissingNativeSessionsDeps = {
    readonly getTerminalRecords: () => readonly TerminalRecord[]
    readonly readMetadataAt: (metadataPath: string) => TmuxTerminalMetadata | null
    readonly resolveClaude: (request: ResolveClaudeRequest) => ResolveClaudeResult
    readonly resolveCodex: (request: ResolveCodexRequest) => ResolveCodexResult
    readonly persist: (request: PersistRecoveryRequest) => PersistRecoveryResult
}

/**
 * Opportunistic capture of `recovery.native.sessionId` for live Claude/Codex
 * terminals whose metadata file is still missing the handle.
 *
 * Design intent (per the resume-surviving-agent-sessions OpenSpec follow-up):
 * no new timer, no new lifecycle event. Called on every tick of the existing
 * recovery-session-sync poll. For each live Claude/Codex terminal:
 *
 *   1. Skip if not Claude/Codex (detectCliType).
 *   2. Skip if metadata file missing or already has recovery.native.sessionId.
 *   3. Run the matching resolver. On `found`, persist the handle atomically.
 *
 * Eventually consistent: until the resolver finds a match, each tick retries.
 * Once captured, subsequent ticks short-circuit on the metadata read.
 *
 * Returns the number of sessions newly captured this call (for observability/tests).
 */
export function captureMissingNativeSessions(
    deps: CaptureMissingNativeSessionsDeps = defaultCaptureDeps(),
): number {
    const records: readonly TerminalRecord[] = deps.getTerminalRecords()
    let captured: number = 0
    for (const record of records) {
        if (tryCaptureForRecord(record, deps)) captured += 1
    }
    return captured
}

function tryCaptureForRecord(
    record: TerminalRecord,
    deps: CaptureMissingNativeSessionsDeps,
): boolean {
    const initialCommand: string | undefined = record.terminalData.initialCommand
    if (!initialCommand) return false
    const cliType = detectCliType(initialCommand)
    if (cliType !== 'claude' && cliType !== 'codex') return false

    const env: Record<string, string> = record.terminalData.initialEnvVars ?? {}
    const vaultPath: string | undefined = env.VOICETREE_VAULT_PATH
    if (!vaultPath) return false

    const metadataPath: string = path.join(vaultPath, '.voicetree', 'terminals', `${record.terminalId}.json`)
    const metadata: TmuxTerminalMetadata | null = deps.readMetadataAt(metadataPath)
    if (!metadata) return false
    if (metadata.recovery?.native?.sessionId) return false

    const request = {
        terminalId: record.terminalId,
        vaultPath,
        taskNodePath: env.TASK_NODE_PATH ?? '',
    } as const

    const result: ResolveClaudeResult | ResolveCodexResult = cliType === 'claude'
        ? deps.resolveClaude(request)
        : deps.resolveCodex(request)
    if (result.kind !== 'found') return false

    const persisted: PersistRecoveryResult = deps.persist({
        metadataPath,
        cli: cliType,
        mode: record.terminalData.isHeadless ? 'headless' : 'interactive',
        sessionId: result.sessionId,
        source: cliType === 'claude' ? 'claude-project-transcript' : 'codex-state-index',
        ...(result.providerStorePath ? {providerStorePath: result.providerStorePath} : {}),
    })
    return persisted.kind === 'persisted'
}

export function defaultCaptureDeps(): CaptureMissingNativeSessionsDeps {
    return {
        getTerminalRecords: () => getTerminalRecords(),
        readMetadataAt: readMetadata,
        resolveClaude: (request) => resolveClaudeNativeSession(request),
        resolveCodex: (request) => resolveCodexNativeSession(request),
        persist: (request) => persistRecoveryNative(request),
    }
}
