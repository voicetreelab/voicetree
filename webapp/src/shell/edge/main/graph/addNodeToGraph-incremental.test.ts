import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import type { Graph, FSUpdate, GraphDelta, GraphNode } from '@vt/graph-model/pure/graph'
import { createGraph } from '@vt/graph-model/pure/graph/createGraph'
import { applyGraphDeltaToGraph } from '@vt/graph-model/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import { mapFSEventsToGraphDelta } from '@vt/graph-model/pure/graph/mapFSEventsToGraphDelta'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

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

function getSortedFilenames(graph: Graph): readonly string[] {
  return Object.keys(graph.nodes).map(id => getFilename(id)).sort()
}

describe('Progressive Edge Validation - Incremental Updates', () => {
  let testVaultPath: string = ''

  beforeAll(async () => {
    testVaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'edge-incremental-test-'))
  })

  afterAll(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true })
  })

  describe('mapFSEventsToGraphDelta edge resolution', () => {
    it('should resolve edges when target already exists in graph', () => {
      const currentGraph: Graph = createGraph({
        'target.md': {
          absoluteFilePathIsID: 'target.md',
          contentWithoutYamlOrLinks: '# Target',
          outgoingEdges: [],
          nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
        }
      })

      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'source.md'),
        content: '# Source\n\n- links [[target]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(getFilename(delta[0].nodeToUpsert.absoluteFilePathIsID)).toBe('source.md')
        expect(delta[0].nodeToUpsert.outgoingEdges).toHaveLength(1)
        expect(delta[0].nodeToUpsert.outgoingEdges[0].targetId).toBe('target.md')
      }
    })

    it('should store raw link text when target does not exist yet', () => {
      const currentGraph: Graph = createGraph({})
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'source.md'),
        content: '# Source\n\n- links [[non-existent]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.outgoingEdges[0].targetId).toBe('non-existent')
      }
    })

    it('incremental should preserve raw link text when target never exists', () => {
      const currentGraph: Graph = createGraph({})
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'source.md'),
        content: '# Source\n\n- broken [[does-not-exist]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.outgoingEdges[0].targetId).toBe('does-not-exist')
      }
    })

    it('should resolve subfolder links when target exists', () => {
      const currentGraph: Graph = createGraph({
        'felix/1.md': {
          absoluteFilePathIsID: 'felix/1.md',
          contentWithoutYamlOrLinks: '# Node 1',
          outgoingEdges: [],
          nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
        }
      })

      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'felix', '2.md'),
        content: '# Node 2\n\n- related [[1]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.outgoingEdges[0].targetId).toBe('felix/1.md')
      }
    })

    it('should include parent in delta when previously dangling edges become resolvable', () => {
      const currentGraph: Graph = createGraph({
        'parent.md': {
          absoluteFilePathIsID: 'parent.md',
          contentWithoutYamlOrLinks: '# Parent',
          outgoingEdges: [{ targetId: 'child.md', label: 'links to' }],
          nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
        }
      })

      const fsEvent: FSUpdate = { absolutePath: path.join(testVaultPath, 'child.md'), content: '# Child', eventType: 'Added' }
      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta).toHaveLength(2)
      if (delta[0].type === 'UpsertNode') {
        expect(getFilename(delta[0].nodeToUpsert.absoluteFilePathIsID)).toBe('child.md')
      }
      if (delta[1].type === 'UpsertNode') {
        expect(delta[1].nodeToUpsert.absoluteFilePathIsID).toBe('parent.md')
        expect(delta[1].previousNode._tag).toBe('Some')
      }
    })

    it('BUG REGRESSION: edge with exact targetId match should emit delta when target node appears', () => {
      const currentGraph: Graph = createGraph({
        'source.md': {
          absoluteFilePathIsID: 'source.md',
          contentWithoutYamlOrLinks: '# Source',
          outgoingEdges: [{ targetId: 'target.md', label: 'links to' }],
          nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
        }
      })

      expect(currentGraph.nodes['target.md']).toBeUndefined()

      const fsEvent: FSUpdate = { absolutePath: path.join(testVaultPath, 'target.md'), content: '# Target', eventType: 'Added' }
      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta).toHaveLength(2)
      const sourceNodeDelta: GraphDelta[number] | undefined = delta.find(d =>
        d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === 'source.md'
      )
      expect(sourceNodeDelta).toBeDefined()
    })

    it('should skip parent delta when edge was never dangling', () => {
      const currentGraph: Graph = createGraph({
        'parent.md': {
          absoluteFilePathIsID: 'parent.md',
          contentWithoutYamlOrLinks: '# Parent',
          outgoingEdges: [{ targetId: 'child.md', label: 'links to' }],
          nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
        },
        'child.md': {
          absoluteFilePathIsID: 'child.md',
          contentWithoutYamlOrLinks: '# Child',
          outgoingEdges: [],
          nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
        }
      })

      const fsEvent: FSUpdate = { absolutePath: path.join(testVaultPath, 'child.md'), content: '# Child updated', eventType: 'Changed' }
      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, currentGraph)

      expect(delta).toHaveLength(1)
      if (delta[0].type === 'UpsertNode') {
        expect(getFilename(delta[0].nodeToUpsert.absoluteFilePathIsID)).toBe('child.md')
      }
    })
  })

  describe('Unified Behavior: Bulk and Incremental Produce Same Result', () => {
    it('should produce identical graphs: bulk load vs sequential incremental', async () => {
      const bulkVaultPath: string = path.join(testVaultPath, 'bulk-unified')
      await fs.mkdir(bulkVaultPath, { recursive: true })
      await fs.writeFile(path.join(bulkVaultPath, 'a.md'), '# A\n\n- links [[b]]')
      await fs.writeFile(path.join(bulkVaultPath, 'b.md'), '# B\n\n- links [[c]]')
      await fs.writeFile(path.join(bulkVaultPath, 'c.md'), '# C')

      const bulkResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([bulkVaultPath])
      if (E.isLeft(bulkResult)) throw new Error('Expected Right')
      const bulkGraph: Graph = bulkResult.right

      const incrementalVaultPath: string = path.join(testVaultPath, 'incremental-unified')
      await fs.mkdir(incrementalVaultPath, { recursive: true })

      const files: readonly { readonly name: string; readonly content: string; }[] = [
        { name: 'a.md', content: '# A\n\n- links [[b]]' },
        { name: 'b.md', content: '# B\n\n- links [[c]]' },
        { name: 'c.md', content: '# C' }
      ]

      const incrementalGraph: Graph = files.reduce((graph, file) => {
        const fsEvent: FSUpdate = { absolutePath: path.join(incrementalVaultPath, file.name), content: file.content, eventType: 'Added' }
        return applyGraphDeltaToGraph(graph, mapFSEventsToGraphDelta(fsEvent, graph))
      }, createGraph({}))

      expect(getSortedFilenames(bulkGraph)).toEqual(getSortedFilenames(incrementalGraph))

      const bulkA: GraphNode | undefined = findNodeByFilename(bulkGraph, 'a.md')
      const incA: GraphNode | undefined = findNodeByFilename(incrementalGraph, 'a.md')
      const bulkB: GraphNode | undefined = findNodeByFilename(bulkGraph, 'b.md')
      const incB: GraphNode | undefined = findNodeByFilename(incrementalGraph, 'b.md')
      const bulkC: GraphNode | undefined = findNodeByFilename(bulkGraph, 'c.md')
      const incC: GraphNode | undefined = findNodeByFilename(incrementalGraph, 'c.md')

      expect(getFilename(bulkA!.outgoingEdges[0].targetId)).toBe('b.md')
      expect(getFilename(incA!.outgoingEdges[0].targetId)).toBe('b.md')
      expect(getFilename(bulkB!.outgoingEdges[0].targetId)).toBe('c.md')
      expect(getFilename(incB!.outgoingEdges[0].targetId)).toBe('c.md')
      expect(bulkC!.outgoingEdges).toHaveLength(0)
      expect(incC!.outgoingEdges).toHaveLength(0)

      await fs.rm(bulkVaultPath, { recursive: true })
      await fs.rm(incrementalVaultPath, { recursive: true })
    })

    it('should produce identical graphs: bulk load vs incremental in REVERSE order', async () => {
      const bulkVaultPath: string = path.join(testVaultPath, 'bulk-reverse')
      await fs.mkdir(bulkVaultPath, { recursive: true })
      await fs.writeFile(path.join(bulkVaultPath, 'a.md'), '# A\n\n- links [[b]]')
      await fs.writeFile(path.join(bulkVaultPath, 'b.md'), '# B')

      const bulkResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([bulkVaultPath])
      if (E.isLeft(bulkResult)) throw new Error('Expected Right')
      const bulkGraph: Graph = bulkResult.right

      const incrementalVaultPath: string = path.join(testVaultPath, 'incremental-reverse')
      await fs.mkdir(incrementalVaultPath, { recursive: true })

      const files: readonly { readonly name: string; readonly content: string; }[] = [
        { name: 'b.md', content: '# B' },
        { name: 'a.md', content: '# A\n\n- links [[b]]' }
      ]

      const incrementalGraph: Graph = files.reduce((graph, file) => {
        const fsEvent: FSUpdate = { absolutePath: path.join(incrementalVaultPath, file.name), content: file.content, eventType: 'Added' }
        return applyGraphDeltaToGraph(graph, mapFSEventsToGraphDelta(fsEvent, graph))
      }, createGraph({}))

      const bulkA: GraphNode | undefined = findNodeByFilename(bulkGraph, 'a.md')
      const incA: GraphNode | undefined = findNodeByFilename(incrementalGraph, 'a.md')
      expect(bulkA).toBeDefined()
      expect(incA).toBeDefined()
      expect(getFilename(bulkA!.outgoingEdges[0].targetId)).toBe('b.md')
      expect(getFilename(incA!.outgoingEdges[0].targetId)).toBe('b.md')

      await fs.rm(bulkVaultPath, { recursive: true })
      await fs.rm(incrementalVaultPath, { recursive: true })
    })
  })
})
