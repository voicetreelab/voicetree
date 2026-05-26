import type {RecoverableAgentSession} from '@vt/vt-daemon-client'

type RecoveryCallback = (sessions: readonly RecoverableAgentSession[]) => void

const RECOVERY_EVENT = 'vt:recovery-sessions'
const RECOVERY_STATE_KEY = '__vtRecoverySessions'

type RecoveryWindow = Window & {
    [RECOVERY_STATE_KEY]?: readonly RecoverableAgentSession[]
}

function recoveryWindow(): RecoveryWindow {
    return window as RecoveryWindow
}

export function getRecoverySessions(): readonly RecoverableAgentSession[] {
    return recoveryWindow()[RECOVERY_STATE_KEY] ?? []
}

export function syncRecoverySessionsFromMain(next: readonly RecoverableAgentSession[]): void {
    recoveryWindow()[RECOVERY_STATE_KEY] = next
    window.dispatchEvent(new CustomEvent(RECOVERY_EVENT, {detail: next}))
}

export function subscribeToRecoverySessions(callback: RecoveryCallback): () => void {
    const listener = (event: Event): void => {
        callback((event as CustomEvent<readonly RecoverableAgentSession[]>).detail)
    }
    window.addEventListener(RECOVERY_EVENT, listener)
    return () => {
        window.removeEventListener(RECOVERY_EVENT, listener)
    }
}

export async function refreshRecoverySessions(): Promise<void> {
    try {
        const next: readonly RecoverableAgentSession[] = await (
            window.electronAPI?.main.refreshRecoverySessions?.()
            ?? Promise.resolve([])
        )
        syncRecoverySessionsFromMain(next)
    } catch (error) {
        console.warn('[RecoverySessionsStore] Failed to refresh sessions:', error)
    }
}

export function startRecoverySessionsPolling(): void {
    // Main owns the 10s poll loop. The renderer does one mount-time refresh
    // so it can recover if the initial main push happened before ui-rpc was ready.
    void refreshRecoverySessions()
}

export function stopRecoverySessionsPolling(): void {
    return undefined
}

export function clearRecoverySessions(): void {
    syncRecoverySessionsFromMain([])
}

export async function attachRecoverySession(
    sessionName: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.electronAPI?.main.attachUnclaimedTmuxSession?.(sessionName)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function killRecoverySession(
    sessionName: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.electronAPI?.main.killUnclaimedTmuxSession?.(sessionName)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function resumeRecoverySession(
    terminalId: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.electronAPI?.main.resumeRecoverySession?.(terminalId)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function forkRecoverySession(
    sourceTerminalId: string,
): Promise<{readonly success: boolean; readonly error?: string; readonly terminalId?: string}> {
    const result: {readonly success: boolean; readonly error?: string; readonly terminalId?: string} = await (
        window.electronAPI?.main.forkRecoverySession?.(sourceTerminalId)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}
