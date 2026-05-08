/**
 * RED TEAM: Tests that SHOULD pass but DON'T.
 * These describe correct user-expected behavior that the implementation fails to deliver.
 * Every failing test = a real bug found.
 *
 * Bug found: computeExpandPlan only iterates direct children of the expanding folder.
 * It never scans edges involving descendants of still-collapsed subfolders.
 * Result: when parent B/ expands while child A/ stays collapsed, external nodes'
 * edges to A/'s descendants produce NO synthetic edges to A/.
 */

import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode } from './'
import { computeExpandPlan } from './folderCollapse'

// ── Test helpers (same as existing test) ──

function makeNode(overrides: Partial<GraphNode> & { outgoingEdges?: GraphNode['outgoingEdges'] } = {}): GraphNode {
    const { kind = 'leaf', ...restOverrides } = overrides

    return {
        kind,
        absoluteFilePathIsID: '',
        contentWithoutYamlOrLinks: '',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
        ...restOverrides
    }
}

function makeGraph(
    nodes: Record<string, GraphNode>,
    incomingIndex?: ReadonlyMap<string, readonly string[]>
): Graph {
    const incoming: Map<string, string[]> = new Map()
    if (!incomingIndex) {
        for (const [nodeId, node] of Object.entries(nodes)) {
            for (const edge of node.outgoingEdges) {
                const list: string[] = incoming.get(edge.targetId) ?? []
                list.push(nodeId)
                incoming.set(edge.targetId, list)
            }
        }
    }
    return {
        nodes,
        incomingEdgesIndex: incomingIndex ?? incoming,
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

// ── RED TEAM: computeExpandPlan gaps with still-collapsed subfolders ──

describe('RED TEAM: computeExpandPlan — still-collapsed subfolder edge gaps', () => {

    it('BUG: external→subfolder-descendant should become synthetic when subfolder is still collapsed', () => {
        // Scenario: B/ contains A/ (collapsed). External X.md → B/A/child.md.
        // When expanding B/, X.md → A/child.md should become synthetic X → A/
        // because A/ stays collapsed and A/child.md is hidden.
        //
        // Root cause: computeExpandPlan only iterates getFolderChildNodeIds(graph, 'B/')
        // which returns DIRECT children of B/. Since A/child.md has parent A/ (not B/),
        // its incoming edge from X.md is never processed.
        const graph: Graph = makeGraph({
            'B/A/child.md': makeNode({ absoluteFilePathIsID: 'B/A/child.md' }),
            'X.md': makeNode({
                absoluteFilePathIsID: 'X.md',
                outgoingEdges: [{ targetId: 'B/A/child.md', label: 'ref' }]
            })
        })

        const plan = computeExpandPlan(
            graph,
            'B/',
            new Set(['B/A/']),      // A/ still collapsed
            new Set(['B/', 'X.md']) // visible before expand
        )

        // Subfolders should include A/
        expect(plan.subFolders).toContain('B/A/')

        // User expects: X.md→A/child.md becomes synthetic X→A/
        // Bug: plan.syntheticEdges is empty because no direct children to process
        expect(plan.syntheticEdges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    folderId: 'B/A/',
                    direction: 'incoming',
                    externalId: 'X.md'
                })
            ])
        )
    })

    it('BUG: subfolder-descendant→external should become synthetic when subfolder is still collapsed', () => {
        // Reverse direction: B/A/child.md → X.md, A/ is collapsed inside B/
        const graph: Graph = makeGraph({
            'B/A/child.md': makeNode({
                absoluteFilePathIsID: 'B/A/child.md',
                outgoingEdges: [{ targetId: 'X.md', label: 'dep' }]
            }),
            'X.md': makeNode({ absoluteFilePathIsID: 'X.md' })
        })

        const plan = computeExpandPlan(
            graph,
            'B/',
            new Set(['B/A/']),
            new Set(['B/', 'X.md'])
        )

        // User expects: A/child.md→X.md becomes synthetic A/→X
        expect(plan.syntheticEdges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    folderId: 'B/A/',
                    direction: 'outgoing',
                    externalId: 'X.md'
                })
            ])
        )
    })

    it('BUG contrast: direct child→collapsed subfolder works, but external→subfolder does NOT', () => {
        // B/ has direct child B/x.md AND collapsed subfolder B/A/.
        // Both B/x.md and external X.md have edges to B/A/child.md.
        // Direct child's edge IS processed (it's in childIds). External's is NOT.
        const graph: Graph = makeGraph({
            'B/x.md': makeNode({
                absoluteFilePathIsID: 'B/x.md',
                outgoingEdges: [{ targetId: 'B/A/child.md', label: 'internal-ref' }]
            }),
            'B/A/child.md': makeNode({ absoluteFilePathIsID: 'B/A/child.md' }),
            'X.md': makeNode({
                absoluteFilePathIsID: 'X.md',
                outgoingEdges: [{ targetId: 'B/A/child.md', label: 'external-ref' }]
            })
        })

        const plan = computeExpandPlan(
            graph,
            'B/',
            new Set(['B/A/']),
            new Set(['B/', 'X.md'])
        )

        // Direct child B/x.md's edge is correctly handled (PASSES)
        const internalSynth = plan.syntheticEdges.filter(se =>
            se.folderId === 'B/A/' && se.externalId === 'B/x.md'
        )
        expect(internalSynth.length).toBeGreaterThan(0) // PASSES — direct children processed

        // External X.md's edge is NOT handled (FAILS — this is the bug)
        const externalSynth = plan.syntheticEdges.filter(se =>
            se.folderId === 'B/A/' && se.externalId === 'X.md'
        )
        expect(externalSynth.length).toBeGreaterThan(0) // FAILS — external edges missed
    })

    it('BUG: deeply nested subfolder — two levels of nesting', () => {
        // B/ > A/ > C/ (collapsed). X.md → B/A/C/deep.md
        // Expanding B/ should eventually produce synthetic X → A/ or X → C/
        // depending on which subfolders are collapsed
        const graph: Graph = makeGraph({
            'B/A/C/deep.md': makeNode({ absoluteFilePathIsID: 'B/A/C/deep.md' }),
            'X.md': makeNode({
                absoluteFilePathIsID: 'X.md',
                outgoingEdges: [{ targetId: 'B/A/C/deep.md', label: 'deep' }]
            })
        })

        const plan = computeExpandPlan(
            graph,
            'B/',
            new Set(['B/A/']),      // A/ collapsed (C/ is inside A/, implicitly hidden)
            new Set(['B/', 'X.md'])
        )

        // Subfolders should include B/A/
        expect(plan.subFolders).toContain('B/A/')

        // X→deep.md should become synthetic to the nearest collapsed ancestor (A/)
        expect(plan.syntheticEdges.length).toBeGreaterThan(0)
    })

    it('BUG: bidirectional edges to/from subfolder descendants', () => {
        // X.md ↔ B/A/child.md (edges in both directions)
        const graph: Graph = makeGraph({
            'B/A/child.md': makeNode({
                absoluteFilePathIsID: 'B/A/child.md',
                outgoingEdges: [{ targetId: 'X.md', label: 'out' }]
            }),
            'X.md': makeNode({
                absoluteFilePathIsID: 'X.md',
                outgoingEdges: [{ targetId: 'B/A/child.md', label: 'in' }]
            })
        })

        const plan = computeExpandPlan(
            graph,
            'B/',
            new Set(['B/A/']),
            new Set(['B/', 'X.md'])
        )

        // Both directions should produce synthetics
        const incomingSynth = plan.syntheticEdges.filter(se =>
            se.folderId === 'B/A/' && se.direction === 'incoming'
        )
        const outgoingSynth = plan.syntheticEdges.filter(se =>
            se.folderId === 'B/A/' && se.direction === 'outgoing'
        )
        expect(incomingSynth.length).toBeGreaterThan(0)
        expect(outgoingSynth.length).toBeGreaterThan(0)
    })
})
