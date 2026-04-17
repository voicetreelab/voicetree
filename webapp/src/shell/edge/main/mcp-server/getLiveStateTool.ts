/**
 * BF-161 · L1-LIVE1 — MCP tool `vt_get_live_state`.
 *
 * Returns the running Electron app's live `@vt/graph-state` State as
 * `SerializedState` JSON so out-of-process consumers (e.g. `vt-graph live
 * view`) can `hydrateState` the payload and project to ASCII / Mermaid —
 * the same data layer the shell renders from.
 *
 * State composition is split:
 *   • `live-state-store.getCurrentLiveState()` (sync) — graph + collapseSet +
 *     selection + revision. Shared with BF-162 dispatch path.
 *   • `buildLiveStateSnapshot()` (async) — overlays roots + folderTree
 *     (reads vault allowlist + getDirectoryTree) and layout.positions
 *     (harvested from graph nodeUIMetadata.position).
 *
 * Gates V-L1-13/14/15/16. Also acts as the `LiveTransport.getLiveState`
 * implementation used by BF-163's CLI live-view adapter.
 */
import { serializeState, type SerializedState } from '@vt/graph-state'
import type { State } from '@vt/graph-state'

import { buildLiveStateSnapshot } from '@/shell/edge/main/state/buildLiveStateSnapshot'

import { buildJsonResponse } from './types'
import type { McpToolResponse } from './types'

export async function getLiveState(): Promise<SerializedState> {
    const state: State = await buildLiveStateSnapshot()
    return serializeState(state)
}

export async function getLiveStateTool(): Promise<McpToolResponse> {
    try {
        return buildJsonResponse(await getLiveState())
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({ error: message }, true)
    }
}
