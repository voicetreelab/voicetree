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

/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Core } from 'cytoscape'
import cytoscape from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import { deleteNodesFromUI } from '@/shell/edge/UI-edge/graph/handleUIActions'
import { mergeSelectedNodesFromUI } from '@/shell/edge/UI-edge/graph/mergeSelectedNodesFromUI'
import type { Graph, GraphDelta, GraphNode } from '@/pure/graph'
import * as fs from 'fs/promises'
import * as path from 'path'
import { setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'

// State managed by mocked globals
let currentGraph: Graph | null = null
let tempVault: string = ''

// Mock Electron's ipcMain
const ipcMain: { _handlers: Map<string, Function>; handle(channel: string, handler: Function): void; removeHandler(channel: string): void } = {
    _handlers: new Map<string, Function>(),
    handle(channel: string, handler: Function) {
        this._handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
        this._handlers.delete(channel)
    }
}

// Mock electron module
vi.mock('electron', () => ({
    ipcMain,
    dialog: {
        showOpenDialog: vi.fn()
    },
    app: {
        whenReady: () => Promise.resolve(),
        on: vi.fn(),
        quit: vi.fn()
    }
}))

// Mock posthog
vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
        get_distinct_id: vi.fn(() => 'test-user-id')
    }
}))

// Mock AgentTabsBar
vi.mock('@/shell/UI/views/AgentTabsBar', () => ({
    markTerminalActivityForContextNode: vi.fn()
}))

// Mock graph store
vi.mock('@/shell/edge/main/state/graph-store', () => {
    return {
        getGraph: () => {
            if (!currentGraph) {
                throw new Error('Graph not initialized')
            }
            return currentGraph
        },
        setGraph: (graph: Graph) => {
            currentGraph = graph
        },
        getNode: (nodeId: string) => {
            if (!currentGraph) {
                throw new Error('Graph not initialized')
            }
            return currentGraph.nodes[nodeId]
        }
    }
})

// Mock watchFolder for vault path functions
vi.mock('@/shell/edge/main/graph/watchFolder', () => {
    return {
        getVaultPath: () => {
            return tempVault ? O.of(tempVault) : O.none
        },
        setVaultPath: (path: string) => {
            tempVault = path
        },
        clearVaultPath: () => {
            tempVault = ''
        },
        startFileWatching: vi.fn().mockResolvedValue({ success: true }),
        stopFileWatching: vi.fn().mockResolvedValue({ success: true }),
        initialLoad: vi.fn().mockResolvedValue(undefined),
        getWatchStatus: vi.fn(() => ({ isWatching: false, directory: undefined, vaultSuffix: 'voicetree' })),
        loadPreviousFolder: vi.fn().mockResolvedValue({ success: false }),
        isWatching: vi.fn(() => false),
        getWatchedDirectory: () => tempVault || null,
        getVaultSuffix: vi.fn(() => 'voicetree'),
        setVaultSuffix: vi.fn().mockResolvedValue({ success: true }),
        loadFolder: vi.fn().mockResolvedValue(undefined)
    }
})

// Import IPC handlers once at module level
let handlersImported: boolean = false
async function ensureHandlersImported(): Promise<void> {
    if (!handlersImported) {
        const { registerTerminalIpcHandlers } = await import('@/shell/edge/main/terminals/ipc-terminal-handlers')
        registerTerminalIpcHandlers(
            {} as any, // terminalManager
            () => '' // getToolsDirectory
        )
        handlersImported = true
    }
}

// Helper to create a minimal GraphNode
function createTestNode(
    id: string,
    content: string,
    outgoingEdges: readonly { targetId: string; label: string }[] = [],
    position?: { x: number; y: number },
    isContextNode: boolean = false
): GraphNode {
    return {
        relativeFilePathIsID: id,
        outgoingEdges,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: position ? O.some(position) : O.none,
            additionalYAMLProps: new Map(),
            isContextNode
        }
    }
}

// Helper to write a markdown file with optional wikilinks
async function writeMarkdownFile(
    vaultPath: string,
    filename: string,
    content: string,
    wikilinks: string[] = [],
    position?: { x: number; y: number }
): Promise<void> {
    const frontmatter: string = position
        ? `---\nposition:\n  x: ${position.x}\n  y: ${position.y}\n---\n`
        : ''
    const linksSection: string = wikilinks.length > 0
        ? `\n\n_Links:_\n${wikilinks.map(link => `- [[${link}]]`).join('\n')}`
        : ''
    const fullContent: string = `${frontmatter}${content}${linksSection}`
    await fs.writeFile(path.join(vaultPath, filename), fullContent)
}

// Helper to read wikilinks from a markdown file
async function readWikilinksFromFile(filePath: string): Promise<string[]> {
    const content: string = await fs.readFile(filePath, 'utf-8')
    const wikiLinkRegex: RegExp = /\[\[([^\]]+)\]\]/g
    const matches: string[] = []
    let match: RegExpExecArray | null
    while ((match = wikiLinkRegex.exec(content)) !== null) {
        matches.push(match[1])
    }
    return matches
}

// Helper to check if file exists
async function fileExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false)
}

describe('Delete with Edge Preservation - Filesystem Integration', () => {
    let cy: Core

    beforeEach(async () => {
        await ensureHandlersImported()
        tempVault = path.join('/tmp', `test-vault-delete-edges-${Date.now()}`)
        await fs.mkdir(tempVault, { recursive: true })
        setVaultPath(tempVault)
    })

    afterEach(async () => {
        cy?.destroy()
        await fs.rm(tempVault, { recursive: true, force: true })
        vi.clearAllMocks()
    })

    it('should delete middle node and preserve transitive edge (A → B → C becomes A → C)', async () => {
        // GIVEN: Chain A → B → C on filesystem
        await writeMarkdownFile(tempVault, 'A.md', '# Node A', ['B.md'], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'B.md', '# Node B', ['C.md'], { x: 100, y: 0 })
        await writeMarkdownFile(tempVault, 'C.md', '# Node C', [], { x: 200, y: 0 })

        // Setup graph state
        const mockGraph: Graph = {
            nodes: {
                'A.md': createTestNode('A.md', '# Node A', [{ targetId: 'B.md', label: '' }], { x: 0, y: 0 }),
                'B.md': createTestNode('B.md', '# Node B', [{ targetId: 'C.md', label: '' }], { x: 100, y: 0 }),
                'C.md': createTestNode('C.md', '# Node C', [], { x: 200, y: 0 })
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

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

        // Setup window.electronAPI
        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Delete node B
        await deleteNodesFromUI(['B.md'], cy)

        // THEN: B.md should be deleted from filesystem
        expect(await fileExists(path.join(tempVault, 'B.md'))).toBe(false)

        // AND: A.md should still exist and now contain wikilink to C.md (transitive edge)
        expect(await fileExists(path.join(tempVault, 'A.md'))).toBe(true)
        const aLinks: string[] = await readWikilinksFromFile(path.join(tempVault, 'A.md'))
        expect(aLinks).toContain('C.md')
        expect(aLinks).not.toContain('B.md')

        // AND: C.md should still exist
        expect(await fileExists(path.join(tempVault, 'C.md'))).toBe(true)
    })

    it('should delete multiple nodes from separate subtrees', async () => {
        // GIVEN: Two separate branches: Parent1 → A → C and Parent2 → B → D
        // Deleting A and B should preserve transitive edges in each subtree independently
        await writeMarkdownFile(tempVault, 'Parent1.md', '# Parent 1', ['A.md'], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'A.md', '# Node A', ['C.md'], { x: 0, y: 100 })
        await writeMarkdownFile(tempVault, 'C.md', '# Node C', [], { x: 0, y: 200 })
        await writeMarkdownFile(tempVault, 'Parent2.md', '# Parent 2', ['B.md'], { x: 200, y: 0 })
        await writeMarkdownFile(tempVault, 'B.md', '# Node B', ['D.md'], { x: 200, y: 100 })
        await writeMarkdownFile(tempVault, 'D.md', '# Node D', [], { x: 200, y: 200 })

        const mockGraph: Graph = {
            nodes: {
                'Parent1.md': createTestNode('Parent1.md', '# Parent 1', [{ targetId: 'A.md', label: '' }], { x: 0, y: 0 }),
                'A.md': createTestNode('A.md', '# Node A', [{ targetId: 'C.md', label: '' }], { x: 0, y: 100 }),
                'C.md': createTestNode('C.md', '# Node C', [], { x: 0, y: 200 }),
                'Parent2.md': createTestNode('Parent2.md', '# Parent 2', [{ targetId: 'B.md', label: '' }], { x: 200, y: 0 }),
                'B.md': createTestNode('B.md', '# Node B', [{ targetId: 'D.md', label: '' }], { x: 200, y: 100 }),
                'D.md': createTestNode('D.md', '# Node D', [], { x: 200, y: 200 })
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

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

        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Delete both A and B (from separate subtrees)
        await deleteNodesFromUI(['A.md', 'B.md'], cy)

        // THEN: Both A.md and B.md should be deleted
        expect(await fileExists(path.join(tempVault, 'A.md'))).toBe(false)
        expect(await fileExists(path.join(tempVault, 'B.md'))).toBe(false)

        // AND: Parent1.md should now link to C.md (transitive from A → C)
        const parent1Links: string[] = await readWikilinksFromFile(path.join(tempVault, 'Parent1.md'))
        expect(parent1Links).toContain('C.md')
        expect(parent1Links).not.toContain('A.md')

        // AND: Parent2.md should now link to D.md (transitive from B → D)
        const parent2Links: string[] = await readWikilinksFromFile(path.join(tempVault, 'Parent2.md'))
        expect(parent2Links).toContain('D.md')
        expect(parent2Links).not.toContain('B.md')

        // AND: C.md and D.md should still exist
        expect(await fileExists(path.join(tempVault, 'C.md'))).toBe(true)
        expect(await fileExists(path.join(tempVault, 'D.md'))).toBe(true)
    })

    it('should delete multiple CONNECTED nodes in a chain (Parent → A → B → C, delete A and B)', async () => {
        // BUG REPRODUCTION: When deleting multiple nodes that are directly connected,
        // the delta computation uses stale graph state. deleteNodeMaintainingTransitiveEdges
        // is called for each node with the ORIGINAL graph, not accounting for other deletions.
        // This can cause crashes or incorrect edge updates when a node being updated is also
        // being deleted.
        //
        // GIVEN: Chain Parent → A → B → C
        await writeMarkdownFile(tempVault, 'Parent.md', '# Parent', ['A.md'], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'A.md', '# Node A', ['B.md'], { x: 0, y: 100 })
        await writeMarkdownFile(tempVault, 'B.md', '# Node B', ['C.md'], { x: 0, y: 200 })
        await writeMarkdownFile(tempVault, 'C.md', '# Node C', [], { x: 0, y: 300 })

        const mockGraph: Graph = {
            nodes: {
                'Parent.md': createTestNode('Parent.md', '# Parent', [{ targetId: 'A.md', label: '' }], { x: 0, y: 0 }),
                'A.md': createTestNode('A.md', '# Node A', [{ targetId: 'B.md', label: '' }], { x: 0, y: 100 }),
                'B.md': createTestNode('B.md', '# Node B', [{ targetId: 'C.md', label: '' }], { x: 0, y: 200 }),
                'C.md': createTestNode('C.md', '# Node C', [], { x: 0, y: 300 })
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

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

        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Delete A and B together (connected nodes in the chain)
        await deleteNodesFromUI(['A.md', 'B.md'], cy)

        // THEN: Both A.md and B.md should be deleted
        expect(await fileExists(path.join(tempVault, 'A.md'))).toBe(false)
        expect(await fileExists(path.join(tempVault, 'B.md'))).toBe(false)

        // AND: Parent.md should now link to C.md (skip over deleted A and B)
        const parentLinks: string[] = await readWikilinksFromFile(path.join(tempVault, 'Parent.md'))
        expect(parentLinks).toContain('C.md')
        expect(parentLinks).not.toContain('A.md')
        expect(parentLinks).not.toContain('B.md')

        // AND: C.md should still exist
        expect(await fileExists(path.join(tempVault, 'C.md'))).toBe(true)
    })
})

describe('Merge Operation - Filesystem Integration', () => {
    let cy: Core

    beforeEach(async () => {
        await ensureHandlersImported()
        tempVault = path.join('/tmp', `test-vault-merge-${Date.now()}`)
        await fs.mkdir(tempVault, { recursive: true })
        setVaultPath(tempVault)
    })

    afterEach(async () => {
        cy?.destroy()
        await fs.rm(tempVault, { recursive: true, force: true })
        vi.clearAllMocks()
    })

    it('should merge nodes and redirect external incomer edges on filesystem', async () => {
        // GIVEN: External → Internal1 → Internal2
        await writeMarkdownFile(tempVault, 'External.md', '# External', ['Internal1.md'], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'Internal1.md', '# Internal 1', ['Internal2.md'], { x: 100, y: 100 })
        await writeMarkdownFile(tempVault, 'Internal2.md', '# Internal 2', [], { x: 100, y: 200 })

        const mockGraph: Graph = {
            nodes: {
                'External.md': createTestNode('External.md', '# External', [{ targetId: 'Internal1.md', label: '' }], { x: 0, y: 0 }),
                'Internal1.md': createTestNode('Internal1.md', '# Internal 1', [{ targetId: 'Internal2.md', label: '' }], { x: 100, y: 100 }),
                'Internal2.md': createTestNode('Internal2.md', '# Internal 2', [], { x: 100, y: 200 })
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

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

        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    getWatchStatus: () => ({ isWatching: false, directory: tempVault, vaultSuffix: '' }),
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Merge Internal1 and Internal2
        await mergeSelectedNodesFromUI(['Internal1.md', 'Internal2.md'], cy)

        // THEN: Original nodes should be deleted
        expect(await fileExists(path.join(tempVault, 'Internal1.md'))).toBe(false)
        expect(await fileExists(path.join(tempVault, 'Internal2.md'))).toBe(false)

        // AND: A merged node file should be created (starts with 'merged_')
        const files: string[] = await fs.readdir(tempVault)
        const mergedFiles: string[] = files.filter(f => f.startsWith('merged_'))
        expect(mergedFiles).toHaveLength(1)
        const mergedFileName: string = mergedFiles[0]

        // AND: Merged file should contain combined content
        const mergedContent: string = await fs.readFile(path.join(tempVault, mergedFileName), 'utf-8')
        expect(mergedContent).toContain('Internal 1')
        expect(mergedContent).toContain('Internal 2')

        // AND: External.md should now link to merged node
        const externalLinks: string[] = await readWikilinksFromFile(path.join(tempVault, 'External.md'))
        expect(externalLinks).toContain(mergedFileName)
        expect(externalLinks).not.toContain('Internal1.md')
    })

    it('should merge and redirect multiple external incomers', async () => {
        // GIVEN: Ext1 → Leaf1, Ext2 → Leaf2
        await writeMarkdownFile(tempVault, 'Ext1.md', '# Ext 1', ['Leaf1.md'], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'Ext2.md', '# Ext 2', ['Leaf2.md'], { x: 200, y: 0 })
        await writeMarkdownFile(tempVault, 'Leaf1.md', '# Leaf 1', [], { x: 50, y: 100 })
        await writeMarkdownFile(tempVault, 'Leaf2.md', '# Leaf 2', [], { x: 150, y: 100 })

        const mockGraph: Graph = {
            nodes: {
                'Ext1.md': createTestNode('Ext1.md', '# Ext 1', [{ targetId: 'Leaf1.md', label: '' }], { x: 0, y: 0 }),
                'Ext2.md': createTestNode('Ext2.md', '# Ext 2', [{ targetId: 'Leaf2.md', label: '' }], { x: 200, y: 0 }),
                'Leaf1.md': createTestNode('Leaf1.md', '# Leaf 1', [], { x: 50, y: 100 }),
                'Leaf2.md': createTestNode('Leaf2.md', '# Leaf 2', [], { x: 150, y: 100 })
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

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

        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    getWatchStatus: () => ({ isWatching: false, directory: tempVault, vaultSuffix: '' }),
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Merge Leaf1 and Leaf2
        await mergeSelectedNodesFromUI(['Leaf1.md', 'Leaf2.md'], cy)

        // THEN: Original leaf nodes should be deleted
        expect(await fileExists(path.join(tempVault, 'Leaf1.md'))).toBe(false)
        expect(await fileExists(path.join(tempVault, 'Leaf2.md'))).toBe(false)

        // AND: Find the merged node
        const files: string[] = await fs.readdir(tempVault)
        const mergedFileName: string = files.find(f => f.startsWith('merged_'))!
        expect(mergedFileName).toBeDefined()

        // AND: Both Ext1 and Ext2 should now link to the merged node
        const ext1Links: string[] = await readWikilinksFromFile(path.join(tempVault, 'Ext1.md'))
        const ext2Links: string[] = await readWikilinksFromFile(path.join(tempVault, 'Ext2.md'))

        expect(ext1Links).toContain(mergedFileName)
        expect(ext2Links).toContain(mergedFileName)
        expect(ext1Links).not.toContain('Leaf1.md')
        expect(ext2Links).not.toContain('Leaf2.md')
    })
})

describe('Merge with Context Nodes - Filesystem Integration', () => {
    let cy: Core

    beforeEach(async () => {
        await ensureHandlersImported()
        tempVault = path.join('/tmp', `test-vault-merge-ctx-${Date.now()}`)
        await fs.mkdir(tempVault, { recursive: true })
        setVaultPath(tempVault)
    })

    afterEach(async () => {
        cy?.destroy()
        await fs.rm(tempVault, { recursive: true, force: true })
        vi.clearAllMocks()
    })

    it('should delete context nodes and merge only regular nodes', async () => {
        // GIVEN: Two regular nodes and one context node
        await writeMarkdownFile(tempVault, 'Regular1.md', '# Regular 1', [], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'Regular2.md', '# Regular 2', [], { x: 100, y: 0 })
        await writeMarkdownFile(tempVault, 'Context1.md', '# Context 1', [], { x: 50, y: 100 })

        const mockGraph: Graph = {
            nodes: {
                'Regular1.md': createTestNode('Regular1.md', '# Regular 1', [], { x: 0, y: 0 }, false),
                'Regular2.md': createTestNode('Regular2.md', '# Regular 2', [], { x: 100, y: 0 }, false),
                'Context1.md': createTestNode('Context1.md', '# Context 1', [], { x: 50, y: 100 }, true) // isContextNode
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Regular1.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Regular2.md' }, position: { x: 100, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Context1.md' }, position: { x: 50, y: 100 } }
            ]
        })

        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    getWatchStatus: () => ({ isWatching: false, directory: tempVault, vaultSuffix: '' }),
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Merge all three nodes (2 regular + 1 context)
        await mergeSelectedNodesFromUI(['Regular1.md', 'Regular2.md', 'Context1.md'], cy)

        // THEN: All original nodes should be deleted
        expect(await fileExists(path.join(tempVault, 'Regular1.md'))).toBe(false)
        expect(await fileExists(path.join(tempVault, 'Regular2.md'))).toBe(false)
        expect(await fileExists(path.join(tempVault, 'Context1.md'))).toBe(false)

        // AND: A merged node should be created containing only regular nodes' content
        const files: string[] = await fs.readdir(tempVault)
        const mergedFiles: string[] = files.filter(f => f.startsWith('merged_'))
        expect(mergedFiles).toHaveLength(1)

        const mergedContent: string = await fs.readFile(path.join(tempVault, mergedFiles[0]), 'utf-8')
        expect(mergedContent).toContain('Regular 1')
        expect(mergedContent).toContain('Regular 2')
        // Context node content should NOT be in merged content
        expect(mergedContent).not.toContain('Context 1')
    })

    it('should only delete context nodes if fewer than 2 regular nodes selected', async () => {
        // GIVEN: One regular node and one context node
        await writeMarkdownFile(tempVault, 'Regular1.md', '# Regular 1', [], { x: 0, y: 0 })
        await writeMarkdownFile(tempVault, 'Context1.md', '# Context 1', [], { x: 100, y: 0 })

        const mockGraph: Graph = {
            nodes: {
                'Regular1.md': createTestNode('Regular1.md', '# Regular 1', [], { x: 0, y: 0 }, false),
                'Context1.md': createTestNode('Context1.md', '# Context 1', [], { x: 100, y: 0 }, true)
            }
        }
        currentGraph = mockGraph
        setGraph(mockGraph)

        cy = cytoscape({
            headless: true,
            elements: [
                { group: 'nodes' as const, data: { id: 'Regular1.md' }, position: { x: 0, y: 0 } },
                { group: 'nodes' as const, data: { id: 'Context1.md' }, position: { x: 100, y: 0 } }
            ]
        })

        const { mainAPI } = await import('@/shell/edge/main/api')
        global.window = {
            electronAPI: {
                main: {
                    getGraph: mainAPI.getGraph,
                    getNode: mainAPI.getNode,
                    getWatchStatus: () => ({ isWatching: false, directory: tempVault, vaultSuffix: '' }),
                    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                        await mainAPI.applyGraphDeltaToDBThroughMemUIAndEditorExposed(delta)
                        applyGraphDeltaToUI(cy, delta)
                    }
                }
            }
        } as any

        // WHEN: Try to merge 1 regular + 1 context node (not enough regular nodes to merge)
        await mergeSelectedNodesFromUI(['Regular1.md', 'Context1.md'], cy)

        // THEN: Context node should be deleted (always deleted when selected)
        expect(await fileExists(path.join(tempVault, 'Context1.md'))).toBe(false)

        // AND: Regular node should remain (not enough to merge)
        expect(await fileExists(path.join(tempVault, 'Regular1.md'))).toBe(true)

        // AND: No merged node should be created
        const files: string[] = await fs.readdir(tempVault)
        const mergedFiles: string[] = files.filter(f => f.startsWith('merged_'))
        expect(mergedFiles).toHaveLength(0)
    })
})
