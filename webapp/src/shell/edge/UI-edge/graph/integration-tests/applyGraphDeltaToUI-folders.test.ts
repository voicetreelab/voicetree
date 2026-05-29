// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import { syncVaultStateFromMain } from '@/shell/edge/UI-edge/state/stores/VaultPathStore'
import { resetTestProjectionState, setTestCollapseSet } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { O, upsert, applyDeltaToUI, applySpecToUI, folderSpecNode, specWithNodes, syncFolderTree } from './applyGraphDeltaToUI.test-utils'

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

    describe('Recursive folder chains within loaded roots', () => {
        it('creates nested folder parents within the loaded root and projects collapsed folders from the collapse store', () => {
            syncVaultStateFromMain({ readPaths: [], writeFolderPath: '/vault', starredFolders: [] })
            syncFolderTree('/vault')
            setTestCollapseSet(new Set(['/vault/auth/internal/']))

            const directChild: GraphNode = {
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

            const nestedChild: GraphNode = {
                absoluteFilePathIsID: '/vault/auth/internal/refresh-token.md',
                contentWithoutYamlOrLinks: '# Refresh Token',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(directChild), upsert(nestedChild)])

            expect(cy.getElementById('/vault/').length).toBe(0)
            expect(cy.getElementById('/vault/auth/').length).toBe(1)
            expect(cy.getElementById('/vault/auth/').data('parent')).toBeUndefined()

            const nestedFolder: cytoscape.CollectionReturnValue = cy.getElementById('/vault/auth/internal/')
            expect(nestedFolder.length).toBe(1)
            expect(nestedFolder.data('parent')).toBe('/vault/auth/')
            expect(nestedFolder.data('collapsed')).toBe(true)
            expect(nestedFolder.data('childCount')).toBe(1)

            expect(cy.getElementById('/vault/auth/login-flow.md').length).toBe(1)
            expect(cy.getElementById('/vault/auth/login-flow.md').data('parent')).toBe('/vault/auth/')
            expect(cy.getElementById('/vault/auth/internal/refresh-token.md').length).toBe(0)
        })

        it('projects synced folder roots before VaultPathStore is synced', () => {
            syncFolderTree('/vault')
            setTestCollapseSet(new Set(['/vault/auth/internal/']))

            const rootFile: GraphNode = {
                absoluteFilePathIsID: '/vault/readme.md',
                contentWithoutYamlOrLinks: '# Readme',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 50, y: 50 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const nestedChild: GraphNode = {
                absoluteFilePathIsID: '/vault/auth/internal/refresh-token.md',
                contentWithoutYamlOrLinks: '# Refresh Token',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(rootFile), upsert(nestedChild)])

            expect(cy.getElementById('/vault/auth/').length).toBe(1)
            expect(cy.getElementById('/vault/auth/internal/').data('parent')).toBe('/vault/auth/')
            expect(cy.getElementById('/vault/auth/internal/').data('collapsed')).toBe(true)
            expect(cy.getElementById('/vault/auth/internal/refresh-token.md').length).toBe(0)
        })

        it('keeps using the synced folder root across sequential deltas before VaultPathStore is synced', () => {
            syncFolderTree('/vault')
            setTestCollapseSet(new Set(['/vault/auth/internal/']))

            const rootFile: GraphNode = {
                absoluteFilePathIsID: '/vault/readme.md',
                contentWithoutYamlOrLinks: '# Readme',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 50, y: 50 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            const directChild: GraphNode = {
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

            const nestedChild: GraphNode = {
                absoluteFilePathIsID: '/vault/auth/internal/refresh-token.md',
                contentWithoutYamlOrLinks: '# Refresh Token',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 200, y: 100 }),
                    additionalYAMLProps: {},
                    isContextNode: false
                }
            }

            applyDeltaToUI(cy, [upsert(rootFile), upsert(directChild)])
            applyDeltaToUI(cy, [upsert(nestedChild)])

            expect(cy.getElementById('/vault/auth/').length).toBe(1)
            expect(cy.getElementById('/vault/auth/internal/').data('parent')).toBe('/vault/auth/')
            expect(cy.getElementById('/vault/auth/internal/').data('collapsed')).toBe(true)
            expect(cy.getElementById('/vault/auth/internal/refresh-token.md').length).toBe(0)
        })
    })

    describe('Folder node content projection', () => {
        it('inserts folder nodes with content', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder')))

            const folderNode: cytoscape.CollectionReturnValue = cy.getElementById('/vault/topic/')
            expect(folderNode.data('content')).toBe('# Topic\n\nbody')
            expect(folderNode.data('isFolderNode')).toBe(true)
        })

        it('updates existing folder node content', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder')))

            applySpecToUI(
                cy,
                specWithNodes(folderSpecNode('folder', { content: '# Topic\n\nupdated' })),
            )

            expect(cy.getElementById('/vault/topic/').data('content')).toBe('# Topic\n\nupdated')
        })

        it('moves an existing folder node back to graph root when the next projection removes its parent', () => {
            const parent = folderSpecNode('folder', {
                id: '/vault/workspace/',
                label: 'workspace',
                relPath: 'workspace/',
                basename: 'workspace',
                folderPath: '/vault/',
            })
            const child = folderSpecNode('folder', {
                id: '/vault/workspace/feature/',
                label: 'feature',
                relPath: 'workspace/feature/',
                basename: 'feature',
                folderPath: '/vault/workspace/',
                parent: '/vault/workspace/',
            })

            applySpecToUI(cy, specWithNodes(parent, child))
            expect(cy.getElementById('/vault/workspace/feature/').data('parent')).toBe('/vault/workspace/')

            applySpecToUI(cy, specWithNodes({ ...child, parent: undefined }))
            const featureFolder: cytoscape.CollectionReturnValue = cy.getElementById('/vault/workspace/feature/')
            const serializedFeatureFolder = cy.json().elements.nodes.find((node) =>
                node.data.id === '/vault/workspace/feature/'
            )
            expect(cy.getElementById('/vault/workspace/').length).toBe(0)
            expect(featureFolder.length).toBe(1)
            expect(featureFolder.data('parent')).toBeUndefined()
            expect(serializedFeatureFolder?.data).not.toHaveProperty('parent')
        })

        it('inserts collapsed folder nodes with content', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder-collapsed')))

            const folderNode: cytoscape.CollectionReturnValue = cy.getElementById('/vault/topic/')
            expect(folderNode.data('content')).toBe('# Topic\n\nbody')
            expect(folderNode.data('collapsed')).toBe(true)
            expect(folderNode.data('childCount')).toBe(2)
        })
    })
})
