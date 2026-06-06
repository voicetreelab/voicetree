// @vitest-environment jsdom
/**
 * Integration Test: Delete and Merge Operations with Filesystem Assertions
 *
 * BEHAVIOR TESTED:
 * 1. Delete with edge preservation: A → B → C becomes A → C when B is deleted
 * 2. Delete multiple nodes: All deletions and edge updates reflected in filesystem
 * 3. Merge operation: Files created, deleted, and edges redirected on disk
 * 4. Merge with context nodes: Context nodes deleted, only regular nodes merged
 *
 * Testing Strategy:
 * - Create actual markdown files in temp directory
 * - Call UI operations (deleteNodesFromUI, mergeSelectedNodesFromUI)
 * - Read filesystem to verify changes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import { createDeleteAndMergeFilesystemTestSupport } from './delete-and-merge-filesystem.test/__tests__/test-support'
import { deleteNodesFromUI } from '@/shell/edge/UI-edge/graph/actions/handleUIActions'
import { mergeSelectedNodesFromUI } from '@/shell/edge/UI-edge/graph/actions/mergeSelectedNodesFromUI'
import type { Graph } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'

const filesystemTest = createDeleteAndMergeFilesystemTestSupport()

describe('Delete with Edge Preservation - Filesystem Integration', () => {
    let cy: Core

    beforeEach(async () => {
        await filesystemTest.setupDeleteFilesystemTest()
    })

    afterEach(async () => {
        await filesystemTest.cleanupFilesystemTest(cy)
    })

    it('should delete middle node and remove the parent edge without transitive healing', async () => {
        // GIVEN: Chain A → B → C on filesystem
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'A.md', '# Node A', ['B.md'], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'B.md', '# Node B', ['C.md'], { x: 100, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'C.md', '# Node C', [], { x: 200, y: 0 })

        // Setup graph state
        const mockGraph: Graph = createGraph({
            'A.md': filesystemTest.createTestNode('A.md', '# Node A', [{ targetId: 'B.md', label: '' }], { x: 0, y: 0 }),
            'B.md': filesystemTest.createTestNode('B.md', '# Node B', [{ targetId: 'C.md', label: '' }], { x: 100, y: 0 }),
            'C.md': filesystemTest.createTestNode('C.md', '# Node C', [], { x: 200, y: 0 })
        })
        filesystemTest.setCurrentGraph(mockGraph)

        // Setup cytoscape
        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'A.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'B.md' }, position: { x: 100, y: 0 } },
                { group: 'nodes' as const, data: { id: 'C.md' }, position: { x: 200, y: 0 } },
                { group: 'edges' as const, data: { id: 'A.md-B.md', source: 'A.md', target: 'B.md' } },
                { group: 'edges' as const, data: { id: 'B.md-C.md', source: 'B.md', target: 'C.md' } }
            ]
        })

        // Setup window.hostAPI
        global.window = filesystemTest.createTestWindow(cy, false)

        // WHEN: Delete node B
        await deleteNodesFromUI(['B.md'], cy)

        // THEN: B.md should be deleted from filesystem
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('B.md'))).toBe(false)

        // AND: A.md should still exist, but its link to the deleted node should be removed.
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('A.md'))).toBe(true)
        const aLinks: string[] = await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('A.md'))
        expect(aLinks).not.toContain('B.md')
        expect(aLinks).toEqual([])

        // AND: C.md should still exist
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('C.md'))).toBe(true)
    })

    it('should delete multiple nodes from separate subtrees and clean parent edges', async () => {
        // GIVEN: Two separate branches: Parent1 → A → C and Parent2 → B → D
        // Deleting A and B should remove the direct parent links in each subtree independently.
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Parent1.md', '# Parent 1', ['A.md'], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'A.md', '# Node A', ['C.md'], { x: 0, y: 100 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'C.md', '# Node C', [], { x: 0, y: 200 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Parent2.md', '# Parent 2', ['B.md'], { x: 200, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'B.md', '# Node B', ['D.md'], { x: 200, y: 100 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'D.md', '# Node D', [], { x: 200, y: 200 })

        const mockGraph: Graph = createGraph({
            'Parent1.md': filesystemTest.createTestNode('Parent1.md', '# Parent 1', [{ targetId: 'A.md', label: '' }], { x: 0, y: 0 }),
            'A.md': filesystemTest.createTestNode('A.md', '# Node A', [{ targetId: 'C.md', label: '' }], { x: 0, y: 100 }),
            'C.md': filesystemTest.createTestNode('C.md', '# Node C', [], { x: 0, y: 200 }),
            'Parent2.md': filesystemTest.createTestNode('Parent2.md', '# Parent 2', [{ targetId: 'B.md', label: '' }], { x: 200, y: 0 }),
            'B.md': filesystemTest.createTestNode('B.md', '# Node B', [{ targetId: 'D.md', label: '' }], { x: 200, y: 100 }),
            'D.md': filesystemTest.createTestNode('D.md', '# Node D', [], { x: 200, y: 200 })
        })
        filesystemTest.setCurrentGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Parent1.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'A.md' }, position: { x: 0, y: 100 } },
                { group: 'nodes' as const, data: { id: 'C.md' }, position: { x: 0, y: 200 } },
                { group: 'nodes' as const, data: { id: 'Parent2.md' }, position: { x: 200, y: 0 } },
                { group: 'nodes' as const, data: { id: 'B.md' }, position: { x: 200, y: 100 } },
                { group: 'nodes' as const, data: { id: 'D.md' }, position: { x: 200, y: 200 } },
                { group: 'edges' as const, data: { source: 'Parent1.md', target: 'A.md' } },
                { group: 'edges' as const, data: { source: 'A.md', target: 'C.md' } },
                { group: 'edges' as const, data: { source: 'Parent2.md', target: 'B.md' } },
                { group: 'edges' as const, data: { source: 'B.md', target: 'D.md' } }
            ]
        })

        global.window = filesystemTest.createTestWindow(cy, false)

        // WHEN: Delete both A and B (from separate subtrees)
        await deleteNodesFromUI(['A.md', 'B.md'], cy)

        // THEN: Both A.md and B.md should be deleted
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('A.md'))).toBe(false)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('B.md'))).toBe(false)

        // AND: Parent1.md should no longer link to the deleted child.
        const parent1Links: string[] = await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('Parent1.md'))
        expect(parent1Links).not.toContain('A.md')
        expect(parent1Links).toEqual([])

        // AND: Parent2.md should no longer link to the deleted child.
        const parent2Links: string[] = await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('Parent2.md'))
        expect(parent2Links).not.toContain('B.md')
        expect(parent2Links).toEqual([])

        // AND: C.md and D.md should still exist
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('C.md'))).toBe(true)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('D.md'))).toBe(true)
    })

    it('should delete multiple CONNECTED nodes in a chain and remove stale parent edges', async () => {
        // BUG REPRODUCTION: When deleting multiple nodes that are directly connected,
        // the delta computation uses stale graph state. deleteNodeSimple
        // is called for each node with the ORIGINAL graph, not accounting for other deletions.
        // This can cause crashes or incorrect edge updates when a node being updated is also
        // being deleted.
        //
        // GIVEN: Chain Parent → A → B → C
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Parent.md', '# Parent', ['A.md'], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'A.md', '# Node A', ['B.md'], { x: 0, y: 100 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'B.md', '# Node B', ['C.md'], { x: 0, y: 200 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'C.md', '# Node C', [], { x: 0, y: 300 })

        const mockGraph: Graph = createGraph({
            'Parent.md': filesystemTest.createTestNode('Parent.md', '# Parent', [{ targetId: 'A.md', label: '' }], { x: 0, y: 0 }),
            'A.md': filesystemTest.createTestNode('A.md', '# Node A', [{ targetId: 'B.md', label: '' }], { x: 0, y: 100 }),
            'B.md': filesystemTest.createTestNode('B.md', '# Node B', [{ targetId: 'C.md', label: '' }], { x: 0, y: 200 }),
            'C.md': filesystemTest.createTestNode('C.md', '# Node C', [], { x: 0, y: 300 })
        })
        filesystemTest.setCurrentGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Parent.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'A.md' }, position: { x: 0, y: 100 } },
                { group: 'nodes' as const, data: { id: 'B.md' }, position: { x: 0, y: 200 } },
                { group: 'nodes' as const, data: { id: 'C.md' }, position: { x: 0, y: 300 } },
                { group: 'edges' as const, data: { source: 'Parent.md', target: 'A.md' } },
                { group: 'edges' as const, data: { source: 'A.md', target: 'B.md' } },
                { group: 'edges' as const, data: { source: 'B.md', target: 'C.md' } }
            ]
        })

        global.window = filesystemTest.createTestWindow(cy, false)

        // WHEN: Delete A and B together (connected nodes in the chain)
        await deleteNodesFromUI(['A.md', 'B.md'], cy)

        // THEN: Both A.md and B.md should be deleted
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('A.md'))).toBe(false)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('B.md'))).toBe(false)

        // AND: Parent.md should simply lose its edge to the deleted chain.
        const parentLinks: string[] = await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('Parent.md'))
        expect(parentLinks).not.toContain('A.md')
        expect(parentLinks).not.toContain('B.md')
        expect(parentLinks).toEqual([])

        // AND: C.md should still exist
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('C.md'))).toBe(true)
    })
})

describe('Merge Operation - Filesystem Integration', () => {
    let cy: Core

    beforeEach(async () => {
        await filesystemTest.setupMergeFilesystemTest('test-project-merge')
    })

    afterEach(async () => {
        await filesystemTest.cleanupFilesystemTest(cy)
    })

    it('should merge nodes and redirect external incomer edges on filesystem', async () => {
        // GIVEN: External → Internal1 → Internal2
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'External.md', '# External', ['Internal1.md'], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Internal1.md', '# Internal 1', ['Internal2.md'], { x: 100, y: 100 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Internal2.md', '# Internal 2', [], { x: 100, y: 200 })

        const mockGraph: Graph = createGraph({
            'External.md': filesystemTest.createTestNode('External.md', '# External', [{ targetId: 'Internal1.md', label: '' }], { x: 0, y: 0 }),
            'Internal1.md': filesystemTest.createTestNode('Internal1.md', '# Internal 1', [{ targetId: 'Internal2.md', label: '' }], { x: 100, y: 100 }),
            'Internal2.md': filesystemTest.createTestNode('Internal2.md', '# Internal 2', [], { x: 100, y: 200 })
        })
        filesystemTest.setCurrentGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'External.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Internal1.md' }, position: { x: 100, y: 100 } },
                { group: 'nodes' as const, data: { id: 'Internal2.md' }, position: { x: 100, y: 200 } },
                { group: 'edges' as const, data: { source: 'External.md', target: 'Internal1.md' } },
                { group: 'edges' as const, data: { source: 'Internal1.md', target: 'Internal2.md' } }
            ]
        })

        global.window = filesystemTest.createTestWindow(cy, true)

        // WHEN: Merge Internal1 and Internal2
        await mergeSelectedNodesFromUI(['Internal1.md', 'Internal2.md'], cy)

        // THEN: Original nodes should be deleted
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Internal1.md'))).toBe(false)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Internal2.md'))).toBe(false)

        // AND: A merged node file should be created (starts with 'merged_')
        const files: string[] = await filesystemTest.readProjectDirectory()
        const mergedFiles: string[] = files.filter(f => f.startsWith('merged_'))
        expect(mergedFiles).toHaveLength(1)
        const mergedFileName: string = mergedFiles[0]

        // AND: Merged file should contain combined content
        const mergedContent: string = await filesystemTest.readProjectFile(mergedFileName)
        expect(mergedContent).toContain('Internal 1')
        expect(mergedContent).toContain('Internal 2')

        // AND: External.md should now link to merged node
        // Note: wikilinks may contain absolute paths since merge generates absolute node IDs
        const externalLinks: string[] = (await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('External.md'))).map(l => filesystemTest.basename(l))
        expect(externalLinks).toContain(mergedFileName)
        expect(externalLinks).not.toContain('Internal1.md')
    })

    it('should merge and redirect multiple external incomers', async () => {
        // GIVEN: Ext1 → Leaf1, Ext2 → Leaf2
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Ext1.md', '# Ext 1', ['Leaf1.md'], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Ext2.md', '# Ext 2', ['Leaf2.md'], { x: 200, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Leaf1.md', '# Leaf 1', [], { x: 50, y: 100 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Leaf2.md', '# Leaf 2', [], { x: 150, y: 100 })

        const mockGraph: Graph = createGraph({
            'Ext1.md': filesystemTest.createTestNode('Ext1.md', '# Ext 1', [{ targetId: 'Leaf1.md', label: '' }], { x: 0, y: 0 }),
            'Ext2.md': filesystemTest.createTestNode('Ext2.md', '# Ext 2', [{ targetId: 'Leaf2.md', label: '' }], { x: 200, y: 0 }),
            'Leaf1.md': filesystemTest.createTestNode('Leaf1.md', '# Leaf 1', [], { x: 50, y: 100 }),
            'Leaf2.md': filesystemTest.createTestNode('Leaf2.md', '# Leaf 2', [], { x: 150, y: 100 })
        })
        filesystemTest.setCurrentGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Ext1.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Ext2.md' }, position: { x: 200, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Leaf1.md' }, position: { x: 50, y: 100 } },
                { group: 'nodes' as const, data: { id: 'Leaf2.md' }, position: { x: 150, y: 100 } },
                { group: 'edges' as const, data: { source: 'Ext1.md', target: 'Leaf1.md' } },
                { group: 'edges' as const, data: { source: 'Ext2.md', target: 'Leaf2.md' } }
            ]
        })

        global.window = filesystemTest.createTestWindow(cy, true)

        // WHEN: Merge Leaf1 and Leaf2
        await mergeSelectedNodesFromUI(['Leaf1.md', 'Leaf2.md'], cy)

        // THEN: Original leaf nodes should be deleted
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Leaf1.md'))).toBe(false)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Leaf2.md'))).toBe(false)

        // AND: Find the merged node
        const files: string[] = await filesystemTest.readProjectDirectory()
        const mergedFileName: string = files.find(f => f.startsWith('merged_'))!
        expect(mergedFileName).toBeDefined()

        // AND: Both Ext1 and Ext2 should now link to the merged node
        // Note: wikilinks may contain absolute paths since merge generates absolute node IDs
        const ext1Links: string[] = (await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('Ext1.md'))).map(l => filesystemTest.basename(l))
        const ext2Links: string[] = (await filesystemTest.readWikilinksFromFile(filesystemTest.projectFilePath('Ext2.md'))).map(l => filesystemTest.basename(l))

        expect(ext1Links).toContain(mergedFileName)
        expect(ext2Links).toContain(mergedFileName)
        expect(ext1Links).not.toContain('Leaf1.md')
        expect(ext2Links).not.toContain('Leaf2.md')
    })
})

describe('Merge with Context Nodes - Filesystem Integration', () => {
    let cy: Core

    beforeEach(async () => {
        await filesystemTest.setupMergeFilesystemTest('test-project-merge-ctx')
    })

    afterEach(async () => {
        await filesystemTest.cleanupFilesystemTest(cy)
    })

    it('should delete context nodes and merge only regular nodes', async () => {
        // GIVEN: Two regular nodes and one context node
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Regular1.md', '# Regular 1', [], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Regular2.md', '# Regular 2', [], { x: 100, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Context1.md', '# Context 1', [], { x: 50, y: 100 })

        const mockGraph: Graph = createGraph({
            'Regular1.md': filesystemTest.createTestNode('Regular1.md', '# Regular 1', [], { x: 0, y: 0 }, false),
            'Regular2.md': filesystemTest.createTestNode('Regular2.md', '# Regular 2', [], { x: 100, y: 0 }, false),
            'Context1.md': filesystemTest.createTestNode('Context1.md', '# Context 1', [], { x: 50, y: 100 }, true) // isContextNode
        })
        filesystemTest.setCurrentGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Regular1.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Regular2.md' }, position: { x: 100, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Context1.md' }, position: { x: 50, y: 100 } }
            ]
        })

        global.window = filesystemTest.createTestWindow(cy, true)

        // WHEN: Merge all three nodes (2 regular + 1 context)
        await mergeSelectedNodesFromUI(['Regular1.md', 'Regular2.md', 'Context1.md'], cy)

        // THEN: All original nodes should be deleted
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Regular1.md'))).toBe(false)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Regular2.md'))).toBe(false)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Context1.md'))).toBe(false)

        // AND: A merged node should be created containing only regular nodes' content
        const files: string[] = await filesystemTest.readProjectDirectory()
        const mergedFiles: string[] = files.filter(f => f.startsWith('merged_'))
        expect(mergedFiles).toHaveLength(1)

        const mergedContent: string = await filesystemTest.readProjectFile(mergedFiles[0])
        expect(mergedContent).toContain('Regular 1')
        expect(mergedContent).toContain('Regular 2')
        // Context node content should NOT be in merged content
        expect(mergedContent).not.toContain('Context 1')
    })

    it('should only delete context nodes if fewer than 2 regular nodes selected', async () => {
        // GIVEN: One regular node and one context node
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Regular1.md', '# Regular 1', [], { x: 0, y: 0 })
        await filesystemTest.writeMarkdownFile(filesystemTest.tempProject(), 'Context1.md', '# Context 1', [], { x: 100, y: 0 })

        const mockGraph: Graph = createGraph({
            'Regular1.md': filesystemTest.createTestNode('Regular1.md', '# Regular 1', [], { x: 0, y: 0 }, false),
            'Context1.md': filesystemTest.createTestNode('Context1.md', '# Context 1', [], { x: 100, y: 0 }, true)
        })
        filesystemTest.setCurrentGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Regular1.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Context1.md' }, position: { x: 100, y: 0 } }
            ]
        })

        global.window = filesystemTest.createTestWindow(cy, true)

        // WHEN: Try to merge 1 regular + 1 context node (not enough regular nodes to merge)
        await mergeSelectedNodesFromUI(['Regular1.md', 'Context1.md'], cy)

        // THEN: Context node should be deleted (always deleted when selected)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Context1.md'))).toBe(false)

        // AND: Regular node should remain (not enough to merge)
        expect(await filesystemTest.fileExists(filesystemTest.projectFilePath('Regular1.md'))).toBe(true)

        // AND: No merged node should be created
        const files: string[] = await filesystemTest.readProjectDirectory()
        const mergedFiles: string[] = files.filter(f => f.startsWith('merged_'))
        expect(mergedFiles).toHaveLength(0)
    })
})
