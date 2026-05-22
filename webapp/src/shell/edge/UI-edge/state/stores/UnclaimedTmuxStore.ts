import type {UnclaimedTmuxSession} from '@vt/agent-runtime'

type UnclaimedTmuxCallback = (sessions: readonly UnclaimedTmuxSession[]) => void

let sessions: readonly UnclaimedTmuxSession[] = []
const subscribers: Set<UnclaimedTmuxCallback> = new Set()

function notifySubscribers(): void {
    for (const callback of subscribers) {
        callback(sessions)
    }
}

export function getUnclaimedTmuxSessions(): readonly UnclaimedTmuxSession[] {
    return sessions
}

export function syncUnclaimedTmuxFromMain(nextSessions: readonly UnclaimedTmuxSession[]): void {
    sessions = nextSessions
    notifySubscribers()
}

export function subscribeToUnclaimedTmuxChanges(callback: UnclaimedTmuxCallback): () => void {
    subscribers.add(callback)
    return () => {
        subscribers.delete(callback)
    }
}

export async function refreshUnclaimedTmuxSessions(): Promise<void> {
    try {
        const nextSessions: readonly UnclaimedTmuxSession[] = await (
            window.electronAPI?.main.refreshUnclaimedTmuxSessions?.()
            ?? window.electronAPI?.main.listUnclaimedTmuxSessions?.()
            ?? Promise.resolve([])
        )
        syncUnclaimedTmuxFromMain(nextSessions)
    } catch (error) {
        console.warn('[UnclaimedTmuxStore] Failed to refresh sessions:', error)
    }
}

export function startUnclaimedTmuxPolling(): void {
    // Main owns the 10s poll loop. The renderer does one mount-time refresh so
    // it can recover if the initial main push happened before ui-rpc was ready.
    void refreshUnclaimedTmuxSessions()
}

export function stopUnclaimedTmuxPolling(): void {
    // Kept as a lifecycle pair for callers; no renderer interval is allocated.
    return undefined
}

export function removeUnclaimedTmuxSession(sessionName: string): void {
    syncUnclaimedTmuxFromMain(
        sessions.filter((session: UnclaimedTmuxSession) => session.sessionName !== sessionName),
    )
}

export function clearUnclaimedTmuxSessions(): void {
    syncUnclaimedTmuxFromMain([])
}

export async function attachUnclaimedTmuxSession(
    sessionName: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.electronAPI?.main.attachUnclaimedTmuxSession?.(sessionName)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    if (result.success) removeUnclaimedTmuxSession(sessionName)
    void refreshUnclaimedTmuxSessions()
    return result
}

export async function killUnclaimedTmuxSession(
    sessionName: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.electronAPI?.main.killUnclaimedTmuxSession?.(sessionName)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    if (result.success) removeUnclaimedTmuxSession(sessionName)
    void refreshUnclaimedTmuxSessions()
    return result
}
