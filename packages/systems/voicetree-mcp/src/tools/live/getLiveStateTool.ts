/**
 * BF-161 · L1-LIVE1 — MCP tool `vt_get_live_state`.
 *
 * Returns the running Electron app's live `@vt/graph-state` State as
 * `SerializedState` JSON so out-of-process consumers (e.g. `vt-graph live
 * view`) can `hydrateState` the payload and project to ASCII / Mermaid —
 * the same data layer the shell renders from.
 *
 * State composition is delegated through the graph daemon boundary. Electron
 * main owns renderer session state, then asks vt-graphd for the canonical graph
 * snapshot so daemon-backed storage stays in the Node daemon process.
 *
 * Gates V-L1-13/14/15/16. Also acts as the `LiveTransport.getLiveState`
 * implementation used by BF-163's CLI live-view adapter.
 */
import type { SerializedState } from '@vt/graph-state'
import { getLiveStateBridge } from '../mcpConfigDependencies'

import { buildJsonResponse } from '../toolResponse'
import type { McpToolResponse } from '../toolResponse'

export async function getLiveState(): Promise<SerializedState | null> {
    return await getLiveStateBridge().getLiveStateSnapshot()
}

export async function getLiveStateTool(): Promise<McpToolResponse> {
    try {
        const state: SerializedState | null = await getLiveState()
        if (!state) return buildJsonResponse({ error: 'No vault loaded yet' }, true)
        return buildJsonResponse(state)
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({ error: message }, true)
    }
}
