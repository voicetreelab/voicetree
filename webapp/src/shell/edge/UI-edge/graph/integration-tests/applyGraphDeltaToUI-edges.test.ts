// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import type { ProjectedEdge, ProjectedGraph, ProjectedNode } from '@vt/graph-state/contract'
import { syncProjectStateFromMain } from '@/shell/edge/UI-edge/state/stores/ProjectPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { O, upsert, applyDeltaToUI, applySpecToUI } from './applyGraphDeltaToUI.test-utils'

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
        syncProjectStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    describe('Edge handling', () => {
        it('refreshes metadata for existing projected edges', () => {
            const source: ProjectedNode = {
                id: '/project/auth/',
                kind: 'folder-collapsed',
                label: 'auth',
                relPath: 'auth/',
                basename: 'auth',
                folderPath: '/project/',
                content: '# auth',
                loadState: 'loaded',
                isWriteTarget: true,
                childCount: 4,
            }
            const target: ProjectedNode = {
                id: '/project/api/gateway.md',
                kind: 'file',
                label: 'gateway',
                relPath: 'api/gateway.md',
                basename: 'gateway',
                folderPath: '/project/api/',
                content: '# gateway',
            }
            const graphWithEdge = (edge: ProjectedEdge): ProjectedGraph => ({
                nodes: [source, target],
                edges: [edge],
                rootPath: '/project',
                revision: 1,
                forests: [],
                arboricity: 0,
                recentNodeIds: [],
            })
            const edgeBase = {
                id: 'synthetic:/project/auth/:out:/project/api/gateway.md',
                source: source.id,
                target: target.id,
            } as const

            applySpecToUI(cy, graphWithEdge({
                ...edgeBase,
                kind: 'synthetic',
                edgeCount: 2,
                classes: ['synthetic-folder-edge'],
            }))

            applySpecToUI(cy, graphWithEdge({
                ...edgeBase,
                kind: 'synthetic',
                edgeCount: 3,
                classes: ['synthetic-folder-edge', 'updated'],
            }))

            const updatedEdge: cytoscape.CollectionReturnValue = cy.getElementById(edgeBase.id)
            expect(updatedEdge.data('kind')).toBe('synthetic')
            expect(updatedEdge.data('isSyntheticEdge')).toBe(true)
            expect(updatedEdge.data('edgeCount')).toBe(3)
            expect(updatedEdge.hasClass('synthetic-folder-edge')).toBe(true)
            expect(updatedEdge.hasClass('updated')).toBe(true)

            applySpecToUI(cy, graphWithEdge({
                ...edgeBase,
                kind: 'real',
            }))

            const realEdge: cytoscape.CollectionReturnValue = cy.getElementById(edgeBase.id)
            expect(realEdge.data('kind')).toBe('real')
            expect(realEdge.data('isSyntheticEdge')).toBeUndefined()
            expect(realEdge.data('edgeCount')).toBeUndefined()
            expect(realEdge.hasClass('synthetic-folder-edge')).toBe(false)
            expect(realEdge.hasClass('updated')).toBe(false)
        })

        it('should not create duplicate edges', () => {
            const parent: GraphNode = {
                absoluteFilePathIsID: 'parent',
                contentWithoutYamlOrLinks: '# Parent',
                outgoingEdges: [{ targetId: 'child', label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 100 }),
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const delta1: ReturnType<typeof upsert>[] = [upsert(parent), upsert(child)]
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
                    additionalYAMLProps: {},
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
