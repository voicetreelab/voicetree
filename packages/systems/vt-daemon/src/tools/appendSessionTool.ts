// BF-382 · Phase 3 — JSON-RPC method `metrics.appendSession`.
//
// Internal write path — primarily called by the OTLP HTTP receiver itself,
// but exposed via JSON-RPC so a CLI peer with a non-OTLP ingest path can
// also write into the same per-vault `agent_metrics.json` file. Same
// upsert semantics as `appendTokenMetrics`: a second call with the same
// `sessionId` updates the existing entry rather than pushing a duplicate.

import {appendTokenMetrics, type TokenMetrics} from '../observability/agentMetricsStore.ts'
import {getCurrentVault} from '../state/currentVault.ts'

import {buildJsonResponse} from '../agent-runtime/_shared/toolResponse.ts'
import type {McpToolResponse} from '../agent-runtime/_shared/toolResponse.ts'

export interface AppendSessionParams {
    readonly sessionId: string
    readonly tokens: TokenMetrics
    readonly costUsd: number
}

export async function appendSessionTool(params: AppendSessionParams): Promise<McpToolResponse> {
    try {
        await appendTokenMetrics(
            getCurrentVault(),
            params.sessionId,
            params.tokens,
            params.costUsd,
        )
        return buildJsonResponse(null)
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({error: message}, true)
    }
}
