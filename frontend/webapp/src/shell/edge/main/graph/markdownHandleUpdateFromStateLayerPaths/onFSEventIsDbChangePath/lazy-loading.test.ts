import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk, isReadPath } from './loadGraphFromDisk'
import { applyGraphDeltaToGraph } from '@/pure/graph'
import type { Graph, GraphDelta } from '@/pure/graph'
import type { FileLimitExceededError } from './fileLimitEnforce'

/**
 * Tests for isReadPath helper and resolveLinkedNodesInWatchedFolder.
 */
describe('isReadPath', () => {
    it('should correctly identify readPaths nodes', () => {
        const readPaths: readonly string[] = ['/path/to/read-vault', '/path/to/another-vault']

        // Node in readPath should return true
        expect(isReadPath('/path/to/read-vault/node.md', readPaths)).toBe(true)
        expect(isReadPath('/path/to/read-vault/subdir/node.md', readPaths)).toBe(true)
        expect(isReadPath('/path/to/another-vault/node.md', readPaths)).toBe(true)

        // Node NOT in readPath should return false
        expect(isReadPath('/path/to/write-vault/node.md', readPaths)).toBe(false)
        expect(isReadPath('/completely/different/path.md', readPaths)).toBe(false)
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
        const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(
            [writePath]
        )

        if (E.isLeft(initialResult)) throw new Error('Expected Right')
        const initialGraph: Graph = initialResult.right

        // Only A should be loaded initially
        expect(Object.keys(initialGraph.nodes)).toHaveLength(1)
        expect(Object.keys(initialGraph.nodes)[0]).toContain('a.md')

        // Now resolve links in watched folder (returns delta, apply to get resolved graph)
        const resolutionDelta: GraphDelta = await resolveLinkedNodesInWatchedFolder(initialGraph, watchedFolder)
        const resolvedGraph: Graph = applyGraphDeltaToGraph(initialGraph, resolutionDelta)

        const nodeIds: readonly string[] = Object.keys(resolvedGraph.nodes)

        // All chain nodes should be loaded via resolve-on-link
        expect(nodeIds.some(id => id.includes('/a.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/b.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/c.md'))).toBe(true)
        expect(nodeIds.some(id => id.includes('/d.md'))).toBe(true)
    })
})
