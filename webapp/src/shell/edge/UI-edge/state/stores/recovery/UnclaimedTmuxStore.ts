import type {UnclaimedTmuxSession} from '@vt/vt-daemon-client'

type UnclaimedTmuxCallback = (sessions: readonly UnclaimedTmuxSession[]) => void

const UNCLAIMED_TMUX_EVENT = 'vt:unclaimed-tmux-sessions'
const UNCLAIMED_TMUX_STATE_KEY = '__vtUnclaimedTmuxSessions'

type UnclaimedTmuxWindow = Window & {
    [UNCLAIMED_TMUX_STATE_KEY]?: readonly UnclaimedTmuxSession[]
}

function tmuxWindow(): UnclaimedTmuxWindow {
    return window as UnclaimedTmuxWindow
}

export function getUnclaimedTmuxSessions(): readonly UnclaimedTmuxSession[] {
    return tmuxWindow()[UNCLAIMED_TMUX_STATE_KEY] ?? []
}

export function syncUnclaimedTmuxFromMain(nextSessions: readonly UnclaimedTmuxSession[]): void {
    tmuxWindow()[UNCLAIMED_TMUX_STATE_KEY] = nextSessions
    window.dispatchEvent(new CustomEvent(UNCLAIMED_TMUX_EVENT, {detail: nextSessions}))
}

export function subscribeToUnclaimedTmuxChanges(callback: UnclaimedTmuxCallback): () => void {
    const listener = (event: Event): void => {
        callback((event as CustomEvent<readonly UnclaimedTmuxSession[]>).detail)
    }
    window.addEventListener(UNCLAIMED_TMUX_EVENT, listener)
    return () => {
        window.removeEventListener(UNCLAIMED_TMUX_EVENT, listener)
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
        getUnclaimedTmuxSessions().filter((session: UnclaimedTmuxSession) => session.sessionName !== sessionName),
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
