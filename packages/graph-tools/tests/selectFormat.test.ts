/**
 * BF-199: selectFormat tests — one per decision-tree branch + fixture vault integration.
 */
import {beforeAll, describe, expect, it} from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {ensureSyntheticFixtures} from '../scripts/L3-BF-193-generate-fixtures'
import {selectFormat, buildAutoHeader, type FormatDecision} from '../src/selectFormat'
import {computeMetricsFromVault, type GraphMetrics} from '../src/graphMetrics'

const VAULTS_ROOT = new URL('fixtures/roundtrip-vaults', import.meta.url).pathname

// ── Fixture setup ─────────────────────────────────────────────────────────────

beforeAll(() => {
    fs.mkdirSync(VAULTS_ROOT, {recursive: true})
    ensureSyntheticFixtures(VAULTS_ROOT)
})

// ── Unit: one test per decision-tree branch ───────────────────────────────────

function metrics(overrides: Partial<GraphMetrics>): GraphMetrics {
    return {nodeCount: 50, edgeCount: 60, arboricity: 2, planar: true, sccCount: 45, kCore: 2, ...overrides}
}

describe('selectFormat unit — decision tree branches', () => {
    it('branch 1: nodeCount < 20 → recursive-ascii', () => {
        const d = selectFormat(metrics({nodeCount: 15, arboricity: 1, planar: true}))
        expect(d.format).toBe('recursive-ascii')
        expect(d.rationale).toContain('n=15')
    })

    it('branch 2: a(G) ≤ 3 AND planar → tree-cover', () => {
        const d = selectFormat(metrics({nodeCount: 50, arboricity: 3, planar: true}))
        expect(d.format).toBe('tree-cover')
        expect(d.rationale).toContain('lossless')
    })

    it('branch 2 failure (a(G) ≤ 3 but non-planar) falls to branch 3 ascii-lossy', () => {
        const d = selectFormat(metrics({nodeCount: 50, arboricity: 3, planar: false}))
        expect(d.format).toBe('ascii-lossy')
    })

    it('branch 3: 3 < a(G) ≤ 7 → ascii-lossy', () => {
        const d = selectFormat(metrics({nodeCount: 50, arboricity: 6, planar: false}))
        expect(d.format).toBe('ascii-lossy')
        expect(d.rationale).toContain('ascii-lossy')
    })

    it('branch 4: a(G) > 7 AND kCore ≥ 8 → edgelist', () => {
        const d = selectFormat(metrics({nodeCount: 50, arboricity: 9, planar: false, kCore: 10}))
        expect(d.format).toBe('edgelist')
        expect(d.rationale).toContain('kCore=10')
    })

    it('branch 5: a(G) > 7, kCore < 8 → mermaid', () => {
        const d = selectFormat(metrics({nodeCount: 50, arboricity: 9, planar: false, kCore: 5}))
        expect(d.format).toBe('mermaid')
    })
})

// ── Unit: FormatDecision structure ────────────────────────────────────────────

describe('FormatDecision structure', () => {
    it('metrics fields are populated', () => {
        const d = selectFormat(metrics({nodeCount: 50, edgeCount: 60, arboricity: 2, planar: true, sccCount: 45, kCore: 2}))
        expect(d.metrics.nodeCount).toBe(50)
        expect(d.metrics.edgeCount).toBe(60)
        expect(d.metrics.arboricity).toBe(2)
        expect(d.metrics.planar).toBe(true)
        expect(d.metrics.sccCount).toBe(45)
        expect(d.metrics.kCore).toBe(2)
    })

    it('rationale is a non-empty string', () => {
        const d = selectFormat(metrics({}))
        expect(typeof d.rationale).toBe('string')
        expect(d.rationale.length).toBeGreaterThan(0)
    })
})

// ── Unit: self-describing header ──────────────────────────────────────────────

describe('buildAutoHeader', () => {
    it('# comment format for tree-cover', () => {
        const d: FormatDecision = {
            format: 'tree-cover',
            metrics: {arboricity: 2, planar: true, sccCount: 10, kCore: 2, nodeCount: 30, edgeCount: 29},
            rationale: 'a(G)=2≤3 and planar ⟹ tree-cover is lossless',
        }
        const header = buildAutoHeader(d)
        expect(header).toContain('# format: tree-cover (auto-selected)')
        expect(header).toContain('# metrics: N=30 E=29 a(G)=2 planar=true')
        expect(header).toContain('# rationale:')
    })

    it('%% comment format for mermaid', () => {
        const d: FormatDecision = {
            format: 'mermaid',
            metrics: {arboricity: 7, planar: false, sccCount: 48, kCore: 5, nodeCount: 50, edgeCount: 80},
            rationale: 'a(G)=7>5 ⟹ mermaid',
        }
        const header = buildAutoHeader(d, '%%')
        expect(header).toContain('%% format: mermaid (auto-selected)')
        expect(header).toContain('%% metrics:')
    })
})

// ── Integration: fixture vaults ───────────────────────────────────────────────

describe('selectFormat integration — BF-198 fixture vaults', () => {
    it('synthetic-a1-tree (a(G)=1) → tree-cover', () => {
        const vault = path.join(VAULTS_ROOT, 'synthetic-a1-tree')
        const m = computeMetricsFromVault(vault)
        expect(m.arboricity).toBeGreaterThanOrEqual(1)
        expect(m.arboricity).toBeLessThanOrEqual(3)
        const d = selectFormat(m)
        expect(d.format).toBe('tree-cover')
    })

    it('synthetic-a2-cycle (a(G)=2) → tree-cover', () => {
        const vault = path.join(VAULTS_ROOT, 'synthetic-a2-cycle')
        const m = computeMetricsFromVault(vault)
        expect(m.arboricity).toBeGreaterThanOrEqual(2)
        expect(m.arboricity).toBeLessThanOrEqual(3)
        const d = selectFormat(m)
        expect(d.format).toBe('tree-cover')
    })

    it('synthetic-k5-core (Nash-Williams a(G)=3) → tree-cover', () => {
        const vault = path.join(VAULTS_ROOT, 'synthetic-k5-core')
        const m = computeMetricsFromVault(vault)
        expect(m.arboricity).toBeGreaterThanOrEqual(3)
        const d = selectFormat(m)
        expect(d.format).toBe('tree-cover')
    })

    it('synthetic-k9-core (Nash-Williams a(G)=5, greedy≥5) → ascii-lossy', () => {
        const vault = path.join(VAULTS_ROOT, 'synthetic-k9-core')
        const m = computeMetricsFromVault(vault)
        expect(m.arboricity).toBeGreaterThanOrEqual(5)
        const d = selectFormat(m)
        expect(d.format).toBe('ascii-lossy')
    })

    it('synthetic-k15-core (Nash-Williams a(G)=8, greedy≥8) → mermaid or edgelist', () => {
        const vault = path.join(VAULTS_ROOT, 'synthetic-k15-core')
        const m = computeMetricsFromVault(vault)
        expect(m.arboricity).toBeGreaterThanOrEqual(8)
        const d = selectFormat(m)
        expect(['mermaid', 'edgelist']).toContain(d.format)
    })
})

// ── Integration: self-describing header present in selectFormat output ─────────

describe('self-describing header in fixture output', () => {
    it('tree-cover decision has header fields', () => {
        const vault = path.join(VAULTS_ROOT, 'synthetic-a1-tree')
        const m = computeMetricsFromVault(vault)
        const d = selectFormat(m)
        const header = buildAutoHeader(d)
        expect(header).toContain('format: tree-cover (auto-selected)')
        expect(header).toContain(`N=${m.nodeCount}`)
        expect(header).toContain(`a(G)=${m.arboricity}`)
        expect(header).toContain('rationale:')
    })
})
