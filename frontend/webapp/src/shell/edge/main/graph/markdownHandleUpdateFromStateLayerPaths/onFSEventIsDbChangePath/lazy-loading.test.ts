import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDiskWithLazyLoading, isReadPath } from './loadGraphFromDisk'
import type { Graph } from '@/pure/graph'
import type { FileLimitExceededError } from './fileLimitEnforce'

/**
 * Section 7: Loading of readPaths Nodes
 *
 * Tests for readPaths loading behavior:
 * - readPaths load ALL files immediately (not lazy)
 * - Empty readPaths works like regular load
 * - isReadPath helper correctly identifies paths
 */
describe('loadGraphFromDiskWithLazyLoading', () => {
    let tmpDir: string
    let writePath: string
    let readPath: string

    beforeAll(async () => {
        // Create temp directory structure:
        // tmpDir/
        //   write-vault/         <- writePath (loaded immediately)
        //     visible-node.md
        //     isolated-node.md
        //   read-vault/          <- readPath (now also loaded immediately)
        //     linked-node.md     <- Should appear immediately
        //     transitive-node.md <- Should appear immediately
        //     unlinked-node.md   <- Should appear immediately (no lazy loading)
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readpath-loading-test-'))
        writePath = path.join(tmpDir, 'write-vault')
        readPath = path.join(tmpDir, 'read-vault')

        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readPath, { recursive: true })

        // Create nodes in writePath
        await fs.writeFile(
            path.join(writePath, 'visible-node.md'),
            `# Visible Node

This node is always visible. It links to [[linked-node]].`
        )

        await fs.writeFile(
            path.join(writePath, 'isolated-node.md'),
            `# Isolated Node

This node has no links.`
        )

        // Create nodes in readPath (all loaded immediately now)
        await fs.writeFile(
            path.join(readPath, 'linked-node.md'),
            `# Linked Node

This node is in readPath. It links to [[transitive-node]].`
        )

        await fs.writeFile(
            path.join(readPath, 'transitive-node.md'),
            `# Transitive Node

This node is transitively linked.`
        )

        await fs.writeFile(
            path.join(readPath, 'unlinked-node.md'),
            `# Unlinked Node

This node is not linked but should still appear (readPaths load all files).`
        )
    })

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true })
    })

    // Test: ALL files from readPaths are loaded immediately
    it('should load ALL files from readPaths immediately (not lazy)', async () => {
        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            [readPath]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // All writePath nodes should be loaded
        expect(nodeIds.some(id => id.includes('visible-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('isolated-node'))).toBe(true)

        // ALL readPath nodes should be loaded (including unlinked)
        expect(nodeIds.some(id => id.includes('linked-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('transitive-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('unlinked-node'))).toBe(true)

        // Total should be 5 nodes
        expect(nodeIds).toHaveLength(5)
    })

    // Test: Empty readPaths should work like regular load
    it('should work with empty readPaths (same as regular load)', async () => {
        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            []
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // Should only have nodes from writePath
        expect(nodeIds.some(id => id.includes('visible-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('isolated-node'))).toBe(true)
        expect(nodeIds).toHaveLength(2)
    })

    // Test: isReadPath helper
    it('should correctly identify readPaths nodes with isReadPath helper', () => {
        const readPaths: readonly string[] = ['/path/to/read-vault', '/path/to/another-vault']

        // Node in readPath should return true
        expect(isReadPath('/path/to/read-vault/node.md', readPaths)).toBe(true)
        expect(isReadPath('/path/to/read-vault/subdir/node.md', readPaths)).toBe(true)
        expect(isReadPath('/path/to/another-vault/node.md', readPaths)).toBe(true)

        // Node NOT in readPath should return false
        expect(isReadPath('/path/to/write-vault/node.md', readPaths)).toBe(false)
        expect(isReadPath('/completely/different/path.md', readPaths)).toBe(false)
    })

    // Test: Multiple readPaths
    it('should load files from multiple readPaths', async () => {
        // Create a second read path
        const readPath2: string = path.join(tmpDir, 'read-vault-2')
        await fs.mkdir(readPath2, { recursive: true })
        await fs.writeFile(
            path.join(readPath2, 'second-vault-node.md'),
            `# Second Vault Node`
        )

        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            [readPath, readPath2]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // All nodes from all paths should be loaded
        expect(nodeIds.some(id => id.includes('visible-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('linked-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('second-vault-node'))).toBe(true)
    })
})

describe('resolveLinkedNodesInWatchedFolder', () => {
    let tmpDir: string
    let writePath: string
    let watchedFolder: string

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-watched-folder-test-'))
        watchedFolder = tmpDir
        writePath = path.join(tmpDir, 'write-vault')

        await fs.mkdir(writePath, { recursive: true })

        // Create a chain: A -> B -> C -> D (all in watched folder)
        await fs.writeFile(
            path.join(writePath, 'a.md'),
            `# Node A

Links to [[b]].`
        )

        // Create files outside writePath but inside watched folder
        await fs.writeFile(
            path.join(watchedFolder, 'b.md'),
            `# Node B

Links to [[c]].`
        )

        await fs.writeFile(
            path.join(watchedFolder, 'c.md'),
            `# Node C

Links to [[d]].`
        )

        await fs.writeFile(
            path.join(watchedFolder, 'd.md'),
            `# Node D

End of chain.`
        )
    })

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('should resolve linked nodes in watched folder using resolve-on-link', async () => {
        const { resolveLinkedNodesInWatchedFolder } = await import('./loadGraphFromDisk')

        // First load just the writePath
        const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            []
        )

        if (E.isLeft(initialResult)) throw new Error('Expected Right')
        const initialGraph: Graph = initialResult.right

        // Only A should be loaded initially
        expect(Object.keys(initialGraph.nodes)).toHaveLength(1)
        expect(Object.keys(initialGraph.nodes)[0]).toContain('a.md')

        // Now resolve links in watched folder
        const resolvedGraph: Graph = await resolveLinkedNodesInWatchedFolder(initialGraph, watchedFolder)

        const nodeIds: readonly string[] = Object.keys(resolvedGraph.nodes)

        // All chain nodes should be loaded via resolve-on-link
        expect(nodeIds.some(id => id.includes('/a.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/b.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/c.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/d.md'))).toBe(true)
    })
})
