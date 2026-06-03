import {detectSupportedCliFromMetadata} from './classifier'
import {
    defaultResolveNativeSession,
    type ResolveNativeSession,
} from './resolvers/resolveNativeSession'
import type {
    NativeRecoveryHandle,
    TmuxTerminalMetadata,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-metadata.ts'

function nativeSourceFor(cli: 'claude' | 'codex'): NativeRecoveryHandle['source'] {
    return cli === 'claude' ? 'claude-project-transcript' : 'codex-state-index'
}

/**
 * Best-effort resolution of a durable native resume handle for a
 * Claude/Codex terminal, intended to be called at the close/exit lifecycle
 * transition (when the provider transcript reliably exists on disk).
 *
 * Returns `null` — never throws — when the handle should not be (re)written:
 *
 * - the record already carries `recovery.native` (preserve the existing one;
 *   the first capture wins and the durable id never churns),
 * - the metadata does not target a supported CLI (`claude`/`codex`),
 * - the metadata lacks `VOICETREE_PROJECT_PATH` (resolver cannot scope a scan),
 * - the resolver could not deterministically locate the provider session.
 *
 * A non-null return is a complete `NativeRecoveryHandle` ready to merge into
 * `metadata.recovery.native`. This is the D3 capture primitive: persisting the
 * handle eagerly at exit means resume reads it straight from the terminal JSON
 * instead of re-running the ambiguous `~/.claude/projects` recency scan.
 */
export async function captureNativeRecoveryHandle(
    terminalId: string,
    metadata: TmuxTerminalMetadata,
    resolveNativeSession: ResolveNativeSession = defaultResolveNativeSession,
): Promise<NativeRecoveryHandle | null> {
    if (metadata.recovery?.native) return null
    const cliType: 'claude' | 'codex' | null = detectSupportedCliFromMetadata(metadata)
    if (!cliType) return null
    const env: Record<string, string> | undefined = metadata.terminalData?.initialEnvVars
    const projectRoot: string | undefined = env?.VOICETREE_PROJECT_PATH
    if (!projectRoot) return null
    const taskNodePath: string = env?.TASK_NODE_PATH ?? ''

    const result = await resolveNativeSession({cliType, terminalId, projectRoot, taskNodePath})
    if (result.kind !== 'found') return null

    return {
        cli: cliType,
        mode: metadata.terminalData?.isHeadless ? 'headless' : 'interactive',
        sessionId: result.sessionId,
        capturedAt: new Date().toISOString(),
        source: nativeSourceFor(cliType),
        ...(result.providerStorePath ? {providerStorePath: result.providerStorePath} : {}),
    }
}
