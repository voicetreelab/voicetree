/**
 * Self-tests for the parity harness helpers. These do NOT depend on project()
 * — they exercise toCyElement / normalizeCyJson / specThroughCytoscape against
 * hand-rolled ElementSpecs, so the harness itself is covered before BF-143
 * lands and before the real parity.test.ts runs.
 */

import { describe, expect, it } from 'vitest'

import type { ElementSpec } from '../src/contract'
import {
    describeDiff,
    diffEdges,
    diffNodes,
    diffParents,
    isClean,
    normalizeSpec,
    specThroughCytoscape,
} from './parity-utils'

const emptySpec: ElementSpec = { nodes: [], edges: [], revision: 0 }

const twoSiblingsSpec: ElementSpec = {
    revision: 1,
    nodes: [
        { id: '/v/a/' as never,         kind: 'folder', data: {}, label: 'a' },
        { id: '/v/a/x.md' as never,     kind: 'node',   data: { base: 'x.md' }, parent: '/v/a/', label: 'x.md' },
        { id: '/v/a/y.md' as never,     kind: 'node',   data: { base: 'y.md' }, parent: '/v/a/', label: 'y.md', position: { x: 10, y: 20 } },
        { id: '/v/b/' as never,         kind: 'folder-collapsed', data: {}, label: 'b', classes: ['folder', 'collapsed'] },
    ],
    edges: [
        { id: 'e:/v/a/x.md->/v/a/y.md',  kind: 'real',      source: '/v/a/x.md' as never, target: '/v/a/y.md' as never, label: 'Ref', data: {} },
        { id: 'syn:/v/a/->/v/b/',        kind: 'synthetic', source: '/v/a/' as never,      target: '/v/b/' as never,     data: { count: 2 } },
    ],
}

describe('parity helpers (self-test, no project())', () => {
    it('normalizes an empty spec without crashing and round-trips through cy', () => {
        const specN = normalizeSpec(emptySpec)
        const cyN = specThroughCytoscape(emptySpec)
        expect(specN.nodes).toEqual([])
        expect(specN.edges).toEqual([])
        expect(cyN.nodes).toEqual([])
        expect(cyN.edges).toEqual([])
    })

    it('round-trip preserves node ids, parents, and kinds', () => {
        const specN = normalizeSpec(twoSiblingsSpec)
        const cyN = specThroughCytoscape(twoSiblingsSpec)
        const d = diffNodes('two-siblings', specN, cyN)
        expect(isClean(d), describeDiff(d)).toBe(true)
    })

    it('round-trip preserves edge ids, endpoints, and kinds (real + synthetic)', () => {
        const specN = normalizeSpec(twoSiblingsSpec)
        const cyN = specThroughCytoscape(twoSiblingsSpec)
        const d = diffEdges('two-siblings', specN, cyN)
        expect(isClean(d), describeDiff(d)).toBe(true)
    })

    it('round-trip preserves compound-parent relations', () => {
        const specN = normalizeSpec(twoSiblingsSpec)
        const cyN = specThroughCytoscape(twoSiblingsSpec)
        const d = diffParents('two-siblings', specN, cyN)
        expect(isClean(d), describeDiff(d)).toBe(true)
    })

    it('detects a genuine node-id divergence (negative test)', () => {
        const cyN = specThroughCytoscape(twoSiblingsSpec)
        const broken: ElementSpec = {
            ...twoSiblingsSpec,
            nodes: twoSiblingsSpec.nodes.map((n) =>
                n.id === '/v/a/x.md' ? { ...n, id: '/v/a/x-renamed.md' as never } : n,
            ),
        }
        const brokenN = normalizeSpec(broken)
        const d = diffNodes('broken', brokenN, cyN)
        expect(isClean(d)).toBe(false)
        expect(d.onlyInSpec).toContain('/v/a/x-renamed.md')
        expect(d.onlyInCy).toContain('/v/a/x.md')
    })

    it('detects a genuine parent divergence (negative test)', () => {
        const cyN = specThroughCytoscape(twoSiblingsSpec)
        const broken: ElementSpec = {
            ...twoSiblingsSpec,
            nodes: twoSiblingsSpec.nodes.map((n) =>
                n.kind === 'node' ? { ...n, parent: undefined } : n,
            ),
        }
        const brokenN = normalizeSpec(broken)
        const d = diffParents('broken', brokenN, cyN)
        expect(isClean(d)).toBe(false)
        expect(d.mismatched.length).toBe(2)
    })
})
