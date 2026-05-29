/**
 * BF-200 — unit tests for egoGraph pure functions.
 *
 * Graph fixture: a→b, b→c, e→b. d is isolated.
 * Built via buildStateFromProject on a temp dir.
 */
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {mkdirSync, writeFileSync, rmSync} from 'fs'
import {buildStateFromProject} from '@vt/graph-state'
import type {State} from '@vt/graph-state/contract'
import {configureGraphToolsRootIO} from '../../src/live/rootIO'
import {focus, neighbors, shortestPath, renderFocus, renderNeighbors, renderPath} from '../../src/view/egoGraph'

const PROJECT = '/tmp/vt-ego-unit-test'
const A = `${PROJECT}/a.md`
const B = `${PROJECT}/b.md`
const C = `${PROJECT}/c.md`
const D = `${PROJECT}/d.md`
const E = `${PROJECT}/e.md`

let graph: State['graph']

beforeAll(async () => {
    configureGraphToolsRootIO()
    mkdirSync(PROJECT, {recursive: true})
    writeFileSync(A, '# A\n[[b]]\n')
    writeFileSync(B, '# B\n[[c]]\n')
    writeFileSync(C, '# C\n')
    writeFileSync(D, '# D\n')
    writeFileSync(E, '# E\n[[b]]\n')
    const state = await buildStateFromProject(PROJECT, PROJECT)
    graph = state.graph
})

afterAll(() => {
    rmSync(PROJECT, {recursive: true, force: true})
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
        expect(focus(graph, '/project/missing.md')).toEqual([])
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
        expect(neighbors(graph, '/project/missing.md', 1)).toEqual([])
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
        expect(shortestPath(graph, '/project/missing.md', B)).toBeNull()
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
        expect(out.kind).toBe('ok')
        expect(out.text).toContain('b.md')
        expect(out.text).toContain('1-hop')
    })

    it('shows Incoming and Outgoing sections', () => {
        const out = renderFocus(graph, B, 1)
        expect(out.text).toContain('Incoming:')
        expect(out.text).toContain('Outgoing:')
    })

    it('missing node returns a not-found render', () => {
        const out = renderFocus(graph, '/project/missing.md')
        expect(out.kind).toBe('not-found')
        expect(out.text).toContain('not found')
    })
})

describe('renderNeighbors()', () => {
    it('lists neighbor basenames', () => {
        const out = renderNeighbors(graph, B, 1)
        expect(out.kind).toBe('ok')
        expect(out.text).toContain('a.md')
        expect(out.text).toContain('c.md')
        expect(out.text).toContain('e.md')
    })

    it('shows count in header', () => {
        const out = renderNeighbors(graph, B, 1)
        expect(out.text).toContain('3 found')
    })

    it('missing node returns a not-found render', () => {
        const out = renderNeighbors(graph, '/project/missing.md', 1)
        expect(out.kind).toBe('not-found')
        expect(out.text).toContain('not found')
    })
})

describe('renderPath()', () => {
    it('renders path with arrows', () => {
        const out = renderPath(graph, A, C)
        expect(out.kind).toBe('ok')
        expect(out.text).toBe('a.md → b.md → c.md')
    })

    it('genuine no-path between two real nodes is distinct from a typo', () => {
        // A and D both exist but are disconnected. This is a valid query result,
        // NOT a caller error — its kind must differ from the unknown-endpoint case.
        const out = renderPath(graph, A, D)
        expect(out.kind).toBe('no-path')
        expect(out.text).toContain('no path')
    })

    it('unknown endpoint is a not-found render (distinguishable from no-path)', () => {
        const typo = renderPath(graph, A, '/project/missing.md')
        expect(typo.kind).toBe('not-found')
        expect(typo.text).toContain('not found')
        // The disconnected-but-present case and the typo case carry different kinds.
        expect(renderPath(graph, A, D).kind).not.toBe(typo.kind)
    })
})
