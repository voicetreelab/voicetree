// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import { syncVaultStateFromMain } from '@/shell/edge/UI-edge/state/stores/VaultPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { O, upsert, applyDeltaToUI, syncFolderTree } from './applyGraphDeltaToUI.test-utils'

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
        syncVaultStateFromMain({ readPaths: [], writeFolder: null, starredFolders: [] })
    })

    describe('Append animation behavior', () => {
        it.skip('should trigger append animation on content change', () => {
            // Animation events (content-changed) are emitted but CSS animations
            // do not run in jsdom. This test is deferred until we have a
            // cy event spy approach that doesn't require internal mocking.
        })
    })

    describe('Position stability', () => {
        it('re-projection preserves position that was changed in cy (simulates Cola moving a node)', () => {
            const node: GraphNode = {
                absoluteFilePathIsID: 'cola-node',
                contentWithoutYamlOrLinks: '# Cola Node',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(node)])

            // Simulate Cola layout algorithm moving the node
            cy.getElementById('cola-node').position({ x: 999, y: 888 })

            // Re-projecting with same spec should not overwrite the Cola-moved position
            applyDeltaToUI(cy, [upsert(node)])

            const pos: cytoscape.Position = cy.getElementById('cola-node').position()
            expect(pos.x).toBe(999)
            expect(pos.y).toBe(888)
        })

        it('re-projection preserves positions even when node content changes', () => {
            const node: GraphNode = {
                absoluteFilePathIsID: 'content-change-node',
                contentWithoutYamlOrLinks: '# Original Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 50, y: 50 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(node)])

            // Renderer moves the node (e.g. Cola layout)
            cy.getElementById('content-change-node').position({ x: 700, y: 600 })

            // Content changes but position should remain unchanged
            const updatedNode: GraphNode = {
                ...node,
                contentWithoutYamlOrLinks: '# Updated Content'
            }

            applyDeltaToUI(cy, [upsert(updatedNode)])

            const pos: cytoscape.Position = cy.getElementById('content-change-node').position()
            expect(pos.x).toBe(700)
            expect(pos.y).toBe(600)
        })
    })

    describe('Position preservation through collapse/expand cycle', () => {
        it('nodes reappearing after expand get their persisted position from spec', () => {
            syncFolderTree('/vault')
            syncVaultStateFromMain({ readPaths: [], writeFolder: '/vault', starredFolders: [] })

            const childNode: GraphNode = {
                absoluteFilePathIsID: '/vault/auth/login-flow.md',
                contentWithoutYamlOrLinks: '# Login Flow',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(childNode)])
            expect(cy.getElementById('/vault/auth/login-flow.md').length).toBe(1)

            // Collapse the folder — child node disappears
            setTestCollapseSet(new Set(['/vault/auth/']))
            applyDeltaToUI(cy, [upsert(childNode)])
            expect(cy.getElementById('/vault/auth/login-flow.md').length).toBe(0)

            // Expand — child node reappears at its spec-seeded position
            setTestCollapseSet(new Set())
            applyDeltaToUI(cy, [upsert(childNode)])

            const node: cytoscape.CollectionReturnValue = cy.getElementById('/vault/auth/login-flow.md')
            expect(node.length).toBe(1)

            const pos: cytoscape.Position = node.position()
            expect(pos.x).toBe(100)
            expect(pos.y).toBe(100)
        })

        it('collapsing and expanding does not affect positions of nodes outside the folder', () => {
            syncFolderTree('/vault')
            syncVaultStateFromMain({ readPaths: [], writeFolder: '/vault', starredFolders: [] })

            const outsideNode: GraphNode = {
                absoluteFilePathIsID: '/vault/readme.md',
                contentWithoutYamlOrLinks: '# Readme',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const insideNode: GraphNode = {
                absoluteFilePathIsID: '/vault/auth/login-flow.md',
                contentWithoutYamlOrLinks: '# Login Flow',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(outsideNode), upsert(insideNode)])

            // Renderer moves the outside node
            cy.getElementById('/vault/readme.md').position({ x: 800, y: 700 })

            // Collapse the folder
            setTestCollapseSet(new Set(['/vault/auth/']))
            applyDeltaToUI(cy, [upsert(outsideNode), upsert(insideNode)])

            // Expand the folder
            setTestCollapseSet(new Set())
            applyDeltaToUI(cy, [upsert(outsideNode), upsert(insideNode)])

            const pos: cytoscape.Position = cy.getElementById('/vault/readme.md').position()
            expect(pos.x).toBe(800)
            expect(pos.y).toBe(700)
        })
    })
})
