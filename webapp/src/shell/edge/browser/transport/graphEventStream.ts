// Pure interpretation of the single VTD /events stream for graph live-updates.
//
// Under the gateway model graph snapshots ride the EXISTING VTD /events WS on
// topic `'graph'` (VTD folds graphd's projectedGraph SSE in). The browser has
// one stream and one reconnect loop. These two pure functions are the decisions
// the shell (browserRuntime) acts on; keeping them pure makes the live-update
// routing — exactly the class of wiring that silently broke terminals before —
// black-box testable without a socket.

import type {ConnectionState, EventFrame, GapFrame} from '@vt/vt-daemon/transport/eventTypes'
import type {ProjectedGraph} from '@vt/graph-state/contract'

/** What the shell should do with one frame off the VTD /events WS. */
export type GraphFrameRoute =
    // graph event — carries a full ProjectedGraph snapshot to emit
    | {readonly kind: 'projectedGraph'; readonly data: ProjectedGraph}
    // graph gap — a snapshot may have been conflated away; re-fetch over RPC
    | {readonly kind: 'resnapshot'}
    // non-graph (agent-events / terminal-registry) — forward to vt:events
    | {readonly kind: 'passthrough'}

export function routeGraphFrame(frame: EventFrame | GapFrame): GraphFrameRoute {
    if (frame.topic !== 'graph') return {kind: 'passthrough'}
    return frame.type === 'event'
        ? {kind: 'projectedGraph', data: frame.data}
        : {kind: 'resnapshot'}
}

/**
 * Resume detector for the WS. A full re-snapshot is owed only on a GENUINE
 * reconnect — `connected` after a prior `closed` — because graph frames may
 * have been missed while offline. The initial connect (no prior close) owes
 * nothing: boot already loaded the snapshot via `graph.openProject`. Fold this
 * over each `ConnectionState`, threading `wasDisconnected`.
 */
export function resumeOnReconnect(
    wasDisconnected: boolean,
    state: ConnectionState,
): {readonly wasDisconnected: boolean; readonly resnapshot: boolean} {
    if (state.kind === 'closed') return {wasDisconnected: true, resnapshot: false}
    if (state.kind === 'connected' && wasDisconnected) return {wasDisconnected: false, resnapshot: true}
    return {wasDisconnected, resnapshot: false}
}
