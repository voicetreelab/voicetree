import {
    discoverRecoverableAgentSessions,
    forkAgentSession,
    removePersistedAgentRecord,
    resumePersistedAgentSession,
    type RecoverableAgentSession,
    type ResumePersistedResult,
    type TerminalId,
    type VtDaemonClient,
} from '@vt/vt-daemon-client'
import {getActiveVault, getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'

const RECOVERY_POLL_INTERVAL_MS: number = 10_000

type RendererRecoveryActionResult = {
    readonly success: boolean
    readonly terminalId?: string
    readonly error?: string
}

/**
 * Structured failure detail extracted from the runtime's `no-native-session`
 * result. Carried on the renderer-facing resume action result so the UI can
 * branch on `reason` (plain-language message) and surface a copy-manual-command
 * button when `outside-recency-window` ships with a `diagnosticSessionId`.
 */
type NoNativeSessionResult = Extract<ResumePersistedResult, {readonly kind: 'no-native-session'}>
export type RecoveryResumeFailure = {
    readonly reason: NoNativeSessionResult['reason']
    readonly cliType: NoNativeSessionResult['cliType']
    readonly diagnosticSessionId?: string
}

export type RendererRecoveryResumeResult = RendererRecoveryActionResult & {
    readonly failure?: RecoveryResumeFailure
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function publishRecoverySessions(sessions: readonly RecoverableAgentSession[]): void {
    uiAPI.syncRecoverySessions(sessions)
}

/**
 * `horizonDays`:
 * - `undefined` → use the default recency window (7 days, or
 *   `VOICETREE_RECOVERY_HORIZON_DAYS` if set).
 * - `null` → disable the cutoff entirely. The SurvivingAgents "Show older"
 *   button calls this path so users can review legacy records.
 * - finite positive number → use that many days.
 */
export async function refreshRecoverySessions(
    horizonDays?: number | null,
): Promise<readonly RecoverableAgentSession[]> {
    if (getActiveVault() === null) {
        // No vault bound yet (boot before openVault, or vault rebind in flight).
        // Publishing empty clears any stale renderer state without throwing —
        // mirrors the `getMetricsViaVtd` pattern. The poller is started before
        // bind by `app.whenReady`, so a noisy warn here would fire every 10s
        // until the user opens a project.
        publishRecoverySessions([])
        return []
    }
    try {
        const horizonMs: number | null | undefined = horizonDays === null
            ? null
            : (typeof horizonDays === 'number' ? horizonDays * 24 * 60 * 60 * 1000 : undefined)
        const client: VtDaemonClient = getVtDaemonClient()
        const sessions: readonly RecoverableAgentSession[] = await discoverRecoverableAgentSessions(
            client,
            horizonMs === undefined ? {} : {horizonMs},
        )
        publishRecoverySessions(sessions)
        return sessions
    } catch (error) {
        console.warn('[recovery-session-sync] Failed to refresh sessions:', error)
        throw error
    }
}

export function startRecoverySessionPolling(): void {
    if (pollTimer) return
    void refreshRecoverySessions().catch(() => undefined)
    pollTimer = setInterval(() => {
        void refreshRecoverySessions().catch(() => undefined)
    }, RECOVERY_POLL_INTERVAL_MS)
}

export function stopRecoverySessionPolling(): void {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = null
}

export async function resumeRecoverySession(terminalId: string): Promise<RendererRecoveryResumeResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result = await resumePersistedAgentSession(client, {terminalId: terminalId as TerminalId})
    void refreshRecoverySessions().catch(() => undefined)
    if (result.kind === 'spawned') {
        void uiAPI.launchTerminalOntoUI(
            result.terminalData.attachedToContextNodeId,
            result.terminalData,
            false,
        )
        return {success: true, terminalId}
    }
    if (result.kind === 'stale' || result.kind === 'unsupported') {
        return {success: false, terminalId, error: `Cannot resume: ${result.reason}`}
    }
    if (result.kind === 'no-native-session') {
        const failure: RecoveryResumeFailure = result.diagnosticSessionId !== undefined
            ? {reason: result.reason, cliType: result.cliType, diagnosticSessionId: result.diagnosticSessionId}
            : {reason: result.reason, cliType: result.cliType}
        return {success: false, terminalId, failure}
    }
    return {success: false, terminalId, error: result.error}
}

/**
 * Permanently delete a persisted recovery record. Returns success/error in the
 * shape the renderer store consumes. Refreshes discovery on success so the
 * Surviving Agents list reflects the new on-disk state without waiting for the
 * 10s poll. Live-registry refusals surface as a structured error rather than
 * a generic exception so the toast can explain why nothing changed.
 */
export async function removeRecoverySession(terminalId: string): Promise<RendererRecoveryActionResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result = await removePersistedAgentRecord(client, {terminalId})
    if (result.kind === 'removed') {
        void refreshRecoverySessions().catch(() => undefined)
        return {success: true, terminalId}
    }
    if (result.kind === 'invalid-id') {
        return {success: false, terminalId, error: 'Invalid terminal id'}
    }
    const reason: string = result.reason === 'live-registry-entry'
        ? 'agent is still live in the registry'
        : 'project root not available'
    return {success: false, terminalId, error: `Cannot delete: ${reason}`}
}

export async function forkRecoverySession(sourceTerminalId: string): Promise<RendererRecoveryActionResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result = await forkAgentSession(client, {sourceTerminalId: sourceTerminalId as TerminalId})
    void refreshRecoverySessions().catch(() => undefined)
    if (result.kind === 'spawned') {
        void uiAPI.launchTerminalOntoUI(
            result.terminalData.attachedToContextNodeId,
            result.terminalData,
            false,
        )
        return {success: true, terminalId: result.forkedTerminalId}
    }
    if (result.kind === 'stale' || result.kind === 'unsupported') {
        return {success: false, terminalId: sourceTerminalId, error: `Cannot fork: ${result.reason}`}
    }
    if (result.kind === 'no-native-session') {
        return {success: false, terminalId: sourceTerminalId, error: `Cannot fork: no ${result.cliType} transcript found for this terminal`}
    }
    return {success: false, terminalId: sourceTerminalId, error: result.error}
}
