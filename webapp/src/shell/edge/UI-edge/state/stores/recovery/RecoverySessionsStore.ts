import type {RecoverableAgentSession, ResumePersistedResult} from '@vt/vt-daemon-client'

type RecoveryCallback = (sessions: readonly RecoverableAgentSession[]) => void

type NoNativeSessionResult = Extract<ResumePersistedResult, {readonly kind: 'no-native-session'}>

/**
 * Structured failure detail propagated from the main process when a resume
 * action misses on the native session resolver. When present, the UI renders a
 * plain-language one-liner mapped from `reason` instead of a generic error,
 * and (for `outside-recency-window` with `diagnosticSessionId`) a "Copy manual
 * resume command" button.
 */
export type RecoveryResumeFailure = {
    readonly reason: NoNativeSessionResult['reason']
    readonly cliType: NoNativeSessionResult['cliType']
    readonly diagnosticSessionId?: string
}

export type RecoveryResumeResult = {
    readonly success: boolean
    readonly error?: string
    readonly failure?: RecoveryResumeFailure
}

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

/**
 * `horizonDays` plumbs through to the main process discovery:
 * - undefined → server-side default (7 days).
 * - null → disable horizon entirely ("Show older" link).
 * - number → custom day window.
 */
export async function refreshRecoverySessions(horizonDays?: number | null): Promise<void> {
    try {
        const next: readonly RecoverableAgentSession[] = await (
            window.hostAPI?.main.refreshRecoverySessions?.(horizonDays)
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
        window.hostAPI?.main.attachUnclaimedTmuxSession?.(sessionName)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function killRecoverySession(
    sessionName: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.hostAPI?.main.killUnclaimedTmuxSession?.(sessionName)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function resumeRecoverySession(
    terminalId: string,
): Promise<RecoveryResumeResult> {
    const result: RecoveryResumeResult = await (
        window.hostAPI?.main.resumeRecoverySession?.(terminalId)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function removeRecoverySession(
    terminalId: string,
): Promise<{readonly success: boolean; readonly error?: string}> {
    const result: {readonly success: boolean; readonly error?: string} = await (
        window.hostAPI?.main.removeRecoverySession?.(terminalId)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}

export async function forkRecoverySession(
    sourceTerminalId: string,
): Promise<{readonly success: boolean; readonly error?: string; readonly terminalId?: string}> {
    const result: {readonly success: boolean; readonly error?: string; readonly terminalId?: string} = await (
        window.hostAPI?.main.forkRecoverySession?.(sourceTerminalId)
        ?? Promise.resolve({success: false, error: 'Electron API unavailable'})
    )
    void refreshRecoverySessions()
    return result
}
