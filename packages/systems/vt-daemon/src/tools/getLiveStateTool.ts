/**
 * BF-379 · Phase 3 — JSON-RPC method `vt_get_live_state`.
 *
 * Returns the daemon-owned session State as a `SerializedState` envelope.
 * Both Electron Main (as a client) and any CLI (as a client) reach the same
 * wire shape — the daemon is the single authority, no bridge to renderer
 * state is involved.
 */
import type { SerializedState } from '@vt/graph-state'

import { getCurrentSessionState } from '../state/sessionStateStore'
import { serializeState } from '../state/serializeState'
import { getCurrentProject } from '../state/currentProject'

import { buildJsonResponse } from '@vt/vt-daemon/_shared/toolResponse.ts'
import type { McpToolResponse } from '@vt/vt-daemon/_shared/toolResponse.ts'

export async function getLiveState(): Promise<SerializedState> {
    return serializeState(await getCurrentSessionState(getCurrentProject()))
}

export async function getLiveStateTool(): Promise<McpToolResponse> {
    try {
        const state: SerializedState = await getLiveState()
        return buildJsonResponse(state)
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({ error: message }, true)
    }
}
