/**
 * Debounced inject badge refresh - pushes unseen node counts to renderer after graph changes.
 *
 * Called from broadcastGraphDeltaToUI to keep InjectBar badges fresh.
 * Debounced to 500ms to avoid UI thrashing during bulk operations.
 */

import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getUnseenNodesForTerminal, type UnseenNodeInfo} from '@/shell/edge/main/terminals/get-unseen-nodes-for-terminal'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'

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
    const records: TerminalRecord[] = getTerminalRecords()

    // Only refresh for running agent terminals (those with a context node)
    const agentTerminals: TerminalRecord[] = records.filter(
        (r: TerminalRecord) => r.status === 'running' && r.terminalData.attachedToContextNodeId
    )

    for (const record of agentTerminals) {
        try {
            const unseenNodes: readonly UnseenNodeInfo[] = await getUnseenNodesForTerminal(record.terminalId)
            uiAPI.updateInjectBadge(record.terminalId, unseenNodes.length)
        } catch (error: unknown) {
            console.error(`[inject-badge-refresh] Failed for terminal ${record.terminalId}:`, error)
        }
    }
}
