// Black-box tests for the pure VTD /events interpreters. Feed a frame / a
// connection state, assert the routing decision — no sockets, no mocks.

import {describe, expect, it} from 'vitest'
import type {ConnectionState, EventFrame, GapFrame} from '@vt/vt-daemon/transport/eventTypes'
import type {ProjectedGraph} from '@vt/graph-state/contract'
import {resumeOnReconnect, routeGraphFrame} from './graphEventStream'

const PROJECTED = {nodes: [], edges: []} as unknown as ProjectedGraph

describe('routeGraphFrame', () => {
    it('routes a graph projectedGraph event to projectedGraph with its data', () => {
        const frame: EventFrame = {type: 'event', topic: 'graph', seq: 7, event: 'projectedGraph', data: PROJECTED}
        expect(routeGraphFrame(frame)).toEqual({kind: 'projectedGraph', data: PROJECTED})
    })

    it('routes a graph gap to resnapshot (a snapshot may have been conflated away)', () => {
        const gap: GapFrame = {type: 'gap', topic: 'graph', fromSeq: 1, currentSeq: 9}
        expect(routeGraphFrame(gap)).toEqual({kind: 'resnapshot'})
    })

    it('passes non-graph frames through to vt:events', () => {
        const agent: EventFrame = {
            type: 'event', topic: 'agent-events', seq: 1, event: 'hook',
            data: {terminalId: 't1', source: 'claude', at: 0},
        }
        expect(routeGraphFrame(agent)).toEqual({kind: 'passthrough'})
    })
})

describe('resumeOnReconnect', () => {
    it('owes no re-snapshot on the initial connect (no prior close)', () => {
        const connected: ConnectionState = {kind: 'connected'}
        expect(resumeOnReconnect(false, connected)).toEqual({wasDisconnected: false, resnapshot: false})
    })

    it('marks disconnected on close, then re-snapshots on the next connect', () => {
        const closed: ConnectionState = {kind: 'closed'}
        const afterClose = resumeOnReconnect(false, closed)
        expect(afterClose).toEqual({wasDisconnected: true, resnapshot: false})

        const connected: ConnectionState = {kind: 'connected'}
        const afterReconnect = resumeOnReconnect(afterClose.wasDisconnected, connected)
        expect(afterReconnect).toEqual({wasDisconnected: false, resnapshot: true})
    })

    it('re-snapshots only once per drop — a second connect without a new close does not', () => {
        const reconnected = resumeOnReconnect(true, {kind: 'connected'})
        expect(reconnected.resnapshot).toBe(true)
        const again = resumeOnReconnect(reconnected.wasDisconnected, {kind: 'connected'})
        expect(again.resnapshot).toBe(false)
    })

    it('a connecting state is inert (preserves the disconnected flag)', () => {
        expect(resumeOnReconnect(true, {kind: 'connecting', attempt: 2}))
            .toEqual({wasDisconnected: true, resnapshot: false})
    })
})
