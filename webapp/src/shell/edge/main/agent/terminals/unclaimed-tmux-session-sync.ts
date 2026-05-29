import {
    attachUnclaimedTmuxSession as attachUnclaimedTmuxSessionRpc,
    killUnclaimedTmuxSession as killUnclaimedTmuxSessionRpc,
    listUnclaimedTmuxSessions,
    type AttachUnclaimedTmuxResult,
    type KillUnclaimedTmuxResult,
    type UnclaimedTmuxSession,
    type VtDaemonClient,
} from '@vt/vt-daemon-client'
import {getActiveVault, getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'

const UNCLAIMED_TMUX_POLL_INTERVAL_MS: number = 10_000

type RendererAttachUnclaimedTmuxResult = {
    readonly success: boolean
    readonly terminalId?: string
    readonly error?: string
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function publishUnclaimedTmuxSessions(sessions: readonly UnclaimedTmuxSession[]): void {
    uiAPI.syncUnclaimedTmuxSessions(sessions)
}

export async function refreshUnclaimedTmuxSessions(): Promise<readonly UnclaimedTmuxSession[]> {
    if (getActiveVault() === null) {
        // No vault bound yet (boot before openVault, or vault rebind in flight).
        // Publishing empty clears any stale renderer state without throwing —
        // mirrors the `getMetricsViaVtd` pattern. The poller is started before
        // bind by `app.whenReady`, so a noisy warn here would fire every 10s
        // until the user opens a project.
        publishUnclaimedTmuxSessions([])
        return []
    }
    try {
        const client: VtDaemonClient = getVtDaemonClient()
        const sessions: readonly UnclaimedTmuxSession[] = await listUnclaimedTmuxSessions(client)
        publishUnclaimedTmuxSessions(sessions)
        return sessions
    } catch (error) {
        console.warn('[unclaimed-tmux] Failed to refresh sessions:', error)
        throw error
    }
}

export function startUnclaimedTmuxSessionPolling(): void {
    if (pollTimer) return

    void refreshUnclaimedTmuxSessions().catch(() => undefined)
    pollTimer = setInterval(() => {
        void refreshUnclaimedTmuxSessions().catch(() => undefined)
    }, UNCLAIMED_TMUX_POLL_INTERVAL_MS)
}

export function stopUnclaimedTmuxSessionPolling(): void {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = null
}

export async function attachUnclaimedTmuxSession(
    sessionName: string,
): Promise<RendererAttachUnclaimedTmuxResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result: AttachUnclaimedTmuxResult =
        await attachUnclaimedTmuxSessionRpc(client, {sessionName})

    if (result.success && result.terminalData) {
        void uiAPI.launchTerminalOntoUI(result.terminalData.attachedToContextNodeId, result.terminalData, false)
    }

    void refreshUnclaimedTmuxSessions().catch(() => undefined)

    return {
        success: result.success,
        terminalId: result.terminalId,
        error: result.error,
    }
}

export async function killUnclaimedTmuxSession(sessionName: string): Promise<KillUnclaimedTmuxResult> {
    const client: VtDaemonClient = getVtDaemonClient()
    const result: KillUnclaimedTmuxResult =
        await killUnclaimedTmuxSessionRpc(client, {sessionName})

    void refreshUnclaimedTmuxSessions().catch(() => undefined)

    return result
}
