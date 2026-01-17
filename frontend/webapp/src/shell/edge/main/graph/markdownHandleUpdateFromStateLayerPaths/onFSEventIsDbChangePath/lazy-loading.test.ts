import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDiskWithLazyLoading } from './loadGraphFromDisk'
import type { Graph } from '@/pure/graph'
import type { FileLimitExceededError } from './fileLimitEnforce'

/**
 * Section 7: Lazy Loading of readOnLinkPaths Nodes
 *
 * Tests for lazy loading behavior:
 * - 7.1: Nodes from readOnLinkPaths not loaded initially
 * - 7.2: Node appears when linked by visible node
 * - 7.3: Transitive links work (A→B→C)
 * - 7.4: Unlinked nodes remain hidden
 */
describe('loadGraphFromDiskWithLazyLoading', () => {
    let tmpDir: string
    let writePath: string
    let readOnLinkPath: string

    beforeAll(async () => {
        // Create temp directory structure:
        // tmpDir/
        //   write-vault/         <- writePath (loaded immediately)
        //     visible-node.md    <- Links to [[linked-node]] in readOnLinkPath
        //     isolated-node.md   <- No links
        //   read-vault/          <- readOnLinkPath (lazy loaded)
        //     linked-node.md     <- Should appear (linked by visible-node)
        //     transitive-node.md <- Should appear (linked by linked-node)
        //     unlinked-node.md   <- Should NOT appear (no links to it)
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-loading-test-'))
        writePath = path.join(tmpDir, 'write-vault')
        readOnLinkPath = path.join(tmpDir, 'read-vault')

        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readOnLinkPath, { recursive: true })

        // Create nodes in writePath (visible immediately)
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

        // Create nodes in readOnLinkPath (lazy loaded)
        await fs.writeFile(
            path.join(readOnLinkPath, 'linked-node.md'),
            `# Linked Node

This node is in readOnLinkPath. It links to [[transitive-node]].`
        )

        await fs.writeFile(
            path.join(readOnLinkPath, 'transitive-node.md'),
            `# Transitive Node

This node is transitively linked (visible-node -> linked-node -> transitive-node).`
        )

        await fs.writeFile(
            path.join(readOnLinkPath, 'unlinked-node.md'),
            `# Unlinked Node

This node is not linked by any visible node. It should remain hidden.`
        )
    })

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true })
    })

    // 7.1 Test: Nodes from readOnLinkPaths not loaded initially (without links)
    it('should not load readOnLinkPaths nodes that are not linked', async () => {
        // Create a writePath node with no links
        const noLinksWritePath: string = path.join(tmpDir, 'no-links-vault')
        await fs.mkdir(noLinksWritePath, { recursive: true })
        await fs.writeFile(
            path.join(noLinksWritePath, 'standalone.md'),
            `# Standalone Node

No links here.`
        )

        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [noLinksWritePath],
            [readOnLinkPath]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        // Should only have the standalone node
        const nodeIds: readonly string[] = Object.keys(graph.nodes)
        expect(nodeIds).toHaveLength(1)
        expect(nodeIds[0]).toContain('standalone.md')

        // readOnLinkPath nodes should NOT be loaded
        expect(nodeIds.some(id => id.includes('unlinked-node'))).toBe(false)
        expect(nodeIds.some(id => id.includes('linked-node'))).toBe(false)
        expect(nodeIds.some(id => id.includes('transitive-node'))).toBe(false)
    })

    // 7.2 Test: Node appears when linked by visible node
    it('should load readOnLinkPaths node when linked by visible node', async () => {
        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            [readOnLinkPath]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // visible-node and isolated-node should be loaded (from writePath)
        expect(nodeIds.some(id => id.includes('visible-node'))).toBe(true)
        expect(nodeIds.some(id => id.includes('isolated-node'))).toBe(true)

        // linked-node should be loaded (linked by visible-node)
        expect(nodeIds.some(id => id.includes('linked-node'))).toBe(true)
    })

    // 7.3 Test: Transitive links work (A→B→C)
    it('should load transitively linked nodes from readOnLinkPaths', async () => {
        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            [readOnLinkPath]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // transitive-node should be loaded (visible-node -> linked-node -> transitive-node)
        expect(nodeIds.some(id => id.includes('transitive-node'))).toBe(true)
    })

    // 7.4 Test: Unlinked nodes remain hidden
    it('should not load unlinked nodes from readOnLinkPaths', async () => {
        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            [readOnLinkPath]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // unlinked-node should NOT be loaded (no links to it)
        expect(nodeIds.some(id => id.includes('unlinked-node'))).toBe(false)
    })

    // Additional test: Empty readOnLinkPaths should work like regular load
    it('should work with empty readOnLinkPaths (same as regular load)', async () => {
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

    // Test: isReadOnLinkPath helper
    it('should correctly identify readOnLinkPaths nodes with isReadOnLinkPath helper', async () => {
        // This test validates the helper function used internally
        const { isReadOnLinkPath } = await import('./loadGraphFromDisk')

        const readOnLinkPaths: readonly string[] = ['/path/to/read-vault', '/path/to/another-vault']

        // Node in readOnLinkPath should return true
        expect(isReadOnLinkPath('/path/to/read-vault/node.md', readOnLinkPaths)).toBe(true)
        expect(isReadOnLinkPath('/path/to/read-vault/subdir/node.md', readOnLinkPaths)).toBe(true)
        expect(isReadOnLinkPath('/path/to/another-vault/node.md', readOnLinkPaths)).toBe(true)

        // Node NOT in readOnLinkPath should return false
        expect(isReadOnLinkPath('/path/to/write-vault/node.md', readOnLinkPaths)).toBe(false)
        expect(isReadOnLinkPath('/completely/different/path.md', readOnLinkPaths)).toBe(false)
    })
})

describe('resolveLinkedNodes', () => {
    let tmpDir: string
    let writePath: string
    let readOnLinkPath: string

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-linked-test-'))
        writePath = path.join(tmpDir, 'write-vault')
        readOnLinkPath = path.join(tmpDir, 'read-vault')

        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readOnLinkPath, { recursive: true })

        // Create a chain: A -> B -> C -> D (all in readOnLinkPath except A)
        await fs.writeFile(
            path.join(writePath, 'a.md'),
            `# Node A

Links to [[b]].`
        )

        await fs.writeFile(
            path.join(readOnLinkPath, 'b.md'),
            `# Node B

Links to [[c]].`
        )

        await fs.writeFile(
            path.join(readOnLinkPath, 'c.md'),
            `# Node C

Links to [[d]].`
        )

        await fs.writeFile(
            path.join(readOnLinkPath, 'd.md'),
            `# Node D

End of chain.`
        )

        // Create an orphan node
        await fs.writeFile(
            path.join(readOnLinkPath, 'orphan.md'),
            `# Orphan

Not linked by anyone.`
        )
    })

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('should resolve entire transitive chain', async () => {
        const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            [writePath],
            [readOnLinkPath]
        )

        if (E.isLeft(result)) throw new Error('Expected Right')
        const graph: Graph = result.right

        const nodeIds: readonly string[] = Object.keys(graph.nodes)

        // All chain nodes should be loaded
        expect(nodeIds.some(id => id.includes('/a.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/b.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/c.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/d.md'))).toBe(true)

        // Orphan should NOT be loaded
        expect(nodeIds.some(id => id.includes('/orphan.md'))).toBe(false)
    })
})
