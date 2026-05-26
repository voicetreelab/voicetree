import {
    attachUnclaimedTmuxSession as attachUnclaimedTmuxSessionRpc,
    ensureVtDaemonForVault,
    killUnclaimedTmuxSession as killUnclaimedTmuxSessionRpc,
    listUnclaimedTmuxSessions,
    type AttachUnclaimedTmuxResult,
    type KillUnclaimedTmuxResult,
    type UnclaimedTmuxSession,
    type VtDaemonClient,
} from '@vt/vt-daemon-client'
import {getActiveVault} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'

const UNCLAIMED_TMUX_POLL_INTERVAL_MS: number = 10_000

type RendererAttachUnclaimedTmuxResult = {
    readonly success: boolean
    readonly terminalId?: string
    readonly error?: string
}

let pollTimer: ReturnType<typeof setInterval> | null = null

async function getVtDaemonClient(): Promise<VtDaemonClient> {
    const vaultPath: string | null = getActiveVault()
    if (!vaultPath) throw new Error('unclaimed-tmux-session-sync: no active vt-daemon binding')
    const {client} = await ensureVtDaemonForVault(vaultPath, 'electron')
    return client
}

function publishUnclaimedTmuxSessions(sessions: readonly UnclaimedTmuxSession[]): void {
    uiAPI.syncUnclaimedTmuxSessions(sessions)
}

export async function refreshUnclaimedTmuxSessions(): Promise<readonly UnclaimedTmuxSession[]> {
    try {
        const client: VtDaemonClient = await getVtDaemonClient()
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
    const client: VtDaemonClient = await getVtDaemonClient()
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
    const client: VtDaemonClient = await getVtDaemonClient()
    const result: KillUnclaimedTmuxResult =
        await killUnclaimedTmuxSessionRpc(client, {sessionName})

    void refreshUnclaimedTmuxSessions().catch(() => undefined)

    return result
}
