import {
    discoverRecoverableAgentSessions,
    forkAgentSession,
    resumePersistedAgentSession,
    type RecoverableAgentSession,
    type TerminalId,
    type VtDaemonClient,
} from '@vt/vt-daemon-client'
import {getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'

const RECOVERY_POLL_INTERVAL_MS: number = 10_000

type RendererRecoveryActionResult = {
    readonly success: boolean
    readonly terminalId?: string
    readonly error?: string
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function publishRecoverySessions(sessions: readonly RecoverableAgentSession[]): void {
    uiAPI.syncRecoverySessions(sessions)
}

export async function refreshRecoverySessions(): Promise<readonly RecoverableAgentSession[]> {
    try {
        const client: VtDaemonClient = getVtDaemonClient()
        const sessions: readonly RecoverableAgentSession[] = await discoverRecoverableAgentSessions(client)
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

export async function resumeRecoverySession(terminalId: string): Promise<RendererRecoveryActionResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result = await resumePersistedAgentSession(client, {terminalId: terminalId as TerminalId})
    void refreshRecoverySessions().catch(() => undefined)
    if (result.kind === 'spawned') {
        return {success: true, terminalId}
    }
    if (result.kind === 'stale' || result.kind === 'unsupported') {
        return {success: false, terminalId, error: `Cannot resume: ${result.reason}`}
    }
    if (result.kind === 'no-native-session') {
        return {success: false, terminalId, error: `Cannot resume: no ${result.cliType} transcript found for this terminal`}
    }
    return {success: false, terminalId, error: result.error}
}

export async function forkRecoverySession(sourceTerminalId: string): Promise<RendererRecoveryActionResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result = await forkAgentSession(client, {sourceTerminalId: sourceTerminalId as TerminalId})
    void refreshRecoverySessions().catch(() => undefined)
    if (result.kind === 'spawned') {
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
