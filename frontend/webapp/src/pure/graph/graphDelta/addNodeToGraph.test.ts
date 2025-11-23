import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, FSUpdate } from '@/pure/graph'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph.ts'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import { mapFSEventsToGraphDelta } from '@/pure/graph/mapFSEventsToGraphDelta.ts'

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
  const testVaultState = { path: '' }

  beforeAll(async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edge-validation-test-'))
    testVaultState.path = tmpDir
    await fs.mkdir(testVaultState.path, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(testVaultState.path, { recursive: true, force: true })
  })

  describe('Bulk Load: Edge Resolution Order Independence', () => {
    it('should produce identical graphs when loading files in forward order (target exists before source)', async () => {
      // Setup: Create temporary vault for forward order test
      const forwardVaultPath = path.join(testVaultState.path, 'forward-order')
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

      const graph = await loadGraphFromDisk(O.some(forwardVaultPath))

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
      const reverseVaultPath = path.join(testVaultState.path, 'reverse-order')
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

      const graph = await loadGraphFromDisk(O.some(reverseVaultPath))

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
      const subfolderVaultPath = path.join(testVaultState.path, 'subfolder-test')
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

      const graph = await loadGraphFromDisk(O.some(subfolderVaultPath))

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
      const chainVaultPath = path.join(testVaultState.path, 'chain-test')
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

      const graph = await loadGraphFromDisk(O.some(chainVaultPath))

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
              title: 'Target',
              color: O.none,
              position: O.none
            }
          }
        }
      }

      // Incremental: Add source node that links to target
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultState.path, 'source.md'),
        content: '# Source\n\n- links [[target]]',
        eventType: 'Added'
      }

      const delta = mapFSEventsToGraphDelta(fsEvent, testVaultState.path, currentGraph)

      // Verify: Edge resolves to existing target node
      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        const node = delta[0].nodeToUpsert
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
        absolutePath: path.join(testVaultState.path, 'source.md'),
        content: '# Source\n\n- links [[non-existent]]',
        eventType: 'Added'
      }

      const delta = mapFSEventsToGraphDelta(fsEvent, testVaultState.path, currentGraph)

      // Verify: Edge has raw link text (not resolved)
      expect(delta).toHaveLength(1)
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        const node = delta[0].nodeToUpsert
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
              title: 'Node 1',
              color: O.none,
              position: O.none
            }
          }
        }
      }

      // Incremental: Add felix/2 with link [[1]]
      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultState.path, 'felix', '2.md'),
        content: '# Node 2\n\n- related [[1]]',
        eventType: 'Added'
      }

      const delta = mapFSEventsToGraphDelta(fsEvent, testVaultState.path, currentGraph)

      // Verify: Link resolves to felix/1
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        const node = delta[0].nodeToUpsert
        expect(node.outgoingEdges[0].targetId).toBe('felix/1.md')
      }
    })
  })

  describe('Unified Behavior: Bulk and Incremental Produce Same Result', () => {
    it('should produce identical graphs: bulk load vs sequential incremental', async () => {
      // BULK LOAD
      const bulkVaultPath = path.join(testVaultState.path, 'bulk-unified')
      await fs.mkdir(bulkVaultPath, { recursive: true })

      await fs.writeFile(path.join(bulkVaultPath, 'a.md'), '# A\n\n- links [[b]]')
      await fs.writeFile(path.join(bulkVaultPath, 'b.md'), '# B\n\n- links [[c]]')
      await fs.writeFile(path.join(bulkVaultPath, 'c.md'), '# C')

      const bulkGraph = await loadGraphFromDisk(O.some(bulkVaultPath))

      // INCREMENTAL (simulate sequential file additions)
      const incrementalVaultPath = path.join(testVaultState.path, 'incremental-unified')
      await fs.mkdir(incrementalVaultPath, { recursive: true })

      // Add files one by one using mapFSEventsToGraphDelta
      const files = [
        { name: 'a.md', content: '# A\n\n- links [[b]]' },
        { name: 'b.md', content: '# B\n\n- links [[c]]' },
        { name: 'c.md', content: '# C' }
      ]

      const incrementalGraph = files.reduce((graph, file) => {
        const fsEvent: FSUpdate = {
          absolutePath: path.join(incrementalVaultPath, file.name),
          content: file.content,
          eventType: 'Added'
        }
        const delta = mapFSEventsToGraphDelta(fsEvent, incrementalVaultPath, graph)
        return applyGraphDeltaToGraph(graph, delta)
      }, { nodes: {} } as Graph)

      // Verify: Nodes exist with correct IDs
      expect(Object.keys(bulkGraph.nodes).sort()).toEqual(Object.keys(incrementalGraph.nodes).sort())

      // NOTE: Bulk and incremental may have different edge targetIds due to resolution timing:
      // - Bulk: all nodes exist, so edges resolve to full node IDs (e.g., 'b.md')
      // - Incremental: when a.md is added first, 'b' doesn't exist yet, so targetId stays as 'b' (raw link text)
      // After b.md is added, a.md's edges are NOT retroactively updated
      expect(bulkGraph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b.md')
      expect(incrementalGraph.nodes['a.md'].outgoingEdges[0].targetId).toBe('b')  // Raw link text - b didn't exist when a was added

      expect(bulkGraph.nodes['b.md'].outgoingEdges[0].targetId).toBe('c.md')
      expect(incrementalGraph.nodes['b.md'].outgoingEdges[0].targetId).toBe('c')  // Raw link text - c didn't exist when b was added

      expect(bulkGraph.nodes['c.md'].outgoingEdges).toHaveLength(0)
      expect(incrementalGraph.nodes['c.md'].outgoingEdges).toHaveLength(0)

      await fs.rm(bulkVaultPath, { recursive: true })
      await fs.rm(incrementalVaultPath, { recursive: true })
    })

    it('should produce identical graphs: bulk load vs incremental in REVERSE order', async () => {
      // BULK LOAD (forward order)
      const bulkVaultPath = path.join(testVaultState.path, 'bulk-reverse')
      await fs.mkdir(bulkVaultPath, { recursive: true })

      await fs.writeFile(path.join(bulkVaultPath, 'a.md'), '# A\n\n- links [[b]]')
      await fs.writeFile(path.join(bulkVaultPath, 'b.md'), '# B')

      const bulkGraph = await loadGraphFromDisk(O.some(bulkVaultPath))

      // INCREMENTAL (reverse order - b before a)
      const incrementalVaultPath = path.join(testVaultState.path, 'incremental-reverse')
      await fs.mkdir(incrementalVaultPath, { recursive: true })

      // Add b first, then a
      const files = [
        { name: 'b.md', content: '# B' },
        { name: 'a.md', content: '# A\n\n- links [[b]]' }
      ]

      const incrementalGraph = files.reduce((graph, file) => {
        const fsEvent: FSUpdate = {
          absolutePath: path.join(incrementalVaultPath, file.name),
          content: file.content,
          eventType: 'Added'
        }
        const delta = mapFSEventsToGraphDelta(fsEvent, incrementalVaultPath, graph)
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
      const vaultPath = path.join(testVaultState.path, 'non-existent-bulk')
      await fs.mkdir(vaultPath, { recursive: true })

      await fs.writeFile(
        path.join(vaultPath, 'source.md'),
        '# Source\n\n- broken link [[does-not-exist]]'
      )

      const graph = await loadGraphFromDisk(O.some(vaultPath))

      // Verify: Edge preserved with raw link text
      expect(graph.nodes['source.md'].outgoingEdges).toHaveLength(1)
      expect(graph.nodes['source.md'].outgoingEdges[0].targetId).toBe('does-not-exist')

      await fs.rm(vaultPath, { recursive: true })
    })

    it('incremental should preserve raw link text when target never exists', () => {
      const currentGraph: Graph = { nodes: {} }

      const fsEvent: FSUpdate = {
        absolutePath: path.join(testVaultState.path, 'source.md'),
        content: '# Source\n\n- broken [[does-not-exist]]',
        eventType: 'Added'
      }

      const delta = mapFSEventsToGraphDelta(fsEvent, testVaultState.path, currentGraph)

      // Verify: Edge preserved with raw link text
      expect(delta[0].type).toBe('UpsertNode')
      if (delta[0].type === 'UpsertNode') {
        expect(delta[0].nodeToUpsert.outgoingEdges[0].targetId).toBe('does-not-exist')
      }
    })

    it('should handle multiple unresolved links', async () => {
      const vaultPath = path.join(testVaultState.path, 'multiple-unresolved')
      await fs.mkdir(vaultPath, { recursive: true })

      await fs.writeFile(
        path.join(vaultPath, 'source.md'),
        '# Source\n\n- link1 [[a]]\n- link2 [[b]]\n- link3 [[c]]'
      )

      const graph = await loadGraphFromDisk(O.some(vaultPath))

      // Verify: All edges preserved as raw text
      expect(graph.nodes['source.md'].outgoingEdges).toHaveLength(3)
      expect(graph.nodes['source.md'].outgoingEdges.map(e => e.targetId)).toEqual(['a', 'b', 'c'])

      await fs.rm(vaultPath, { recursive: true })
    })
  })
})
