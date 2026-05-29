// BF-382 · Phase 3 — JSON-RPC method `metrics.getSessions`.
//
// Returns the daemon-owned agent-metrics surface as
// `{ sessions: SessionMetric[] }`. Both Electron Main (as a client) and any
// CLI peer reach the same per-vault file via this call — the daemon is the
// single authority, no Main-side `getMetrics()` re-export is involved.

import {getSessions, type SessionMetric} from '../observability/agentMetricsStore.ts'
import {getCurrentVault} from '../state/currentVault.ts'

import {buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import type {McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

export interface GetSessionsResult {
    readonly sessions: readonly SessionMetric[]
}

export async function getSessionsTool(): Promise<McpToolResponse> {
    try {
        const sessions: readonly SessionMetric[] = await getSessions(getCurrentVault())
        return buildJsonResponse({sessions} satisfies GetSessionsResult)
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({error: message}, true)
    }
}
