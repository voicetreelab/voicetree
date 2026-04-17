/**
 * BF-200 — unit tests for egoGraph pure functions.
 *
 * Graph fixture: a→b, b→c, e→b. d is isolated.
 * Built via buildStateFromVault on a temp dir.
 */
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {mkdirSync, writeFileSync, rmSync} from 'fs'
import {buildStateFromVault} from '@vt/graph-state'
import type {State} from '@vt/graph-state/contract'
import {focus, neighbors, shortestPath, renderFocus, renderNeighbors, renderPath} from '../src/egoGraph'

const VAULT = '/tmp/vt-ego-unit-test'
const A = `${VAULT}/a.md`
const B = `${VAULT}/b.md`
const C = `${VAULT}/c.md`
const D = `${VAULT}/d.md`
const E = `${VAULT}/e.md`

let graph: State['graph']

beforeAll(async () => {
    mkdirSync(VAULT, {recursive: true})
    writeFileSync(A, '# A\n[[b]]\n')
    writeFileSync(B, '# B\n[[c]]\n')
    writeFileSync(C, '# C\n')
    writeFileSync(D, '# D\n')
    writeFileSync(E, '# E\n[[b]]\n')
    const state = await buildStateFromVault(VAULT, VAULT)
    graph = state.graph
})

afterAll(() => {
    rmSync(VAULT, {recursive: true, force: true})
})

describe('focus()', () => {
    it('isolated node returns only itself', () => {
        expect(focus(graph, D)).toEqual([D])
    })

    it('1-hop includes direct neighbors in both directions', () => {
        const result = focus(graph, B)
        expect(result).toContain(B)
        expect(result).toContain(A) // incoming
        expect(result).toContain(C) // outgoing
        expect(result).toContain(E) // incoming
        expect(result).not.toContain(D)
    })

    it('2-hop reaches transitively connected nodes', () => {
        const result = focus(graph, A, 2)
        expect(result).toContain(C) // a→b→c
        expect(result).toContain(E) // a→b←e
    })

    it('returns empty for missing node', () => {
        expect(focus(graph, '/vault/missing.md')).toEqual([])
    })

    it('0-hop returns only center', () => {
        expect(focus(graph, B, 0)).toEqual([B])
    })
})

describe('neighbors()', () => {
    it('excludes center from result', () => {
        const result = neighbors(graph, B, 1)
        expect(result).not.toContain(B)
        expect(result).toContain(A)
        expect(result).toContain(C)
        expect(result).toContain(E)
    })

    it('isolated node has no neighbors', () => {
        expect(neighbors(graph, D, 1)).toEqual([])
    })

    it('2-hop adds transitively reachable nodes', () => {
        const one = neighbors(graph, A, 1)
        const two = neighbors(graph, A, 2)
        expect(two.length).toBeGreaterThan(one.length)
        expect(two).toContain(C)
        expect(two).toContain(E)
    })

    it('returns empty for missing node', () => {
        expect(neighbors(graph, '/vault/missing.md', 1)).toEqual([])
    })
})

describe('shortestPath()', () => {
    it('finds a→b→c', () => {
        expect(shortestPath(graph, A, C)).toEqual([A, B, C])
    })

    it('self-path is [node]', () => {
        expect(shortestPath(graph, B, B)).toEqual([B])
    })

    it('no path to isolated node', () => {
        expect(shortestPath(graph, A, D)).toBeNull()
    })

    it('returns null for missing source', () => {
        expect(shortestPath(graph, '/vault/missing.md', B)).toBeNull()
    })

    it('undirected: c→b→e via reverse edges', () => {
        const p = shortestPath(graph, C, E)
        expect(p).not.toBeNull()
        expect(p![0]).toBe(C)
        expect(p![p!.length - 1]).toBe(E)
    })
})

describe('renderFocus()', () => {
    it('includes center and hop count', () => {
        const out = renderFocus(graph, B, 1)
        expect(out).toContain('b.md')
        expect(out).toContain('1-hop')
    })

    it('shows Incoming and Outgoing sections', () => {
        const out = renderFocus(graph, B, 1)
        expect(out).toContain('Incoming:')
        expect(out).toContain('Outgoing:')
    })

    it('missing node returns error string', () => {
        expect(renderFocus(graph, '/vault/missing.md')).toContain('not found')
    })
})

describe('renderNeighbors()', () => {
    it('lists neighbor basenames', () => {
        const out = renderNeighbors(graph, B, 1)
        expect(out).toContain('a.md')
        expect(out).toContain('c.md')
        expect(out).toContain('e.md')
    })

    it('shows count in header', () => {
        const out = renderNeighbors(graph, B, 1)
        expect(out).toContain('3 found')
    })
})

describe('renderPath()', () => {
    it('renders path with arrows', () => {
        expect(renderPath(graph, A, C)).toBe('a.md → b.md → c.md')
    })

    it('no path message for isolated node', () => {
        expect(renderPath(graph, A, D)).toContain('no path')
    })
})
