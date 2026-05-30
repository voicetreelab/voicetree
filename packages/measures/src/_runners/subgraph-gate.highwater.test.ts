import {describe, expect, it} from 'vitest'
import type {Violation} from '../_subgraph_gate/index.ts'
import {filterByHighWaterMark, highWaterMark} from './subgraph-gate.ts'

// Black-box tests for the high-water-mark budget logic (Phase 1 of the
// unified-budget gate). The budget is the worst score across ALL captured
// communities; a touched community is blocked only if it would exceed that
// global ceiling ("no new record"), not for merely sitting above a flat
// trigger threshold. Pure functions — no disk, no daemon.

function violation(community: string, score: number): Violation {
    return {community, score, baseline: null, severity: 'fail', message: `${community} @ ${score}`}
}

describe('highWaterMark', () => {
    it('returns the max community score for lower-is-better measures', () => {
        expect(highWaterMark('tree-width-approx', {a: 3, b: 13, c: 5})).toBe(13)
    })

    it('returns the min community score for modularity-q (higher-is-better)', () => {
        expect(highWaterMark('modularity-q', {a: 0.4, b: -0.16, c: 0.3})).toBe(-0.16)
    })

    it('returns null when nothing has been captured', () => {
        expect(highWaterMark('cycles', {})).toBeNull()
    })
})

describe('filterByHighWaterMark', () => {
    const captured = {worst: 13, mid: 8, clean: 0} // hwm = 13

    it('drops a community sitting AT the high-water-mark (unfreeze)', () => {
        // agent-runtime at tree-width 13 == the worst part of the repo: editing
        // it must not block as long as it does not get worse.
        const kept = filterByHighWaterMark('tree-width-approx', [violation('worst', 13)], captured)
        expect(kept).toEqual([])
    })

    it('drops a community below the high-water-mark', () => {
        expect(filterByHighWaterMark('tree-width-approx', [violation('mid', 9)], captured)).toEqual([])
    })

    it('keeps a community that exceeds the high-water-mark (a new record)', () => {
        const kept = filterByHighWaterMark('tree-width-approx', [violation('worst', 14)], captured)
        expect(kept).toHaveLength(1)
        expect(kept[0].baseline).toBe(13) // budget stamped onto the surviving violation
        expect(kept[0].score).toBe(14)
    })

    it('keeps every emitted violation when nothing is captured (flat-threshold fallback)', () => {
        const kept = filterByHighWaterMark('cycles', [violation('x', 1)], {})
        expect(kept).toHaveLength(1)
        expect(kept[0].baseline).toBeNull()
    })

    it('honours modularity-q direction: below the min budget is the new worst', () => {
        const q = {a: 0.4, b: 0.1} // min budget = 0.1; lower is worse
        expect(filterByHighWaterMark('modularity-q', [violation('a', 0.1)], q)).toEqual([]) // at budget → ok
        const kept = filterByHighWaterMark('modularity-q', [violation('a', 0.05)], q) // below → new worst
        expect(kept).toHaveLength(1)
    })
})
