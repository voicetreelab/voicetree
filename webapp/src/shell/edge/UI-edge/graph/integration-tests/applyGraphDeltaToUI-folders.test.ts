// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import type { GraphNode } from '@vt/graph-model/graph'
import { syncProjectStateFromMain } from '@/shell/edge/UI-edge/state/stores/ProjectPathStore'
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
        syncProjectStateFromMain({ readPaths: [], writeFolderPath: null, starredFolders: [] })
    })

    describe('Recursive folder chains within loaded roots', () => {
        it('creates nested folder parents within the loaded root and projects collapsed folders from the collapse store', () => {
            syncProjectStateFromMain({ readPaths: [], writeFolderPath: '/project', starredFolders: [] })
            syncFolderTree('/project')
            setTestCollapseSet(new Set(['/project/auth/internal/']))

            const directChild: GraphNode = {
                absoluteFilePathIsID: '/project/auth/login-flow.md',
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
                absoluteFilePathIsID: '/project/auth/internal/refresh-token.md',
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

            expect(cy.getElementById('/project/').length).toBe(0)
            expect(cy.getElementById('/project/auth/').length).toBe(1)
            expect(cy.getElementById('/project/auth/').data('parent')).toBeUndefined()

            const nestedFolder: cytoscape.CollectionReturnValue = cy.getElementById('/project/auth/internal/')
            expect(nestedFolder.length).toBe(1)
            expect(nestedFolder.data('parent')).toBe('/project/auth/')
            expect(nestedFolder.data('collapsed')).toBe(true)
            expect(nestedFolder.data('childCount')).toBe(1)

            expect(cy.getElementById('/project/auth/login-flow.md').length).toBe(1)
            expect(cy.getElementById('/project/auth/login-flow.md').data('parent')).toBe('/project/auth/')
            expect(cy.getElementById('/project/auth/internal/refresh-token.md').length).toBe(0)
        })

        it('projects synced folder roots before ProjectPathStore is synced', () => {
            syncFolderTree('/project')
            setTestCollapseSet(new Set(['/project/auth/internal/']))

            const rootFile: GraphNode = {
                absoluteFilePathIsID: '/project/readme.md',
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
                absoluteFilePathIsID: '/project/auth/internal/refresh-token.md',
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

            expect(cy.getElementById('/project/auth/').length).toBe(1)
            expect(cy.getElementById('/project/auth/internal/').data('parent')).toBe('/project/auth/')
            expect(cy.getElementById('/project/auth/internal/').data('collapsed')).toBe(true)
            expect(cy.getElementById('/project/auth/internal/refresh-token.md').length).toBe(0)
        })

        it('keeps using the synced folder root across sequential deltas before ProjectPathStore is synced', () => {
            syncFolderTree('/project')
            setTestCollapseSet(new Set(['/project/auth/internal/']))

            const rootFile: GraphNode = {
                absoluteFilePathIsID: '/project/readme.md',
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
                absoluteFilePathIsID: '/project/auth/login-flow.md',
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
                absoluteFilePathIsID: '/project/auth/internal/refresh-token.md',
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

            expect(cy.getElementById('/project/auth/').length).toBe(1)
            expect(cy.getElementById('/project/auth/internal/').data('parent')).toBe('/project/auth/')
            expect(cy.getElementById('/project/auth/internal/').data('collapsed')).toBe(true)
            expect(cy.getElementById('/project/auth/internal/refresh-token.md').length).toBe(0)
        })
    })

    describe('Folder node content projection', () => {
        it('inserts folder nodes with content', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder')))

            const folderNode: cytoscape.CollectionReturnValue = cy.getElementById('/project/topic/')
            expect(folderNode.data('content')).toBe('# Topic\n\nbody')
            expect(folderNode.data('isFolderNode')).toBe(true)
        })

        it('updates existing folder node content', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder')))

            applySpecToUI(
                cy,
                specWithNodes(folderSpecNode('folder', { content: '# Topic\n\nupdated' })),
            )

            expect(cy.getElementById('/project/topic/').data('content')).toBe('# Topic\n\nupdated')
        })

        it('moves an existing folder node back to graph root when the next projection removes its parent', () => {
            const parent = folderSpecNode('folder', {
                id: '/project/workspace/',
                label: 'workspace',
                relPath: 'workspace/',
                basename: 'workspace',
                folderPath: '/project/',
            })
            const child = folderSpecNode('folder', {
                id: '/project/workspace/feature/',
                label: 'feature',
                relPath: 'workspace/feature/',
                basename: 'feature',
                folderPath: '/project/workspace/',
                parent: '/project/workspace/',
            })

            applySpecToUI(cy, specWithNodes(parent, child))
            expect(cy.getElementById('/project/workspace/feature/').data('parent')).toBe('/project/workspace/')

            applySpecToUI(cy, specWithNodes({ ...child, parent: undefined }))
            const featureFolder: cytoscape.CollectionReturnValue = cy.getElementById('/project/workspace/feature/')
            const serializedFeatureFolder = cy.json().elements.nodes.find((node) =>
                node.data.id === '/project/workspace/feature/'
            )
            expect(cy.getElementById('/project/workspace/').length).toBe(0)
            expect(featureFolder.length).toBe(1)
            expect(featureFolder.data('parent')).toBeUndefined()
            expect(serializedFeatureFolder?.data).not.toHaveProperty('parent')
        })

        it('inserts collapsed folder nodes with content', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder-collapsed')))

            const folderNode: cytoscape.CollectionReturnValue = cy.getElementById('/project/topic/')
            expect(folderNode.data('content')).toBe('# Topic\n\nbody')
            expect(folderNode.data('collapsed')).toBe(true)
            expect(folderNode.data('childCount')).toBe(2)
        })
    })

    describe('Folder size projection', () => {
        // The persisted size is applied as folderWidth/folderHeight node data;
        // the stylesheet (defaultNodeStyles) maps that data to the compound's
        // min-width/min-height. Headless cytoscape computes no styles, so we
        // assert the data-driving values the stylesheet consumes.
        it('stamps a sized expanded folder with folderWidth/folderHeight data', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder', { size: { width: 420, height: 360 } })))

            const folder = cy.getElementById('/project/topic/')
            expect(folder.data('folderWidth')).toBe(420)
            expect(folder.data('folderHeight')).toBe(360)
        })

        it('leaves an unsized expanded folder without size data', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder')))

            const folder = cy.getElementById('/project/topic/')
            expect(folder.data('folderWidth')).toBeUndefined()
            expect(folder.data('folderHeight')).toBeUndefined()
        })

        it('clears size data when a sized folder is re-projected without a size', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder', { size: { width: 420, height: 360 } })))
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder')))

            const folder = cy.getElementById('/project/topic/')
            expect(folder.data('folderWidth')).toBeUndefined()
            expect(folder.data('folderHeight')).toBeUndefined()
        })

        it('does not stamp size data on a collapsed folder pill', () => {
            applySpecToUI(cy, specWithNodes(folderSpecNode('folder-collapsed', { size: { width: 420, height: 360 } })))

            const folder = cy.getElementById('/project/topic/')
            expect(folder.data('folderWidth')).toBeUndefined()
            expect(folder.data('folderHeight')).toBeUndefined()
        })
    })
})
