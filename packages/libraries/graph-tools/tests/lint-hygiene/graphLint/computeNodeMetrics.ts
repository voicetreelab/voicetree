import { describe, it, expect } from 'vitest'
import { computeNodeMetrics, DEFAULT_LINT_CONFIG } from '../../../src/lint/graphLint'
import type { ClassifiedEdge, ContainmentTree, NodeMetrics } from '../../../src/lint/graphLint'

export const describeComputeNodeMetrics = (): void => {
    describe('computeNodeMetrics', () => {
        it('computes metrics correctly for a node with children and sibling edges', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([['root', null], ['a', 'root'], ['b', 'root'], ['c', 'root']]),
                childrenOf: new Map([['root', ['a', 'b', 'c']]]),
            }
            const edges: ClassifiedEdge[] = [
                { source: 'a', target: 'b', type: 'sibling' },
                { source: 'b', target: 'c', type: 'sibling' },
            ]

            const metrics: NodeMetrics = computeNodeMetrics('root', tree, edges, DEFAULT_LINT_CONFIG)
            expect(metrics.nChildren).toBe(3)
            expect(metrics.nSiblingEdges).toBe(2)
            expect(metrics.attentionItems).toBe(5)
            expect(metrics.siblingEdgeDensity).toBeCloseTo(2 / 3)
            expect(metrics.depth).toBe(0)
        })

        it('computes depth from parent chain', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([['root', null], ['mid', 'root'], ['leaf', 'mid']]),
                childrenOf: new Map([['root', ['mid']], ['mid', ['leaf']]]),
            }
            const edges: ClassifiedEdge[] = []

            expect(computeNodeMetrics('root', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(0)
            expect(computeNodeMetrics('mid', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(1)
            expect(computeNodeMetrics('leaf', tree, edges, DEFAULT_LINT_CONFIG).depth).toBe(2)
        })

        it('node_cost scales with dependency_scaling', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([['root', null], ['a', 'root'], ['b', 'root']]),
                childrenOf: new Map([['root', ['a', 'b']]]),
            }
            const noEdges: ClassifiedEdge[] = []
            const lowMetrics: NodeMetrics = computeNodeMetrics('root', tree, noEdges, DEFAULT_LINT_CONFIG)
            expect(lowMetrics.nodeCost).toBe(2)

            const fullEdges: ClassifiedEdge[] = [{ source: 'a', target: 'b', type: 'sibling' }]
            const highMetrics: NodeMetrics = computeNodeMetrics('root', tree, fullEdges, DEFAULT_LINT_CONFIG)
            expect(highMetrics.siblingEdgeDensity).toBe(1.0)
            expect(highMetrics.nodeCost).toBeGreaterThan(lowMetrics.nodeCost)
        })
    })
}
