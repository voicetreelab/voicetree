/**
 * Black-box tests for agent-hook telemetry.
 *
 * Pure snapshot aggregation: feed an event list, assert the resulting
 * counts. Edge layer: ring-buffer + sink fan-out via a custom in-test
 * sink (no mocks).
 */

import {describe, it, expect, beforeEach} from 'vitest'
import {
    computeTelemetrySnapshot,
    configureTelemetrySink,
    getTierTelemetrySnapshot,
    recordTierEvent,
    __clearTierTelemetryForTests,
    type TierEvent,
} from '../tierTelemetry'

function evt(over: Partial<TierEvent> & {kind: TierEvent['kind']}): TierEvent {
    return {
        ts: 1_000_000,
        terminalId: 'cc-1',
        agentTypeName: 'Claude',
        kind: over.kind,
        ...over,
    }
}

describe('computeTelemetrySnapshot — pure aggregation', () => {
    it('empty input → zeros and null timestamps', () => {
        const snap = computeTelemetrySnapshot([])
        expect(snap.totalEvents).toBe(0)
        expect(snap.byKind).toEqual({working: 0, awaiting_input: 0, done: 0, failed: 0})
        expect(snap.firstEventAt).toBeNull()
        expect(snap.lastEventAt).toBeNull()
    })

    it('counts each kind separately', () => {
        const events: TierEvent[] = [
            evt({kind: 'awaiting_input', ts: 1}),
            evt({kind: 'awaiting_input', ts: 2}),
            evt({kind: 'working', ts: 3}),
            evt({kind: 'done', ts: 4}),
        ]
        const snap = computeTelemetrySnapshot(events)
        expect(snap.totalEvents).toBe(4)
        expect(snap.byKind.awaiting_input).toBe(2)
        expect(snap.byKind.working).toBe(1)
        expect(snap.byKind.done).toBe(1)
    })

    it('groups by agent type with per-kind breakdown', () => {
        const events: TierEvent[] = [
            evt({kind: 'awaiting_input', agentTypeName: 'Claude'}),
            evt({kind: 'working', agentTypeName: 'Claude'}),
            evt({kind: 'awaiting_input', agentTypeName: 'Codex'}),
            evt({kind: 'working', agentTypeName: ''}),
        ]
        const snap = computeTelemetrySnapshot(events)
        expect(snap.byAgent.Claude.count).toBe(2)
        expect(snap.byAgent.Claude.byKind).toEqual({working: 1, awaiting_input: 1, done: 0, failed: 0})
        expect(snap.byAgent.Codex.count).toBe(1)
        expect(snap.byAgent.Codex.byKind.awaiting_input).toBe(1)
        expect(snap.byAgent['(unknown)'].count).toBe(1)
    })

    it('records first/last event timestamps as ISO strings', () => {
        const events: TierEvent[] = [
            evt({kind: 'awaiting_input', ts: 3_000}),
            evt({kind: 'working', ts: 1_000}),
            evt({kind: 'done', ts: 5_000}),
        ]
        const snap = computeTelemetrySnapshot(events)
        expect(snap.firstEventAt).toBe(new Date(1_000).toISOString())
        expect(snap.lastEventAt).toBe(new Date(5_000).toISOString())
    })
})

describe('edge layer — in-memory ring buffer + sink fan-out', () => {
    beforeEach(() => __clearTierTelemetryForTests())

    it('recordTierEvent populates the snapshot', () => {
        recordTierEvent(evt({kind: 'awaiting_input'}))
        recordTierEvent(evt({kind: 'working'}))
        expect(getTierTelemetrySnapshot().totalEvents).toBe(2)
    })

    it('sink receives every recorded event', () => {
        const seen: TierEvent[] = []
        configureTelemetrySink(e => seen.push(e))
        recordTierEvent(evt({kind: 'awaiting_input', ts: 1}))
        recordTierEvent(evt({kind: 'working', ts: 2}))
        expect(seen).toHaveLength(2)
        expect(seen[0].kind).toBe('awaiting_input')
        expect(seen[1].kind).toBe('working')
    })

    it('sink errors do not break the hot path', () => {
        configureTelemetrySink(() => {throw new Error('sink failure')})
        expect(() => recordTierEvent(evt({kind: 'awaiting_input'}))).not.toThrow()
        expect(getTierTelemetrySnapshot().totalEvents).toBe(1)
    })

    it('clearing the sink stops fan-out', () => {
        const seen: TierEvent[] = []
        configureTelemetrySink(e => seen.push(e))
        recordTierEvent(evt({kind: 'awaiting_input'}))
        configureTelemetrySink(null)
        recordTierEvent(evt({kind: 'working'}))
        expect(seen).toHaveLength(1)
    })

    it('ring buffer bounded — oldest events drop past capacity (smoke test)', () => {
        // Capacity is 10k. Push 10_100 unique-ts events; snapshot.totalEvents should cap at 10k.
        for (let i = 0; i < 10_100; i++) {
            recordTierEvent(evt({kind: 'working', ts: i}))
        }
        const snap = getTierTelemetrySnapshot()
        expect(snap.totalEvents).toBe(10_000)
        // The earliest 100 should have been dropped → firstEventAt corresponds to ts=100.
        expect(snap.firstEventAt).toBe(new Date(100).toISOString())
        expect(snap.lastEventAt).toBe(new Date(10_099).toISOString())
    })
})
