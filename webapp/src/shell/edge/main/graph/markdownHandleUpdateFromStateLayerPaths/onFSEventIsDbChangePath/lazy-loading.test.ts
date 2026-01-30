import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk, isReadPath, extractLinkTargets, resolveLinkTarget } from './loadGraphFromDisk'
import { applyGraphDeltaToGraph } from '@/pure/graph'
import type { Graph, GraphDelta, GraphNode, Edge } from '@/pure/graph'
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

/**
 * Helper to create a minimal GraphNode for testing extractLinkTargets.
 * Only populates fields used by the function under test.
 */
function createMockGraphNode(outgoingEdges: readonly Edge[]): GraphNode {
    return {
        outgoingEdges,
        absoluteFilePathIsID: '/test/node.md',
        contentWithoutYamlOrLinks: '',
        nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: new Map()
        }
    } as GraphNode
}

describe('extractLinkTargets', () => {
    it('should return empty array for node with no outgoing edges', () => {
        const node: GraphNode = createMockGraphNode([])

        const result: readonly string[] = extractLinkTargets(node)

        expect(result).toEqual([])
    })

    it('should return single targetId for node with one outgoing edge', () => {
        const edges: readonly Edge[] = [{ targetId: '/path/to/target.md', label: '' }]
        const node: GraphNode = createMockGraphNode(edges)

        const result: readonly string[] = extractLinkTargets(node)

        expect(result).toEqual(['/path/to/target.md'])
    })

    it('should return all targetIds in order for node with multiple outgoing edges', () => {
        const edges: readonly Edge[] = [
            { targetId: '/path/to/first.md', label: '' },
            { targetId: '/path/to/second.md', label: 'related' },
            { targetId: '/path/to/third.md', label: '' }
        ]
        const node: GraphNode = createMockGraphNode(edges)

        const result: readonly string[] = extractLinkTargets(node)

        expect(result).toEqual([
            '/path/to/first.md',
            '/path/to/second.md',
            '/path/to/third.md'
        ])
    })
})

/**
 * Tests for resolveLinkTarget I/O function.
 * This function resolves wikilink targets to absolute file paths.
 */
describe('resolveLinkTarget', () => {
    let tmpDir: string

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-link-target-test-'))

        // Create test files for absolute path tests
        await fs.writeFile(path.join(tmpDir, 'existing-file.md'), '# Existing File')

        // Create subdirectory structure for relative path tests
        await fs.mkdir(path.join(tmpDir, 'subdir'), { recursive: true })
        await fs.mkdir(path.join(tmpDir, 'other'), { recursive: true })
        await fs.mkdir(path.join(tmpDir, 'nested', 'deep'), { recursive: true })

        // Files for relative path single match
        await fs.writeFile(path.join(tmpDir, 'unique-note.md'), '# Unique Note')

        // Files for relative path multiple matches (same filename in different dirs)
        await fs.writeFile(path.join(tmpDir, 'subdir', 'common.md'), '# Common in subdir')
        await fs.writeFile(path.join(tmpDir, 'other', 'common.md'), '# Common in other')
        await fs.writeFile(path.join(tmpDir, 'nested', 'deep', 'common.md'), '# Common in nested/deep')
    })

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true })
    })

    // --- Absolute Path Cases ---

    it('should return absolute path as-is when file exists with .md extension', async () => {
        const filePath: string = path.join(tmpDir, 'existing-file.md')

        const result: string | undefined = await resolveLinkTarget(filePath, tmpDir)

        expect(result).toBe(filePath)
    })

    it('should add .md extension and return path when absolute path exists without extension', async () => {
        const filePathWithoutExt: string = path.join(tmpDir, 'existing-file')
        const expectedPath: string = path.join(tmpDir, 'existing-file.md')

        const result: string | undefined = await resolveLinkTarget(filePathWithoutExt, tmpDir)

        expect(result).toBe(expectedPath)
    })

    it('should return undefined for absolute path that does not exist', async () => {
        const nonExistentPath: string = path.join(tmpDir, 'non-existent.md')

        const result: string | undefined = await resolveLinkTarget(nonExistentPath, tmpDir)

        expect(result).toBeUndefined()
    })

    // --- Relative Path Cases ---

    it('should return matched file path for single match', async () => {
        const result: string | undefined = await resolveLinkTarget('unique-note', tmpDir)

        expect(result).toBe(path.join(tmpDir, 'unique-note.md'))
    })

    it('should use linkMatchScore to select best match when multiple files match', async () => {
        // Link with path component "nested/deep/common" should match nested/deep/common.md best
        const result: string | undefined = await resolveLinkTarget('nested/deep/common', tmpDir)

        expect(result).toBe(path.join(tmpDir, 'nested', 'deep', 'common.md'))
    })

    it('should return undefined when no matches found', async () => {
        const result: string | undefined = await resolveLinkTarget('no-such-file', tmpDir)

        expect(result).toBeUndefined()
    })

    it('should return undefined for empty search pattern', async () => {
        const result: string | undefined = await resolveLinkTarget('', tmpDir)

        expect(result).toBeUndefined()
    })

    it('should handle link with .md extension in relative path', async () => {
        const result: string | undefined = await resolveLinkTarget('unique-note.md', tmpDir)

        expect(result).toBe(path.join(tmpDir, 'unique-note.md'))
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
