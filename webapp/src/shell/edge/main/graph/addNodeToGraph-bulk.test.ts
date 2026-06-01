import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as E from 'fp-ts/lib/Either.js'
import type { Graph, GraphNode } from '@vt/graph-model/graph'
import { loadGraphFromDisk } from '@vt/graph-db-server/graph/loadGraphFromDisk'
import type { FileLimitExceededError } from '@vt/graph-db-server/graph/fileLimitEnforce'

// Helper to find a node by filename or relative path (since node IDs are now absolute paths)
function findNodeByFilename(graph: Graph, relativePathOrFilename: string): GraphNode | undefined {
  const normalized: string = relativePathOrFilename.replace(/\\/g, '/')
  const nodeId: string | undefined = Object.keys(graph.nodes).find(id =>
    id.endsWith(`/${normalized}`) || id.endsWith(`\\${normalized}`)
  )
  return nodeId ? graph.nodes[nodeId] : undefined
}

function getFilename(absolutePath: string): string {
  return path.basename(absolutePath)
}

describe('Progressive Edge Validation - Bulk Load', () => {
  let testProjectPath: string = ''

  beforeAll(async () => {
    testProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'edge-bulk-test-'))
  })

  afterAll(async () => {
    await fs.rm(testProjectPath, { recursive: true, force: true })
  })

  describe('Edge Resolution Order Independence', () => {
    it('should produce identical graphs when loading files in forward order (target exists before source)', async () => {
      const forwardProjectPath: string = path.join(testProjectPath, 'forward-order')
      await fs.mkdir(forwardProjectPath, { recursive: true })
      await fs.writeFile(path.join(forwardProjectPath, 'target.md'), '# Target Node')
      await fs.writeFile(path.join(forwardProjectPath, 'source.md'), '# Source Node\n\n- links to [[target]]')

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([forwardProjectPath])
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      const sourceNode: GraphNode | undefined = findNodeByFilename(graph, 'source.md')
      const targetNode: GraphNode | undefined = findNodeByFilename(graph, 'target.md')
      expect(sourceNode).toBeDefined()
      expect(targetNode).toBeDefined()
      expect(sourceNode!.outgoingEdges).toHaveLength(1)
      expect(getFilename(sourceNode!.outgoingEdges[0].targetId)).toBe('target.md')
      expect(sourceNode!.outgoingEdges[0].label).toBe('links to')

      await fs.rm(forwardProjectPath, { recursive: true })
    })

    it('should produce identical graphs when loading files in reverse order (source exists before target)', async () => {
      const reverseProjectPath: string = path.join(testProjectPath, 'reverse-order')
      await fs.mkdir(reverseProjectPath, { recursive: true })
      await fs.writeFile(path.join(reverseProjectPath, 'source.md'), '# Source Node\n\n- links to [[target]]')
      await fs.writeFile(path.join(reverseProjectPath, 'target.md'), '# Target Node')

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([reverseProjectPath])
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      const sourceNode: GraphNode | undefined = findNodeByFilename(graph, 'source.md')
      const targetNode: GraphNode | undefined = findNodeByFilename(graph, 'target.md')
      expect(sourceNode).toBeDefined()
      expect(targetNode).toBeDefined()
      expect(sourceNode!.outgoingEdges).toHaveLength(1)
      expect(getFilename(sourceNode!.outgoingEdges[0].targetId)).toBe('target.md')
      expect(sourceNode!.outgoingEdges[0].label).toBe('links to')

      await fs.rm(reverseProjectPath, { recursive: true })
    })

    it('should resolve subfolder links regardless of order (felix/2 -> [[1]] -> felix/1)', async () => {
      const subfolderProjectPath: string = path.join(testProjectPath, 'subfolder-test')
      await fs.mkdir(path.join(subfolderProjectPath, 'felix'), { recursive: true })
      await fs.writeFile(path.join(subfolderProjectPath, 'felix', '2.md'), '# Node 2\n\n- related [[1]]')
      await fs.writeFile(path.join(subfolderProjectPath, 'felix', '1.md'), '# Node 1')

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([subfolderProjectPath])
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      const felix2: GraphNode | undefined = findNodeByFilename(graph, 'felix/2.md')
      const felix1: GraphNode | undefined = findNodeByFilename(graph, 'felix/1.md')
      expect(felix2).toBeDefined()
      expect(felix1).toBeDefined()
      expect(felix2!.outgoingEdges).toHaveLength(1)
      expect(felix2!.outgoingEdges[0].targetId).toContain('felix/1.md')
      expect(felix2!.outgoingEdges[0].label).toBe('related')

      await fs.rm(subfolderProjectPath, { recursive: true })
    })

    it('should handle chain of dependencies regardless of order', async () => {
      const chainProjectPath: string = path.join(testProjectPath, 'chain-test')
      await fs.mkdir(chainProjectPath, { recursive: true })
      await fs.writeFile(path.join(chainProjectPath, 'c.md'), '# C')
      await fs.writeFile(path.join(chainProjectPath, 'b.md'), '# B\n\n- extends [[c]]')
      await fs.writeFile(path.join(chainProjectPath, 'a.md'), '# A\n\n- extends [[b]]')

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([chainProjectPath])
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      const nodeA: GraphNode | undefined = findNodeByFilename(graph, 'a.md')
      const nodeB: GraphNode | undefined = findNodeByFilename(graph, 'b.md')
      const nodeC: GraphNode | undefined = findNodeByFilename(graph, 'c.md')
      expect(getFilename(nodeA!.outgoingEdges[0].targetId)).toBe('b.md')
      expect(getFilename(nodeB!.outgoingEdges[0].targetId)).toBe('c.md')
      expect(nodeC!.outgoingEdges).toHaveLength(0)

      await fs.rm(chainProjectPath, { recursive: true })
    })
  })

  describe('Edge Cases: Non-existent Nodes', () => {
    it('bulk load should preserve raw link text when target never exists', async () => {
      const projectRoot: string = path.join(testProjectPath, 'non-existent-bulk')
      await fs.mkdir(projectRoot, { recursive: true })
      await fs.writeFile(path.join(projectRoot, 'source.md'), '# Source\n\n- broken link [[does-not-exist]]')

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([projectRoot])
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      const sourceNode: GraphNode | undefined = findNodeByFilename(graph, 'source.md')
      expect(sourceNode).toBeDefined()
      expect(sourceNode!.outgoingEdges).toHaveLength(1)
      expect(sourceNode!.outgoingEdges[0].targetId).toBe('does-not-exist')

      await fs.rm(projectRoot, { recursive: true })
    })

    it('should handle multiple unresolved links', async () => {
      const projectRoot: string = path.join(testProjectPath, 'multiple-unresolved')
      await fs.mkdir(projectRoot, { recursive: true })
      await fs.writeFile(path.join(projectRoot, 'source.md'), '# Source\n\n- link1 [[a]]\n- link2 [[b]]\n- link3 [[c]]')

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([projectRoot])
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      const sourceNode: GraphNode | undefined = findNodeByFilename(graph, 'source.md')
      expect(sourceNode).toBeDefined()
      expect(sourceNode!.outgoingEdges).toHaveLength(3)
      expect(sourceNode!.outgoingEdges.map((e: { readonly targetId: string }) => e.targetId)).toEqual(['a', 'b', 'c'])

      await fs.rm(projectRoot, { recursive: true })
    })
  })
})
