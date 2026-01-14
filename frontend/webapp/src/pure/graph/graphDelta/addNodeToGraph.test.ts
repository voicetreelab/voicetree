import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import type { Graph, FSUpdate, GraphDelta, GraphNode } from '@/pure/graph'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import { mapFSEventsToGraphDelta } from '@/pure/graph/mapFSEventsToGraphDelta'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

/**
 * TDD Tests for Progressive Edge Validation
 *
 * These tests verify that both bulk load and incremental updates:
 * 1. Handle edges to non-existent nodes (store raw link text)
 * 2. Resolve edges when target nodes exist
 * 3. Produce identical graphs regardless of node addition order
 * 4. Heal incoming edges when new nodes are added
 *
 * CURRENT STATE: These tests should PASS with existing implementation
 * (we're not changing behavior, just unifying the code paths)
 */

describe('Progressive Edge Validation - Unified Behavior', () => {
  // eslint-disable-next-line functional/no-let
  let testVaultPath: string = ''

  beforeAll(async () => {
    const tmpDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'edge-validation-test-'))
    testVaultPath = tmpDir
    await fs.mkdir(testVaultPath, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true })
  })

  describe('Bulk Load: Edge Resolution Order Independence', () => {
    it('should produce identical graphs when loading files in forward order (target exists before source)', async () => {
      // Setup: Create temporary vault for forward order test
      const forwardVaultPath: string = path.join(testVaultPath, 'forward-order')
      await fs.mkdir(forwardVaultPath, { recursive: true })

      // Files in order: target first, then source
      await fs.writeFile(
        path.join(forwardVaultPath, 'target.md'),
        '# Target Node'
      )
      await fs.writeFile(
        path.join(forwardVaultPath, 'source.md'),
        '# Source Node\n\n- links to [[target]]'
      )

      const result: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([forwardVaultPath], forwardVaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(result)) throw new Error('Expected Right')
      const graph: Graph = result.right

      // Verify: source node has edge to target using target's node ID
      expect(graph.nodes['source.md']).toBeDefined()
      expect(graph.nodes['target.md']).toBeDefined()
      expect(graph.nodes['source.md'].outgoingEdges).toHaveLength(1)
      expect(graph.nodes['source.md'].outgoingEdges[0].targetId).toBe('target.md')
      expect(graph.nodes['source.md'].outgoingEdges[0].label).toBe('links to')

      await fs.rm(forwardVaultPath, { recursive: true })
    })

    it('should produce identical graphs when loading files in reverse order (source exists before target)', async () => {
      // Setup: Create temporary vault for reverse order test
      const reverseVaultPath: string = path.join(testVaultPath, 'reverse-order')
      await fs.mkdir(reverseVaultPath, { recursive: true })

      // Files in reverse order: source first (target doesn't exist yet)
      await fs.writeFile(
        path.join(reverseVaultPath, 'source.md'),
        '# Source Node\n\n- links to [[target]]'
      )
      await fs.writeFile(
        path.join(reverseVaultPath, 'target.md'),
        '# Target Node'
      )

      const result2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([reverseVaultPath], reverseVaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(result2)) throw new Error('Expected Right')
      const graph: Graph = result2.right

      // Verify: SAME RESULT as forward order
      expect(graph.nodes['source.md']).toBeDefined()
      expect(graph.nodes['target.md']).toBeDefined()
      expect(graph.nodes['source.md'].outgoingEdges).toHaveLength(1)
      expect(graph.nodes['source.md'].outgoingEdges[0].targetId).toBe('target.md')
      expect(graph.nodes['source.md'].outgoingEdges[0].label).toBe('links to')

      await fs.rm(reverseVaultPath, { recursive: true })
    })

    it('should resolve subfolder links regardless of order (felix/2 -> [[1]] -> felix/1)', async () => {
      // Setup: Test subfolder link resolution bug
      const subfolderVaultPath: string = path.join(testVaultPath, 'subfolder-test')
      await fs.mkdir(path.join(subfolderVaultPath, 'felix'), { recursive: true })

      // Add in reverse order: file with link first
      await fs.writeFile(
        path.join(subfolderVaultPath, 'felix', '2.md'),
        '# Node 2\n\n- related [[1]]'
      )
      await fs.writeFile(
        path.join(subfolderVaultPath, 'felix', '1.md'),
        '# Node 1'
      )

      const result3: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([subfolderVaultPath], subfolderVaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(result3)) throw new Error('Expected Right')
      const graph: Graph = result3.right

      // Verify: Link resolves to felix/1 (not just "1")
      expect(graph.nodes['felix/2.md']).toBeDefined()
      expect(graph.nodes['felix/1.md']).toBeDefined()
      expect(graph.nodes['felix/2.md'].outgoingEdges).toHaveLength(1)
      expect(graph.nodes['felix/2.md'].outgoingEdges[0].targetId).toBe('felix/1.md')
      expect(graph.nodes['felix/2.md'].outgoingEdges[0].label).toBe('related')

      await fs.rm(subfolderVaultPath, { recursive: true })
    })

    it('should handle chain of dependencies regardless of order', async () => {
      // Setup: a->b->c loaded as c,b,a
      const chainVaultPath: string = path.join(testVaultPath, 'chain-test')
      await fs.mkdir(chainVaultPath, { recursive: true })

      // Reverse order
      await fs.writeFile(
        path.join(chainVaultPath, 'c.md'),
        '# C'
      )
      await fs.writeFile(
        path.join(chainVaultPath, 'b.md'),
        '# B\n\n- extends [[c]]'
      )
      await fs.writeFile(
        path.join(chainVaultPath, 'a.md'),
        '# A\n\n- extends [[b]]'
      )

      const result4: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([chainVaultPath], chainVaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(result4)) throw new Error('Expected Right')
      const graph: Graph = result4.right

      // Verify: All edges resolved
      expect(graph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b.md')
      expect(graph.nodes['b.md'].outgoingEdges[0].targetId).toBe('c.md')
      expect(graph.nodes['c.md'].outgoingEdges).toHaveLength(0)

      await fs.rm(chainVaultPath, { recursive: true })
    })
  })

  describe('Incremental Updates: Edge Resolution with mapFSEventsToGraphDelta', () => {
    it('should resolve edges when target already exists in graph', () => {
      // Setup: Graph with target node already loaded
      const currentGraph: Graph = {
        nodes: {
          'target.md': {
            relativeFilePathIsID: 'target.md',
            contentWithoutYamlOrLinks: '# Target',
            outgoingEdges: [],
            nodeUIMetadata: {

              color: O.none,
              position: O.none,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          }
        }
      }

      // Incremental: Add source node that links to target
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'source.md'),
        content: '# Source\n\n- links [[target]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      // Verify: Edge resolves to existing target node
      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        const node: GraphNode = delta[0].nodeToUpsert
        expect(node.relativeFilePathIsID).toBe('source.md')
        expect(node.outgoingEdges).toHaveLength(1)
        expect(node.outgoingEdges[0].targetId).toBe('target.md')
      }
    })

    it('should store raw link text when target does not exist yet', () => {
      // Setup: Empty graph
      const currentGraph: Graph = { nodes: {} }

      // Incremental: Add node with link to non-existent target
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'source.md'),
        content: '# Source\n\n- links [[non-existent]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      // Verify: Edge has raw link text (not resolved)
      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        const node: GraphNode = delta[0].nodeToUpsert
        expect(node.outgoingEdges).toHaveLength(1)
        expect(node.outgoingEdges[0].targetId).toBe('non-existent')
      }
    })

    it('should resolve subfolder links when target exists', () => {
      // Setup: Graph with felix/1 already loaded
      const currentGraph: Graph = {
        nodes: {
          'felix/1.md': {
            relativeFilePathIsID: 'felix/1.md',
            contentWithoutYamlOrLinks: '# Node 1',
            outgoingEdges: [],
            nodeUIMetadata: {

              color: O.none,
              position: O.none,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          }
        }
      }

      // Incremental: Add felix/2 with link [[1]]
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'felix', '2.md'),
        content: '# Node 2\n\n- related [[1]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      // Verify: Link resolves to felix/1
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        const node: GraphNode = delta[0].nodeToUpsert
        expect(node.outgoingEdges[0].targetId).toBe('felix/1.md')
      }
    })

    it('should include parent in delta when previously dangling edges become resolvable', () => {
      // Setup: Parent references child.md but child node is missing (dangling edge)
      const currentGraph: Graph = {
        nodes: {
          'parent.md': {
            relativeFilePathIsID: 'parent.md',
            contentWithoutYamlOrLinks: '# Parent',
            outgoingEdges: [{ targetId: 'child.md', label: 'links to' }],
            nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
          }
        }
      }

      // Add child node (resolves the dangling edge)
      const fsEvent: FSUpdate = { absolutePath: path.join(testVaultPath, 'child.md'), content: '# Child', eventType: 'Added' }
      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      // Expect delta to include new child node AND healed parent so UI can draw the edge
      expect(delta).toHaveLength(2)
      expect(delta[0].type).toBe('UpsertNode')
      expect(delta[1].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('child.md')
      }
      if (delta[1].type === 'UpsertNode') {
        expect(delta[1].nodeToUpsert.relativeFilePathIsID).toBe('parent.md')
        expect(delta[1].previousNode._tag).toBe('Some')
      }
    })

    it('BUG REGRESSION: edge with exact targetId match should emit delta when target node appears', () => {
      // BUG: [file.md] creates edge with targetId "file.md", target doesn't exist yet
      // When file.md is added, old logic: targetId unchanged ("file.md" === "file.md") → no delta
      // Result: UI never receives delta, edge never rendered despite both nodes existing
      const currentGraph: Graph = {
        nodes: {
          'source.md': {
            relativeFilePathIsID: 'source.md',
            contentWithoutYamlOrLinks: '# Source',
            // Edge targetId EXACTLY matches the node ID that will be created - no fuzzy matching needed
            outgoingEdges: [{ targetId: 'target.md', label: 'links to' }],
            nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
          }
        }
      }

      // Target node doesn't exist yet - edge is dangling
      expect(currentGraph.nodes['target.md']).toBeUndefined()

      // Add the target node
      const fsEvent: FSUpdate = { absolutePath: path.join(testVaultPath, 'target.md'), content: '# Target', eventType: 'Added' }
      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      // CRITICAL: Delta must include source node so UI can draw the edge
      // Without the dangling-edge fix, delta.length would be 1 (only target.md)
      expect(delta).toHaveLength(2)
      const sourceNodeDelta: GraphDelta[number] | undefined = delta.find(d => d.type === 'UpsertNode' && d.nodeToUpsert.relativeFilePathIsID === 'source.md')
      expect(sourceNodeDelta).toBeDefined()
    })

    it('should skip parent delta when edge was never dangling', () => {
      // Setup: Parent and child already exist, edge points to real child node
      const currentGraph: Graph = {
        nodes: {
          'parent.md': {
            relativeFilePathIsID: 'parent.md',
            contentWithoutYamlOrLinks: '# Parent',
            outgoingEdges: [{ targetId: 'child.md', label: 'links to' }],
            nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
          },
          'child.md': {
            relativeFilePathIsID: 'child.md',
            contentWithoutYamlOrLinks: '# Child',
            outgoingEdges: [],
            nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map(), isContextNode: false }
          }
        }
      }

      // Re-add child node (e.g., file change) - should not trigger redundant parent delta
      const fsEvent: FSUpdate = { absolutePath: path.join(testVaultPath, 'child.md'), content: '# Child updated', eventType: 'Changed' }
      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('child.md')
      }
    })
  })

  describe('Unified Behavior: Bulk and Incremental Produce Same Result', () => {
    it('should produce identical graphs: bulk load vs sequential incremental', async () => {
      // BULK LOAD
      const bulkVaultPath: string = path.join(testVaultPath, 'bulk-unified')
      await fs.mkdir(bulkVaultPath, { recursive: true })

      await fs.writeFile(path.join(bulkVaultPath, 'a.md'), '# A\n\n- links [[b]]')
      await fs.writeFile(path.join(bulkVaultPath, 'b.md'), '# B\n\n- links [[c]]')
      await fs.writeFile(path.join(bulkVaultPath, 'c.md'), '# C')

      const bulkResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([bulkVaultPath], bulkVaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(bulkResult)) throw new Error('Expected Right')
      const bulkGraph: Graph = bulkResult.right

      // INCREMENTAL (simulate sequential file additions)
      const incrementalVaultPath: string = path.join(testVaultPath, 'incremental-unified')
      await fs.mkdir(incrementalVaultPath, { recursive: true })

      // Add files one by one using mapFSEventsToGraphDelta
      const files: readonly { readonly name: string; readonly content: string; }[] = [
        { name: 'a.md', content: '# A\n\n- links [[b]]' },
        { name: 'b.md', content: '# B\n\n- links [[c]]' },
        { name: 'c.md', content: '# C' }
      ]

      const incrementalGraph: Graph = files.reduce((graph, file) => {
        const fsEvent: FSUpdate = {
          absolutePath: path.join(incrementalVaultPath, file.name),
          content: file.content,
          eventType: 'Added'
        }
        const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, incrementalVaultPath, graph)
        return applyGraphDeltaToGraph(graph, delta)
      }, { nodes: {} } as Graph)

      // Verify: Nodes exist with correct IDs
      expect(Object.keys(bulkGraph.nodes).sort()).toEqual(Object.keys(incrementalGraph.nodes).sort())

      // NEW BEHAVIOR: With bidirectional edge healing, bulk and incremental produce IDENTICAL results!
      // When b.md is added incrementally, it HEALS a.md's edge from 'b' to 'b.md'
      // This ensures order-independent graph construction
      expect(bulkGraph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b.md')
      expect(incrementalGraph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b.md')  // HEALED!

      expect(bulkGraph.nodes['b.md'].outgoingEdges[0].targetId).toBe('c.md')
      expect(incrementalGraph.nodes['b.md'].outgoingEdges[0].targetId).toBe('c.md')  // HEALED!

      expect(bulkGraph.nodes['c.md'].outgoingEdges).toHaveLength(0)
      expect(incrementalGraph.nodes['c.md'].outgoingEdges).toHaveLength(0)

      await fs.rm(bulkVaultPath, { recursive: true })
      await fs.rm(incrementalVaultPath, { recursive: true })
    })

    it('should produce identical graphs: bulk load vs incremental in REVERSE order', async () => {
      // BULK LOAD (forward order)
      const bulkVaultPath: string = path.join(testVaultPath, 'bulk-reverse')
      await fs.mkdir(bulkVaultPath, { recursive: true })

      await fs.writeFile(path.join(bulkVaultPath, 'a.md'), '# A\n\n- links [[b]]')
      await fs.writeFile(path.join(bulkVaultPath, 'b.md'), '# B')

      const bulkResult2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([bulkVaultPath], bulkVaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(bulkResult2)) throw new Error('Expected Right')
      const bulkGraph: Graph = bulkResult2.right

      // INCREMENTAL (reverse order - b before a)
      const incrementalVaultPath: string = path.join(testVaultPath, 'incremental-reverse')
      await fs.mkdir(incrementalVaultPath, { recursive: true })

      // Add b first, then a
      const files: readonly { readonly name: string; readonly content: string; }[] = [
        { name: 'b.md', content: '# B' },
        { name: 'a.md', content: '# A\n\n- links [[b]]' }
      ]

      const incrementalGraph: Graph = files.reduce((graph, file) => {
        const fsEvent: FSUpdate = {
          absolutePath: path.join(incrementalVaultPath, file.name),
          content: file.content,
          eventType: 'Added'
        }
        const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, incrementalVaultPath, graph)
        return applyGraphDeltaToGraph(graph, delta)
      }, { nodes: {} } as Graph)

      // Verify: IDENTICAL despite different order
      expect(bulkGraph.nodes['a.md'].outgoingEdges).toEqual(incrementalGraph.nodes['a.md'].outgoingEdges)
      expect(bulkGraph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b.md')
      expect(incrementalGraph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b.md')

      await fs.rm(bulkVaultPath, { recursive: true })
      await fs.rm(incrementalVaultPath, { recursive: true })
    })
  })

  describe('Edge Cases: Non-existent Nodes', () => {
    it('bulk load should preserve raw link text when target never exists', async () => {
      const vaultPath: string = path.join(testVaultPath, 'non-existent-bulk')
      await fs.mkdir(vaultPath, { recursive: true })

      await fs.writeFile(
        path.join(vaultPath, 'source.md'),
        '# Source\n\n- broken link [[does-not-exist]]'
      )

      const result5: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([vaultPath], vaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(result5)) throw new Error('Expected Right')
      const graph: Graph = result5.right

      // Verify: Edge preserved with raw link text
      expect(graph.nodes['source.md'].outgoingEdges).toHaveLength(1)
      expect(graph.nodes['source.md'].outgoingEdges[0].targetId).toBe('does-not-exist')

      await fs.rm(vaultPath, { recursive: true })
    })

    it('incremental should preserve raw link text when target never exists', () => {
      const currentGraph: Graph = { nodes: {} }

      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultPath, 'source.md'),
        content: '# Source\n\n- broken [[does-not-exist]]',
        eventType: 'Added'
      }

      const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, testVaultPath, currentGraph)

      // Verify: Edge preserved with raw link text
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.outgoingEdges[0].targetId).toBe('does-not-exist')
      }
    })

    it('should handle multiple unresolved links', async () => {
      const vaultPath: string = path.join(testVaultPath, 'multiple-unresolved')
      await fs.mkdir(vaultPath, { recursive: true })

      await fs.writeFile(
        path.join(vaultPath, 'source.md'),
        '# Source\n\n- link1 [[a]]\n- link2 [[b]]\n- link3 [[c]]'
      )

      const result6: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([vaultPath], vaultPath)
      // eslint-disable-next-line functional/no-throw-statements
      if (E.isLeft(result6)) throw new Error('Expected Right')
      const graph: Graph = result6.right

      // Verify: All edges preserved as raw text
      expect(graph.nodes['source.md'].outgoingEdges).toHaveLength(3)
      expect(graph.nodes['source.md'].outgoingEdges.map((e: { readonly targetId: string }) => e.targetId)).toEqual(['a', 'b', 'c'])

      await fs.rm(vaultPath, { recursive: true })
    })
  })
})
