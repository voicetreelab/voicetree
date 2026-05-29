/**
 * Debounced inject badge refresh - pushes unseen node counts to renderer after graph changes.
 *
 * Called after graph changes to keep InjectBar badges fresh.
 * Debounced to 500ms to avoid UI thrashing during bulk operations.
 */

import type {TerminalRecord, UnseenNodeInfo} from '@vt/vt-daemon-client'
import {getCachedTerminalRecords} from '@/shell/edge/main/agent/terminals/terminal-registry-bridge'
import {getVtDaemonFacade} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'

const DEBOUNCE_MS: number = 500
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Refresh inject badge counts for all running agent terminals.
 * Debounced to 500ms - safe to call on every graph delta.
 */
export function refreshAllInjectBadges(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null
        void doRefreshAllInjectBadges()
    }, DEBOUNCE_MS)
}

async function doRefreshAllInjectBadges(): Promise<void> {
    const records: readonly TerminalRecord[] = getCachedTerminalRecords()

    // Only refresh for running agent terminals (those with a context node)
    const agentTerminals: readonly TerminalRecord[] = records.filter(
        (r: TerminalRecord): boolean => r.status === 'running' && r.terminalData.attachedToContextNodeId !== null,
    )

    await Promise.all(agentTerminals.map(async (record: TerminalRecord): Promise<void> => {
        try {
            const unseenNodes: readonly UnseenNodeInfo[] =
                await getVtDaemonFacade().terminals.getUnseenNodesForTerminal({terminalId: record.terminalId})
            uiAPI.updateInjectBadge(record.terminalId, unseenNodes.length)
        } catch (error: unknown) {
            console.error(`[inject-badge-refresh] Failed for terminal ${record.terminalId}:`, error)
        }
    }))
}
