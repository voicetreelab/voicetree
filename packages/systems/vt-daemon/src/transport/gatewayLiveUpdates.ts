// Gateway live-update pump (RE-PLAN B). VTD owns ONE graphd session for the
// project and pumps graphd's projectedGraph SSE snapshots onto its existing
// /events hub as the `graph` topic, so the browser receives live graph updates
// over the single connection it already holds — it never reaches graphd.
//
// This module is the single owner of the VTD-side graphd session + pump
// lifecycle. `ensureSession()` is the ordering gate the graph.* routes await:
// the first call creates the session and starts the SSE subscription; later
// calls return the cached id with no graphd round-trip. The session id it
// returns is the SAME id threaded through every session-scoped graph.* call —
// one session, end to end.
//
// Functional shell: deps (client, publish sink, error sink) are injected at the
// edge (bin/vtd.ts). No module-level cell.

import type {GraphDbClient} from '@vt/graph-db-client'
import {subscribeProjectedGraph} from '@vt/graph-db-client'
import type {ProjectedGraph} from '@vt/graph-state/contract'

export interface GatewayLiveUpdatesDeps {
    readonly client: GraphDbClient
    /** Publish one snapshot onto the hub `graph` topic. */
    readonly publishGraphSnapshot: (snapshot: ProjectedGraph) => void
    /**
     * Surface a pump transport error (SSE open/read failure). Live state still
     * recovers via the browser's WS reconnect → `graph.getProjectedGraph`
     * re-snapshot path; automatic graphd-restart re-subscription is a separate
     * hardening (see RE-PLAN B risks).
     */
    readonly onError?: (err: unknown) => void
}

export interface GatewayLiveUpdates {
    /**
     * Idempotent: ensure VTD's single graphd session exists and the
     * projectedGraph→hub pump is running; returns the session id. Concurrent
     * first calls share one in-flight creation.
     */
    readonly ensureSession: () => Promise<string>
    /** Tear down the SSE subscription (daemon shutdown). */
    readonly stop: () => void
}

export function createGatewayLiveUpdates(deps: GatewayLiveUpdatesDeps): GatewayLiveUpdates {
    const {client, publishGraphSnapshot, onError} = deps

    let sessionId: string | null = null
    let creating: Promise<string> | null = null
    let unsubscribe: (() => void) | null = null
    let stopped = false

    function startPump(sid: string): void {
        if (unsubscribe !== null) return // single subscription per session
        unsubscribe = subscribeProjectedGraph(
            client.baseUrl,
            sid,
            (snapshot: ProjectedGraph): void => {
                if (!stopped) publishGraphSnapshot(snapshot)
            },
            (err: unknown): void => onError?.(err),
        )
    }

    async function ensureSession(): Promise<string> {
        if (sessionId !== null) return sessionId
        if (creating !== null) return creating
        creating = (async (): Promise<string> => {
            const created = await client.createSession()
            sessionId = created.sessionId
            startPump(sessionId)
            return sessionId
        })()
        try {
            return await creating
        } finally {
            creating = null
        }
    }

    function stop(): void {
        stopped = true
        if (unsubscribe !== null) {
            unsubscribe()
            unsubscribe = null
        }
    }

    return {ensureSession, stop}
}
