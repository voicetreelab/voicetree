// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import { syncVaultStateFromMain } from '@/shell/edge/UI-edge/state/stores/VaultPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { O, upsert, applyDeltaToUI } from './applyGraphDeltaToUI.test-utils'

vi.mock('@/shell/edge/UI-edge/graph/popups/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

describe('applyGraphDeltaToUI - Integration', () => {
    let cy: Core

    beforeEach(() => {
        resetTestProjectionState()
        cy = cytoscape({ headless: true, elements: [] })
    })

    afterEach(() => {
        cy.destroy()
        setTestCollapseSet(new Set())
        syncVaultStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    describe('Edge handling', () => {
        // todo, we might not be handling the case where the shadow node has been closed/removed?
        // human: DO NOT REMOVE THIS TEST - it catches a critical bug where edges to floating
        // human: windows (terminals/editors) were incorrectly deleted during graph sync.
        // human: Shadow nodes are UI-only anchors not tracked in the graph model.
        it('should NOT remove edges to shadow nodes (floating terminals/editors)', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent.md',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent)])

            // Simulates what anchorToNode() creates for terminals/editors
            cy.add({
                group: 'nodes',
                data: {
                    id: 'shadow-child-parent.md-parent.md-terminal-0',
                    isShadowNode: true,
                    isFloatingWindow: true,
                    windowType: 'Terminal'
                },
                position: { x: 150, y: 150 }
            })

            cy.add({
                group: 'edges',
                data: {
                    id: 'edge-parent.md-shadow-child-parent.md-parent.md-terminal-0',
                    source: 'parent.md',
                    target: 'shadow-child-parent.md-parent.md-terminal-0'
                }
            })

            expect(cy.edges().length).toBe(1)

            // The graph model knows nothing about shadow nodes, so outgoingEdges is empty
            applyDeltaToUI(cy, [upsert(parent)])

            expect(cy.edges().length).toBe(1)
            expect(cy.getElementById('edge-parent.md-shadow-child-parent.md-parent.md-terminal-0').length).toBe(1)
        })

        it('should handle edge lifecycle: creation after target exists, persistence on update, removal on link delete', () => {
            const makeNode: (id: string, edges?: Array<{ targetId: string, label: string }>) => GraphNode = (id, edges = []) => ({
                absoluteFilePathIsID: id,
                contentWithoutYamlOrLinks: `# ${id}`,
                outgoingEdges: edges,
                nodeUIMetadata: { color: O.none, position: O.some({ x: 0, y: 0 }), additionalYAMLProps: {}, isContextNode: false }
            })

            // CASE 1: Edge created when child arrives in same delta as parent update (race condition fix)
            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: makeNode('parent', [{ targetId: 'child', label: '' }]), previousNode: O.none }])
            expect(cy.edges().length).toBe(0) // Edge skipped - child doesn't exist yet

            applyDeltaToUI(cy, [
                { type: 'UpsertNode', nodeToUpsert: makeNode('child'), previousNode: O.none },
                { type: 'UpsertNode', nodeToUpsert: makeNode('parent', [{ targetId: 'child', label: '' }]), previousNode: O.none }
            ])
            expect(cy.edges().length).toBe(1)
            expect(cy.getElementById('parent->child').length).toBe(1)

            // CASE 2: Edge persists when node updated but link remains
            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: { ...makeNode('parent', [{ targetId: 'child', label: '' }]), contentWithoutYamlOrLinks: '# Parent Updated' }, previousNode: O.none }])
            expect(cy.edges().length).toBe(1)
            expect(cy.getElementById('parent').data('label')).toBe('Parent Updated')

            // CASE 3: Edge removed when wikilink deleted from markdown
            applyDeltaToUI(cy, [{ type: 'UpsertNode', nodeToUpsert: makeNode('parent', []), previousNode: O.none }])
            expect(cy.edges().length).toBe(0)
            expect(cy.getElementById('parent').length).toBe(1)
            expect(cy.getElementById('child').length).toBe(1)
        })
    })
})
