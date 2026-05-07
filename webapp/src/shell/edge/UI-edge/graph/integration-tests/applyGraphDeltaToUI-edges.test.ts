// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import {
    getFolderTreeState,
    removeCollapsedFolderLocally,
} from '@/shell/edge/UI-edge/state/FolderTreeStore'
import { syncVaultStateFromMain } from '@/shell/edge/UI-edge/state/VaultPathStore'
import { resetRendererStateMirror } from '@/shell/edge/UI-edge/state/rendererStateMirror'
import { O, upsert, applyDeltaToUI } from './applyGraphDeltaToUI.test-utils'

vi.mock('@/shell/edge/UI-edge/graph/userEngagementPrompts', () => ({
    checkEngagementPrompts: vi.fn()
}))

describe('applyGraphDeltaToUI - Integration', () => {
    let cy: Core

    beforeEach(() => {
        resetRendererStateMirror()
        cy = cytoscape({ headless: true, elements: [] })
    })

    afterEach(() => {
        cy.destroy()
        getFolderTreeState().graphCollapsedFolders.forEach((folderId: string) => {
            removeCollapsedFolderLocally(folderId)
        })
        syncVaultStateFromMain({ readPaths: [], writePath: null, starredFolders: [] })
    })

    describe('Edge handling', () => {
        it('should not create duplicate edges', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const delta1 = [upsert(parent), upsert(child)]
            applyDeltaToUI(cy, delta1)
            applyDeltaToUI(cy, delta1)

            const edges: cytoscape.EdgeCollection = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })

        it('should not throw when same node appears twice in delta (healing scenario)', () => {
            // This test reproduces the bug where addNodeToGraph returns a delta with the same
            // node appearing twice (once as the new node, once as a "healed" node), causing
            // duplicate edge creation that throws Cytoscape error.
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'test-label' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            expect(() => applyDeltaToUI(cy, [upsert(child), upsert(parent), upsert(parent)])).not.toThrow()

            const edges: cytoscape.EdgeCollection = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })

        it('should not throw when same edge is in two consecutive deltas (file watcher race)', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(child), upsert(parent)])

            expect(() => applyDeltaToUI(cy, [upsert(parent)])).not.toThrow()

            const edges: cytoscape.EdgeCollection = cy.edges(`[id = "parent->child"]`)
            expect(edges.length).toBe(1)
        })

        it('should set edge label when creating edges with non-empty labels', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'is parent of' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent), upsert(child)])

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('is parent of')
        })

        it('should not set label when edge has empty label', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent), upsert(child)])

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBeUndefined()
        })

        it('should replace underscores with spaces in edge labels', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'is_a_prerequisite_for' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent), upsert(child)])

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('is a prerequisite for')
        })

        it('should handle edge labels with multiple underscores', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'this_is_a_complex_relationship_label' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent), upsert(child)])

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('this is a complex relationship label')
        })

        it('should handle edge labels without underscores', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'simple label' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent), upsert(child)])

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.length).toBe(1)
            expect(edge.data('label')).toBe('simple label')
        })

        it('should update edge label when relationship label changes in markdown', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: 'parent_of' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            const child: GraphNode = {
                absoluteFilePathIsID: 'child',
                contentWithoutYamlOrLinks: '# Child',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 200 }),
                    additionalYAMLProps: new Map(),
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(parent), upsert(child)])

            const edge: cytoscape.CollectionReturnValue = cy.getElementById('parent->child')
            expect(edge.data('label')).toBe('parent of')

            const updatedParent: GraphNode = {
                ...parent,
                outgoingEdges: [{ targetId: 'child', label: 'is_prerequisite_for' }]
            }

            applyDeltaToUI(cy, [upsert(updatedParent)])

            expect(edge.data('label')).toBe('is prerequisite for')
        })
    })
})
