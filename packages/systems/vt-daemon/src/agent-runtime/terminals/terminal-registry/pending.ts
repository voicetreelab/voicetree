import {
    pendingTerminals,
    terminalRecords,
    type PendingTerminal,
} from '../terminal-registry-state'

/**
 * Reserve a terminalId before its PTY/process exists. Used by spawn_agent
 * to return its RPC response early while terminal prep runs in the background.
 *
 * No-op if the terminal is already registered (running) — the running record
 * wins. The pending entry is cleared on recordTerminalSpawn or
 * clearPendingTerminal (e.g. on spawn failure).
 */
export function recordTerminalPending(terminalId: string, isHeadless: boolean): void {
    if (terminalRecords.has(terminalId)) return
    if (pendingTerminals.has(terminalId)) return
    pendingTerminals.set(terminalId, { isHeadless, queuedMessages: [] })
}

export function getPendingTerminal(terminalId: string): { readonly isHeadless: boolean } | undefined {
    const pending: PendingTerminal | undefined = pendingTerminals.get(terminalId)
    return pending ? { isHeadless: pending.isHeadless } : undefined
}

export function getPendingTerminals(): Array<{ readonly terminalId: string; readonly isHeadless: boolean }> {
    return [...pendingTerminals.entries()].map(([terminalId, pending]: [string, PendingTerminal]) => ({
        terminalId,
        isHeadless: pending.isHeadless,
    }))
}

/**
 * Queue a (pre-formatted) message for a pending terminal. Messages are sent
 * via sendTextToTerminal in arrival order during recordTerminalSpawn.
 *
 * Returns true if queued, false if the terminal isn't pending (caller should
 * fall through to the normal send path or surface a "not found" error).
 */
export function enqueuePendingMessage(terminalId: string, prefixedMessage: string): boolean {
    const pending: PendingTerminal | undefined = pendingTerminals.get(terminalId)
    if (!pending) return false
    pending.queuedMessages.push(prefixedMessage)
    return true
}

/**
 * Drop a pending terminal entry without draining. For use when async spawn
 * prep fails — the caller's RPC response said success, but follow-up tool
 * calls will now correctly report "Terminal not found".
 */
export function clearPendingTerminal(terminalId: string): void {
    pendingTerminals.delete(terminalId)
}
