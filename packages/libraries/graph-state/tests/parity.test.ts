/**
 * BF-153 · L1-H — Snapshot parity harness (project() vs cy.json()).
 *
 * Regression guard for V-L1-4 (nodes), V-L1-5 (edges), V-L1-6 (parents).
 *
 * For every snapshot fixture:
 *   state = loadSnapshot(id)
 *   spec  = project(state)
 *   cy    = headless cytoscape populated with spec's elements
 *   diff  = normalized(spec) vs normalized(cy.json())
 *
 * Three named test cases — one per claim — so a failure points to a specific
 * V-L1-* claim, not a generic "parity broke".
 */

import { describe, expect, it } from 'vitest'

import { project } from '../src/project'
import { listSnapshotDocuments } from '../src/fixtures'
import {
    describeDiff,
    diffEdges,
    diffNodes,
    diffParents,
    isClean,
    normalizeSpec,
    specThroughCytoscape,
} from './parity-utils'

const fixtures = listSnapshotDocuments()

describe('parity — project() <-> cy.json()', () => {
    it('has at least one snapshot fixture loaded', () => {
        expect(fixtures.length).toBeGreaterThan(0)
    })

    describe('parity.nodes — V-L1-4 (ids + kinds round-trip via cytoscape)', () => {
        for (const fx of fixtures) {
            it(fx.doc.id, () => {
                const spec = project(fx.state)
                const specN = normalizeSpec(spec)
                const cyN = specThroughCytoscape(spec)
                const d = diffNodes(fx.doc.id, specN, cyN)
                if (!isClean(d)) throw new Error(describeDiff(d))
            })
        }
    })

    describe('parity.edges — V-L1-5 (endpoints + ids round-trip, real + synthetic)', () => {
        for (const fx of fixtures) {
            it(fx.doc.id, () => {
                const spec = project(fx.state)
                const specN = normalizeSpec(spec)
                const cyN = specThroughCytoscape(spec)
                const d = diffEdges(fx.doc.id, specN, cyN)
                if (!isClean(d)) throw new Error(describeDiff(d))
            })
        }
    })

    describe('parity.parents — V-L1-6 (compound parent for collapsed/expanded folders)', () => {
        for (const fx of fixtures) {
            it(fx.doc.id, () => {
                const spec = project(fx.state)
                const specN = normalizeSpec(spec)
                const cyN = specThroughCytoscape(spec)
                const d = diffParents(fx.doc.id, specN, cyN)
                if (!isClean(d)) throw new Error(describeDiff(d))
            })
        }
    })
})
