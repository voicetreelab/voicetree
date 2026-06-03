import {describe, expect, it} from 'vitest'
import {computeGraphComplexity, crossingPressure, isBipartite, type EdgePair} from '../../src/node'

function g(...pairs: [string, string][]): EdgePair[] {
    return pairs.map(([src, tgt]) => ({src, tgt}))
}
function nodes(edges: EdgePair[]): string[] {
    const s = new Set<string>()
    for (const e of edges) { s.add(e.src); s.add(e.tgt) }
    return [...s]
}
function score(edges: EdgePair[]): number {
    return computeGraphComplexity(nodes(edges), edges).score
}

// ── archetypes from the calibration session ───────────────────────────────────

const pipeline = g(['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'])
// god-object: G bidirectionally linked to 5 spokes (one big SCC, but a hub)
const godObject = g(
    ['G', 'a'], ['a', 'G'], ['G', 'b'], ['b', 'G'], ['G', 'c'], ['c', 'G'],
    ['G', 'd'], ['d', 'G'], ['G', 'e'], ['e', 'G'],
)
// pipeline A..H plus one deep back-edge H->C
const backEdgePipeline = g(
    ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'GG'], ['GG', 'H'], ['H', 'C'],
)
// feedback spaghetti
const spaghetti = g(['A', 'B'], ['B', 'C'], ['C', 'A'], ['C', 'D'], ['D', 'B'], ['D', 'E'], ['E', 'C'])
// octahedron K2,2,2 oriented forward (acyclic), parts {A,B}{C,D}{E,F}
const octahedron = g(
    ['A', 'C'], ['A', 'D'], ['A', 'E'], ['A', 'F'], ['B', 'C'], ['B', 'D'], ['B', 'E'], ['B', 'F'],
    ['C', 'E'], ['C', 'F'], ['D', 'E'], ['D', 'F'],
)
// K3,3 bipartite {A,B,C}->{D,E,F}
const k33 = g(
    ['A', 'D'], ['A', 'E'], ['A', 'F'], ['B', 'D'], ['B', 'E'], ['B', 'F'], ['C', 'D'], ['C', 'E'], ['C', 'F'],
)

describe('crossing pressure matches true crossing numbers', () => {
    it('K5 forces exactly 1 crossing (cr(K5)=1)', () => {
        expect(crossingPressure(5, 10, false)).toBe(1)
    })
    it('K3,3 is non-planar via the bipartite 2V-4 bound (cr(K3,3)=1)', () => {
        expect(isBipartite(nodes(k33), k33)).toBe(true)
        expect(crossingPressure(6, 9, true)).toBe(1) // 9 - (2*6-4) = 1
    })
    it('naive 3V-6 bound would MISS K3,3 — regression guard for the bipartite branch', () => {
        expect(crossingPressure(6, 9, false)).toBe(0) // 9 <= 3*6-6=12
    })
})

describe('calibrated ordering: branching dominates, cycles do not', () => {
    it('ranks the worst tier above the easy tier', () => {
        expect(score(octahedron)).toBeGreaterThan(score(spaghetti))
        expect(score(spaghetti)).toBeGreaterThan(score(backEdgePipeline))
        expect(score(k33)).toBeGreaterThan(score(godObject))
        expect(score(octahedron)).toBeGreaterThan(1) // heavy
    })

    it('a hub (god-object) reads easy despite being one big SCC', () => {
        const r = computeGraphComplexity(nodes(godObject), godObject)
        expect(r.cyclic).toBe(true)        // integrity flag fires
        expect(r.rating).not.toBe('heavy') // but comprehension stays low
        expect(r.score).toBeLessThan(0.5)
    })

    it('a linear chain with one back-edge reads easy despite the cycle', () => {
        const r = computeGraphComplexity(nodes(backEdgePipeline), backEdgePipeline)
        expect(r.cyclic).toBe(true)
        expect(r.score).toBeLessThan(0.5)
        const cyclesPillar = r.pillars.find(p => p.id === 'cycles')!
        expect(cyclesPillar.role).toBe('flag') // not a scored term
    })

    it('clean linear pipeline scores low and is acyclic', () => {
        const r = computeGraphComplexity(nodes(pipeline), pipeline)
        expect(r.cyclic).toBe(false)
        expect(r.score).toBeLessThanOrEqual(0.4)
    })

    it('exposes exactly 5 composites', () => {
        const r = computeGraphComplexity(nodes(spaghetti), spaghetti)
        expect(r.pillars.map(p => p.id)).toEqual(['branching', 'treewidth', 'crossings', 'coupling', 'cycles'])
        expect(r.pillars.filter(p => p.role === 'scored')).toHaveLength(4)
    })
})

describe('degenerate inputs', () => {
    it('empty graph is clean', () => {
        const r = computeGraphComplexity([], [])
        expect(r.score).toBe(0)
        expect(r.rating).toBe('clean')
    })
})
