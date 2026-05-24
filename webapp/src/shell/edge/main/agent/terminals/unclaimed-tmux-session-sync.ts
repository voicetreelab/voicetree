import type {
    AttachUnclaimedTmuxResult,
    KillUnclaimedTmuxResult,
    UnclaimedTmuxSession,
} from '@vt/agent-runtime'
import {terminalRuntimeSurface} from '@/shell/edge/main/agent/terminals/terminalRuntimeSurface'
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
    try {
        const sessions: readonly UnclaimedTmuxSession[] = await terminalRuntimeSurface.listUnclaimedTmuxSessions()
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
    const result: AttachUnclaimedTmuxResult =
        await terminalRuntimeSurface.attachUnclaimedTmuxSession(sessionName)

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
    const result: KillUnclaimedTmuxResult =
        await terminalRuntimeSurface.killUnclaimedTmuxSession(sessionName)

    void refreshUnclaimedTmuxSessions().catch(() => undefined)

    return result
}
