/**
 * BF-379 · Phase 3 — wire serializer for the daemon's authoritative session
 * State. Lives alongside `sessionStateStore.ts` so the JSON-RPC envelope that
 * `vt_get_live_state` returns is constructed in one named place, equally
 * reachable by Electron Main (as a client) and the CLI (as a client).
 *
 * The function is the same `State → SerializedState` map exported by
 * `@vt/graph-state`; re-exported here to give vt-daemon a stable, named
 * import path next to the store that owns the data being serialised.
 */
export { serializeState } from '@vt/graph-state'
export type { SerializedState } from '@vt/graph-state'
