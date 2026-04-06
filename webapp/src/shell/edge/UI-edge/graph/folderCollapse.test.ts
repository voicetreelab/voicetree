/**
 * BF-113: Synthetic Edges on Collapsed Folders
 *
 * Tests all 8 spec scenarios for synthetic edge creation/removal
 * when folders are collapsed and expanded in the Cytoscape graph.
 *
 * NOTE: collapsedFolders is module-level state that persists across tests.
 * Each test uses unique folder IDs to avoid state leakage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import cytoscape from 'cytoscape'
import type { Core, CollectionReturnValue } from 'cytoscape'

// Mock electronAPI for expandFolder's getGraph call
const mockGetGraph: Mock = vi.fn()
vi.stubGlobal('electronAPI', undefined)
// @ts-expect-error — setting electronAPI on window for test
window.electronAPI = { main: { getGraph: mockGetGraph } }

import {
    collapseFolder,
    expandFolder,
    isFolderCollapsed,
    addOrUpdateSyntheticEdge,
    findCollapsedAncestorFolder,
} from '@/shell/edge/UI-edge/graph/folderCollapse'

describe('BF-113: Synthetic Edges on Collapsed Folders', () => {
    let cy: Core

    beforeEach(() => {
        cy = cytoscape({ headless: true, elements: [] })
        mockGetGraph.mockReset()
    })

    afterEach(() => {
        cy.destroy()
    })

    // S1: Incoming cross-boundary edge
    describe('S1: Incoming cross-boundary edge', () => {
        it('should create synthetic nodeA → folder when folder is collapsed', () => {
            cy.add([
                { group: 'nodes', data: { id: 's1-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's1/', isFolderNode: true, folderLabel: 's1' } },
                { group: 'nodes', data: { id: 's1/childB.md', label: 'Child B', parent: 's1/' }, position: { x: 100, y: 50 } },
                { group: 'edges', data: { id: 's1-nodeA->s1/childB.md', source: 's1-nodeA', target: 's1/childB.md', label: 'uses' } },
            ])

            collapseFolder(cy, 's1/')

            // Original edge removed (child removed)
            expect(cy.getElementById('s1-nodeA->s1/childB.md').length).toBe(0)
            // Synthetic edge created
            const synth: CollectionReturnValue = cy.getElementById('synthetic:s1/:in:s1-nodeA')
            expect(synth.length).toBe(1)
            expect(synth.data('source')).toBe('s1-nodeA')
            expect(synth.data('target')).toBe('s1/')
            expect(synth.data('isSyntheticEdge')).toBe(true)
            expect(synth.data('label')).toBe('uses')
        })

        it('should remove synthetic edge when folder is expanded', async () => {
            cy.add([
                { group: 'nodes', data: { id: 's1e-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's1e/', isFolderNode: true, folderLabel: 's1e' } },
                { group: 'nodes', data: { id: 's1e/childB.md', label: 'Child B', parent: 's1e/' }, position: { x: 100, y: 50 } },
                { group: 'edges', data: { id: 's1e-nodeA->s1e/childB.md', source: 's1e-nodeA', target: 's1e/childB.md', label: 'uses' } },
            ])

            collapseFolder(cy, 's1e/')
            expect(cy.getElementById('synthetic:s1e/:in:s1e-nodeA').length).toBe(1)

            // Mock getGraph for expand — use fp-ts Option format
            const O: typeof import('fp-ts/lib/Option.js') = await import('fp-ts/lib/Option.js')
            mockGetGraph.mockResolvedValue({
                nodes: {
                    's1e/childB.md': {
                        absoluteFilePathIsID: 's1e/childB.md',
                        contentWithoutYamlOrLinks: '# Child B',
                        outgoingEdges: [],
                        nodeUIMetadata: { color: O.none, position: O.some({ x: 100, y: 50 }), isContextNode: false }
                    }
                },
                incomingEdgesIndex: new Map([['s1e/childB.md', ['s1e-nodeA']]])
            })

            await expandFolder(cy, 's1e/')

            // Synthetic edge removed
            expect(cy.getElementById('synthetic:s1e/:in:s1e-nodeA').length).toBe(0)
            expect(isFolderCollapsed('s1e/')).toBe(false)
        })
    })

    // S2: Outgoing cross-boundary edge
    describe('S2: Outgoing cross-boundary edge', () => {
        it('should create synthetic folder → nodeA when child has outgoing edge', () => {
            cy.add([
                { group: 'nodes', data: { id: 's2-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's2/', isFolderNode: true, folderLabel: 's2' } },
                { group: 'nodes', data: { id: 's2/childB.md', label: 'Child B', parent: 's2/' }, position: { x: 100, y: 50 } },
                { group: 'edges', data: { id: 's2/childB.md->s2-nodeA', source: 's2/childB.md', target: 's2-nodeA', label: 'depends' } },
            ])

            collapseFolder(cy, 's2/')

            const synth: CollectionReturnValue = cy.getElementById('synthetic:s2/:out:s2-nodeA')
            expect(synth.length).toBe(1)
            expect(synth.data('source')).toBe('s2/')
            expect(synth.data('target')).toBe('s2-nodeA')
            expect(synth.data('isSyntheticEdge')).toBe(true)
            expect(synth.data('label')).toBe('depends')
        })
    })

    // S3: Deduplication — multiple children → same external
    describe('S3: Deduplication', () => {
        it('should create ONE synthetic edge with edgeCount when multiple children connect to same external', () => {
            cy.add([
                { group: 'nodes', data: { id: 's3-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's3/', isFolderNode: true, folderLabel: 's3' } },
                { group: 'nodes', data: { id: 's3/childB.md', label: 'Child B', parent: 's3/' }, position: { x: 100, y: 50 } },
                { group: 'nodes', data: { id: 's3/childC.md', label: 'Child C', parent: 's3/' }, position: { x: 150, y: 50 } },
                { group: 'edges', data: { id: 's3-nodeA->s3/childB.md', source: 's3-nodeA', target: 's3/childB.md', label: 'ref1' } },
                { group: 'edges', data: { id: 's3-nodeA->s3/childC.md', source: 's3-nodeA', target: 's3/childC.md', label: 'ref2' } },
            ])

            collapseFolder(cy, 's3/')

            const synth: CollectionReturnValue = cy.getElementById('synthetic:s3/:in:s3-nodeA')
            expect(synth.length).toBe(1)
            expect(synth.data('edgeCount')).toBe(2)
            // No label when multiple (ambiguous)
            expect(synth.data('label')).toBeUndefined()
        })
    })

    // S4: Nested folders
    describe('S4: Nested folders', () => {
        it('should create synthetic nodeA → outerFolder when collapsing outer folder with nested sub-folder', () => {
            cy.add([
                { group: 'nodes', data: { id: 's4-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's4/', isFolderNode: true, folderLabel: 's4' } },
                { group: 'nodes', data: { id: 's4/sub/', isFolderNode: true, folderLabel: 'sub', parent: 's4/' } },
                { group: 'nodes', data: { id: 's4/sub/deep.md', label: 'Deep', parent: 's4/sub/' }, position: { x: 100, y: 100 } },
                { group: 'edges', data: { id: 's4-nodeA->s4/sub/deep.md', source: 's4-nodeA', target: 's4/sub/deep.md', label: 'deep-ref' } },
            ])

            collapseFolder(cy, 's4/')

            const synth: CollectionReturnValue = cy.getElementById('synthetic:s4/:in:s4-nodeA')
            expect(synth.length).toBe(1)
            expect(synth.data('target')).toBe('s4/')
            expect(synth.data('label')).toBe('deep-ref')
        })

        it('should create synthetic nodeA → sub-folder when only sub-folder is collapsed', () => {
            cy.add([
                { group: 'nodes', data: { id: 's4b-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's4b/', isFolderNode: true, folderLabel: 's4b' } },
                { group: 'nodes', data: { id: 's4b/sub/', isFolderNode: true, folderLabel: 'sub', parent: 's4b/' } },
                { group: 'nodes', data: { id: 's4b/sub/deep.md', label: 'Deep', parent: 's4b/sub/' }, position: { x: 100, y: 100 } },
                { group: 'edges', data: { id: 's4b-nodeA->s4b/sub/deep.md', source: 's4b-nodeA', target: 's4b/sub/deep.md', label: 'deep-ref' } },
            ])

            collapseFolder(cy, 's4b/sub/')

            const synth: CollectionReturnValue = cy.getElementById('synthetic:s4b/sub/:in:s4b-nodeA')
            expect(synth.length).toBe(1)
            expect(synth.data('target')).toBe('s4b/sub/')
        })
    })

    // S5: Edge labels
    describe('S5: Edge labels', () => {
        it('should inherit label for single cross-boundary edge', () => {
            cy.add([
                { group: 'nodes', data: { id: 's5-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's5/', isFolderNode: true, folderLabel: 's5' } },
                { group: 'nodes', data: { id: 's5/childB.md', label: 'Child B', parent: 's5/' }, position: { x: 100, y: 50 } },
                { group: 'edges', data: { id: 's5-nodeA->s5/childB.md', source: 's5-nodeA', target: 's5/childB.md', label: 'single-label' } },
            ])

            collapseFolder(cy, 's5/')

            const synth: CollectionReturnValue = cy.getElementById('synthetic:s5/:in:s5-nodeA')
            expect(synth.data('label')).toBe('single-label')
            expect(synth.data('edgeCount')).toBeUndefined()
        })

        it('should show edgeCount and no label for multiple edges from same external', () => {
            cy.add([
                { group: 'nodes', data: { id: 's5b-nodeA', label: 'Node A' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 's5b/', isFolderNode: true, folderLabel: 's5b' } },
                { group: 'nodes', data: { id: 's5b/childB.md', label: 'Child B', parent: 's5b/' }, position: { x: 100, y: 50 } },
                { group: 'nodes', data: { id: 's5b/childC.md', label: 'Child C', parent: 's5b/' }, position: { x: 150, y: 50 } },
                { group: 'edges', data: { id: 's5b-nodeA->s5b/childB.md', source: 's5b-nodeA', target: 's5b/childB.md', label: 'label1' } },
                { group: 'edges', data: { id: 's5b-nodeA->s5b/childC.md', source: 's5b-nodeA', target: 's5b/childC.md', label: 'label2' } },
            ])

            collapseFolder(cy, 's5b/')

            const synth: CollectionReturnValue = cy.getElementById('synthetic:s5b/:in:s5b-nodeA')
            expect(synth.data('label')).toBeUndefined()
            expect(synth.data('edgeCount')).toBe(2)
        })
    })

    // S7: Both endpoints inside same folder (internal-only)
    describe('S7: Internal-only edges', () => {
        it('should NOT create synthetic edge when both endpoints are inside the folder', () => {
            cy.add([
                { group: 'nodes', data: { id: 's7/', isFolderNode: true, folderLabel: 's7' } },
                { group: 'nodes', data: { id: 's7/childB.md', label: 'Child B', parent: 's7/' }, position: { x: 100, y: 50 } },
                { group: 'nodes', data: { id: 's7/childC.md', label: 'Child C', parent: 's7/' }, position: { x: 150, y: 50 } },
                { group: 'edges', data: { id: 's7/childB.md->s7/childC.md', source: 's7/childB.md', target: 's7/childC.md' } },
            ])

            collapseFolder(cy, 's7/')

            const synthetics: CollectionReturnValue = cy.edges('[?isSyntheticEdge]')
            expect(synthetics.length).toBe(0)
        })
    })

    // S8: Cross-collapsed-folder edges
    describe('S8: Cross-collapsed-folder edges', () => {
        it('should handle collapsing both folders without crashing', () => {
            cy.add([
                { group: 'nodes', data: { id: 's8F/', isFolderNode: true, folderLabel: 'F' } },
                { group: 'nodes', data: { id: 's8F/childA.md', label: 'Child A', parent: 's8F/' }, position: { x: 0, y: 50 } },
                { group: 'nodes', data: { id: 's8G/', isFolderNode: true, folderLabel: 'G' } },
                { group: 'nodes', data: { id: 's8G/childB.md', label: 'Child B', parent: 's8G/' }, position: { x: 200, y: 50 } },
                { group: 'edges', data: { id: 's8F/childA.md->s8G/childB.md', source: 's8F/childA.md', target: 's8G/childB.md' } },
            ])

            // Collapse F — synthetic F → childB (childB still visible)
            collapseFolder(cy, 's8F/')
            const synthAfterF: CollectionReturnValue = cy.getElementById('synthetic:s8F/:out:s8G/childB.md')
            expect(synthAfterF.length).toBe(1)

            // Collapse G — childB removed, F's synthetic to childB auto-removed by Cytoscape
            collapseFolder(cy, 's8G/')

            // Both folders collapsed, no crash
            expect(isFolderCollapsed('s8F/')).toBe(true)
            expect(isFolderCollapsed('s8G/')).toBe(true)
        })
    })

    // addOrUpdateSyntheticEdge unit tests
    describe('addOrUpdateSyntheticEdge', () => {
        it('should create a new synthetic edge', () => {
            cy.add([
                { group: 'nodes', data: { id: 'au-nodeA' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 'au/', isFolderNode: true } },
            ])

            addOrUpdateSyntheticEdge(cy, 'au/', 'incoming', 'au-nodeA', {
                sourceId: 'au-nodeA', targetId: 'au/child.md', label: 'test'
            })

            const synth: CollectionReturnValue = cy.getElementById('synthetic:au/:in:au-nodeA')
            expect(synth.length).toBe(1)
            expect(synth.data('source')).toBe('au-nodeA')
            expect(synth.data('target')).toBe('au/')
            expect(synth.data('label')).toBe('test')
        })

        it('should increment edgeCount and clear label on second call', () => {
            cy.add([
                { group: 'nodes', data: { id: 'au2-nodeA' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 'au2/', isFolderNode: true } },
            ])

            addOrUpdateSyntheticEdge(cy, 'au2/', 'incoming', 'au2-nodeA', {
                sourceId: 'au2-nodeA', targetId: 'au2/child1.md', label: 'first'
            })
            addOrUpdateSyntheticEdge(cy, 'au2/', 'incoming', 'au2-nodeA', {
                sourceId: 'au2-nodeA', targetId: 'au2/child2.md', label: 'second'
            })

            const synth: CollectionReturnValue = cy.getElementById('synthetic:au2/:in:au2-nodeA')
            expect(synth.data('edgeCount')).toBe(2)
            // Label should be cleared after dedup (bug fix: removeData instead of data(key, undefined))
            expect(synth.data('label')).toBeUndefined()
        })

        it('should filter self-loops (external same as folder)', () => {
            cy.add([
                { group: 'nodes', data: { id: 'au3/', isFolderNode: true } },
            ])

            addOrUpdateSyntheticEdge(cy, 'au3/', 'incoming', 'au3/', {
                sourceId: 'au3/', targetId: 'au3/child.md'
            })

            expect(cy.edges().length).toBe(0)
        })
    })

    // findCollapsedAncestorFolder
    describe('findCollapsedAncestorFolder', () => {
        it('should return null when no ancestor folder is collapsed', () => {
            // Use a path whose folder parent was never collapsed
            expect(findCollapsedAncestorFolder('never-collapsed/child.md')).toBeNull()
        })

        it('should return the collapsed folder when direct parent is collapsed', () => {
            cy.add([
                { group: 'nodes', data: { id: 'fca/', isFolderNode: true, folderLabel: 'fca' } },
                { group: 'nodes', data: { id: 'fca/child.md', label: 'Child', parent: 'fca/' }, position: { x: 0, y: 0 } },
            ])
            collapseFolder(cy, 'fca/')

            expect(findCollapsedAncestorFolder('fca/child.md')).toBe('fca/')
        })

        it('should return the nearest collapsed ancestor for deeply nested nodes', () => {
            cy.add([
                { group: 'nodes', data: { id: 'fca2/', isFolderNode: true } },
                { group: 'nodes', data: { id: 'fca2/b/', isFolderNode: true, parent: 'fca2/' } },
                { group: 'nodes', data: { id: 'fca2/b/c.md', parent: 'fca2/b/' }, position: { x: 0, y: 0 } },
            ])

            collapseFolder(cy, 'fca2/')

            expect(findCollapsedAncestorFolder('fca2/b/c.md')).toBe('fca2/')
        })
    })

    // isFolderCollapsed state tracking
    describe('isFolderCollapsed', () => {
        it('should return true after collapse', () => {
            cy.add([
                { group: 'nodes', data: { id: 'ifc/', isFolderNode: true, folderLabel: 'ifc' } },
                { group: 'nodes', data: { id: 'ifc/child.md', label: 'Child', parent: 'ifc/' }, position: { x: 0, y: 0 } },
            ])

            expect(isFolderCollapsed('ifc/')).toBe(false)
            collapseFolder(cy, 'ifc/')
            expect(isFolderCollapsed('ifc/')).toBe(true)
        })

        it('should return false for non-existent folders', () => {
            expect(isFolderCollapsed('totally-unique-nonexistent/')).toBe(false)
        })
    })

    // collapseFolder guards
    describe('collapseFolder guards', () => {
        it('should no-op when node does not exist', () => {
            collapseFolder(cy, 'guard-nonexistent/')
            expect(isFolderCollapsed('guard-nonexistent/')).toBe(false)
        })

        it('should no-op when node is not a folder', () => {
            cy.add({ group: 'nodes', data: { id: 'guard-regular.md', label: 'Regular' }, position: { x: 0, y: 0 } })
            collapseFolder(cy, 'guard-regular.md')
            expect(isFolderCollapsed('guard-regular.md')).toBe(false)
        })

        it('should set childCount data on folder after collapse', () => {
            cy.add([
                { group: 'nodes', data: { id: 'guard/', isFolderNode: true, folderLabel: 'guard' } },
                { group: 'nodes', data: { id: 'guard/a.md', parent: 'guard/' }, position: { x: 0, y: 0 } },
                { group: 'nodes', data: { id: 'guard/b.md', parent: 'guard/' }, position: { x: 50, y: 0 } },
            ])
            collapseFolder(cy, 'guard/')
            expect(cy.getElementById('guard/').data('childCount')).toBe(2)
        })
    })
})
