/**
 * Integration test for createContextNode
 *
 * BEHAVIOR TESTED:
 * - INPUT: A parent node ID from a loaded graph
 * - OUTPUT: A new context node file created on disk with:
 *   - ASCII tree visualization of subgraph
 *   - Node details from subgraph
 *   - Proper frontmatter
 * - SIDE EFFECTS: New markdown file written to disk in ctx-nodes directory
 *
 * This e2e-tests the integration of:
 * - Loading graph from disk (example_small fixture)
 * - Extracting subgraph within distance 7 using weighted BFS
 * - Converting subgraph to ASCII visualization
 * - Creating context node via GraphDelta pipeline
 * - Writing context node to filesystem
 * - Reading back the file to verify structure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createContextNode } from '@/shell/edge/main/graph/context-nodes/createContextNode'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'

import { setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath, getVaultPath } from '@/shell/edge/main/graph/watchFolder'
import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { promises as fs } from 'fs'
import path from 'path'
import type { NodeIdAndFilePath, Edge, GraphNode, Graph } from '@/pure/graph'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

describe('createContextNode - Integration Tests', () => {
  let createdContextNodeId: NodeIdAndFilePath | null = null
  let parentNodeBackups: Map<NodeIdAndFilePath, string> = new Map()

  beforeEach(async () => {
    // Initialize vault path with example_small fixture
    setVaultPath(EXAMPLE_SMALL_PATH)

    // Load the graph from disk
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH), O.some(EXAMPLE_SMALL_PATH))
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right
    setGraph(graph)

    // Clear parent node backups
    parentNodeBackups = new Map()
  })

  afterEach(async () => {
    // Wait for any pending timeouts from applyGraphDeltaToUI
    await new Promise(resolve => setTimeout(resolve, 200))

    const vaultPath: O.Option<string> = getVaultPath()

    // Clean up created context node file if it exists
    if (createdContextNodeId && O.isSome(vaultPath)) {
      const contextFilePath: string = path.join(vaultPath.value, createdContextNodeId)
      await fs.unlink(contextFilePath).catch(() => {
        // File might not exist, that's ok
      })
      createdContextNodeId = null
    }

    // Restore parent node files to their original state
    if (O.isSome(vaultPath)) {
      for (const [parentNodeId, originalContent] of parentNodeBackups.entries()) {
        const parentFilePath: string = path.join(vaultPath.value, parentNodeId)
        await fs.writeFile(parentFilePath, originalContent, 'utf-8').catch(() => {
          // File might not exist, that's ok
        })
      }
    }
    parentNodeBackups.clear()
  })

  /**
   * Helper function to create a context node while backing up the parent node
   */
  async function createContextNodeWithBackup(parentNodeId: NodeIdAndFilePath): Promise<NodeIdAndFilePath> {
    const vaultPath: O.Option<string> = getVaultPath()

    // Backup parent node before creating context node
    if (O.isSome(vaultPath)) {
      const parentFilePath: string = path.join(vaultPath.value, parentNodeId)
      const originalContent: string = await fs.readFile(parentFilePath, 'utf-8')
      parentNodeBackups.set(parentNodeId, originalContent)
    }

    // Create context node
    return await createContextNode(parentNodeId)
  }

  describe('BEHAVIOR: Create context node for existing parent node', () => {
    it('should create context node file with ASCII tree and node details', async () => {
      // GIVEN: A parent node that exists in example_small graph
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node for this parent
      const contextNodeId: string = await createContextNodeWithBackup(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Context node ID should be in ctx-nodes directory
      expect(contextNodeId).toContain('ctx-nodes/')
      // Context node filename contains the parent node ID without the .md extension
      const parentNodeIdWithoutExtension: string = parentNodeId.replace('.md', '')
      expect(contextNodeId).toContain(parentNodeIdWithoutExtension)
      expect(contextNodeId).toMatch(/_context_\d+\.md$/)

      // AND: File should exist on disk
      const vaultPath: O.Option<string> = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        const contextFilePath: string = path.join(vaultPath.value, contextNodeId)
        const fileExists: boolean = await fs.access(contextFilePath)
          .then(() => true)
          .catch(() => false)

        expect(fileExists).toBe(true)

        // AND: File should have proper structure
        const fileContent: string = await fs.readFile(contextFilePath, 'utf-8')
        // todo these tests arre way too specific, just make it expect a 'context' not anything else.
        // Should have frontmatter with title
        expect(fileContent).toContain('---')
        expect(fileContent).toContain('Context')

        // Should have heading for context graph
        expect(fileContent).toContain('## Context')

        // Should have ASCII tree visualization in code block
        expect(fileContent).toContain('```')

        // Should have Node Details section
        expect(fileContent).toContain('## Node Details')
      }
    })

    it('should include parent node and related nodes in context', async () => {
      // GIVEN: Parent node with known connections in example_small
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node
      const contextNodeId: string = await createContextNodeWithBackup(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Read the created file
      const vaultPath: O.Option<string> = getVaultPath()
      if (O.isSome(vaultPath)) {
        const contextFilePath: string = path.join(vaultPath.value, contextNodeId)
        const fileContent: string = await fs.readFile(contextFilePath, 'utf-8')

        // Should contain information about the parent node
        expect(fileContent).toContain('VoiceTree')

        // Should have node details wrapped in XML-style tags
        expect(fileContent).toMatch(/<[^>]+>/)
        expect(fileContent).toMatch(/<\/[^>]+>/)
      }
    })

    it('should create context node that can be loaded back into graph', async () => {
      // GIVEN: A parent node
      const parentNodeId: NodeIdAndFilePath = '2_VoiceTree_Node_ID_Duplication_Bug.md'

      // WHEN: Create context node
      const contextNodeId: string = await createContextNodeWithBackup(parentNodeId)
      createdContextNodeId = contextNodeId

      // AND: Reload graph from disk
      const reloadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH), O.some(EXAMPLE_SMALL_PATH))
      if (E.isLeft(reloadResult)) throw new Error('Expected Right')
      const reloadedGraph: Graph = reloadResult.right

      // THEN: The context node should be present in reloaded graph
      expect(reloadedGraph.nodes[contextNodeId]).toBeDefined()

      // AND: Context node should have the parent node as a connection
      const contextNode: GraphNode = reloadedGraph.nodes[contextNodeId]
      expect(contextNode).toBeDefined()
      expect(contextNode.contentWithoutYamlOrLinks).toContain('Context')
    })
  })

  describe('BEHAVIOR: Error handling', () => {
    it('should throw error if parent node does not exist', async () => {
      // GIVEN: A non-existent node ID
      const nonExistentNodeId: NodeIdAndFilePath = 'non_existent_node_12345.md'

      // WHEN/THEN: Should throw error
      await expect(createContextNode(nonExistentNodeId))
        .rejects
        .toThrow(`Node ${nonExistentNodeId} not found in graph`)
    })
  })

  describe('BEHAVIOR: Subgraph extraction with distance limit', () => {
    it('should extract subgraph within distance 7 from parent node', async () => {
      // GIVEN: A parent node in the middle of the graph
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node
      const contextNodeId: string = await createContextNodeWithBackup(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Read the context file
      const vaultPath: O.Option<string> = getVaultPath()
      if (O.isSome(vaultPath)) {
        const contextFilePath: string = path.join(vaultPath.value, contextNodeId)
        const fileContent: string = await fs.readFile(contextFilePath, 'utf-8')

        // Should contain ASCII visualization (which implies subgraph was extracted)
        const codeBlockMatch: RegExpMatchArray | null = fileContent.match(/```\n([\s\S]+?)\n```/)
        expect(codeBlockMatch).toBeTruthy()

        if (codeBlockMatch) {
          const asciiTree: string = codeBlockMatch[1]
          // ASCII tree should have some structure (nodes and connections)
          expect(asciiTree.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('BEHAVIOR: Node details section should contain all nodes from subgraph', () => {
    it('should include parent node and connected nodes in details section', async () => {
      // GIVEN: A parent node that exists in example_small graph
      const parentNodeId: NodeIdAndFilePath = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node for this parent
      const contextNodeId: string = await createContextNodeWithBackup(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Read the context file
      const vaultPath: O.Option<string> = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        const contextFilePath: string = path.join(vaultPath.value, contextNodeId)
        const fileContent: string = await fs.readFile(contextFilePath, 'utf-8')

        // Extract Node Details section (after ## Node Details)
        const nodeDetailsMatch: RegExpMatchArray | null = fileContent.match(/## Node Details\n([\s\S]+)$/)
        expect(nodeDetailsMatch).toBeTruthy()

        if (nodeDetailsMatch) {
          const nodeDetailsSection: string = nodeDetailsMatch[1]

          // Extract node IDs from Node Details section
          // Node details has format: <node_id.md> \n content \n </node_id.md>
          const nodeDetailIds: string[] = Array.from(
            nodeDetailsSection.matchAll(/<([^/>][^>]*\.md)>\s*\n/g)
          ).map(match => match[1].trim())

          // VERIFY: Parent node should be present in details
          expect(nodeDetailIds).toContain(parentNodeId)

          // VERIFY: Should have multiple nodes (parent + connected nodes)
          expect(nodeDetailIds.length).toBeGreaterThan(1)

          // VERIFY: All node IDs should be valid (end with .md)
          nodeDetailIds.forEach((nodeId: string) => {
            expect(nodeId).toMatch(/\.md$/)
          })
        }
      }
    })
  })

  describe('BEHAVIOR: Context node should have exactly ONE edge (BUG REGRESSION TEST)', () => {
    it('should create context node with only one edge to parent, not one edge per subgraph node', async () => {
      // GIVEN: example_real_large fixture with at least 5 nodes
      setVaultPath(EXAMPLE_LARGE_PATH)
      const largeLoadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(EXAMPLE_LARGE_PATH), O.some(EXAMPLE_LARGE_PATH))
      if (E.isLeft(largeLoadResult)) throw new Error('Expected Right')
      const largeGraph: Graph = largeLoadResult.right
      setGraph(largeGraph)

      // VERIFY: Graph has at least 5 nodes
      const nodeCount: number = Object.keys(largeGraph.nodes).length
      expect(nodeCount).toBeGreaterThanOrEqual(5)

      // Find a parent node that's part of a sufficiently large subgraph (at least 5 nodes)
      // We'll use the first node as it should have connections
      const parentNodeId: string = Object.keys(largeGraph.nodes)[0] as NodeIdAndFilePath

      // Count nodes in parent's subgraph before creating context node
      const parentNode: GraphNode = largeGraph.nodes[parentNodeId]
      const subgraphNodeCount: number = parentNode.outgoingEdges.length + 1 // parent + its children

      // WHEN: Create context node for this parent
      const contextNodeId: string = await createContextNodeWithBackup(parentNodeId)
      createdContextNodeId = contextNodeId

      // Read the context node file content to verify structure
      const vaultPath: O.Option<string> = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        const contextFilePath: string = path.join(vaultPath.value, contextNodeId)
        const contextFileContent: string = await fs.readFile(contextFilePath, 'utf-8')

        // Count wikilinks in the context node content
        const wikilinkMatches: RegExpMatchArray | null = contextFileContent.match(/\[\[([^\]]+)\]\]/g)
        const wikilinkCount: number = wikilinkMatches ? wikilinkMatches.length : 0

        // Also check for [link]* format (should have these instead of [[link]])
        const strippedLinkMatches: RegExpMatchArray | null = contextFileContent.match(/\[([^\]]+)\]\*/g)
        const strippedLinkCount: number = strippedLinkMatches ? strippedLinkMatches.length : 0

        console.log('\n' + '='.repeat(80))
        console.log('CONTEXT NODE FILE CONTENT ANALYSIS')
        console.log('='.repeat(80))
        console.log(`Context file: ${contextNodeId}`)
        console.log(`Subgraph node count: ${subgraphNodeCount}`)
        console.log(`Wikilinks [[link]] found: ${wikilinkCount}`)
        console.log(`Stripped links [link]* found: ${strippedLinkCount}`)
        if (wikilinkMatches) {
          console.log('Wikilinks:')
          wikilinkMatches.forEach((link, i) => console.log(`  ${i + 1}. ${link}`))
        }
        if (strippedLinkMatches) {
          console.log('Stripped links:')
          strippedLinkMatches.forEach((link, i) => console.log(`  ${i + 1}. ${link}`))
        }
        console.log('\nFirst 500 chars of Node Details section:')
        const nodeDetailsMatch: RegExpMatchArray | null = contextFileContent.match(/## Node Details\n([\s\S]{0,500})/)
        if (nodeDetailsMatch) {
          console.log(nodeDetailsMatch[1])
        }
        console.log('='.repeat(80) + '\n')

        // Write full content to temp file for inspection
        await fs.writeFile('/tmp/context-node-test-output.md', contextFileContent, 'utf-8')

        // Context node should NOT have any wikilinks (no edges from context node to other nodes)
        // The parent->context edge is created programmatically, not via wikilink
        expect(wikilinkCount).toBe(0)
      }

      // THEN: Reload graph to get the context node
      const largeReloadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(EXAMPLE_LARGE_PATH), O.some(EXAMPLE_LARGE_PATH))
      if (E.isLeft(largeReloadResult)) throw new Error('Expected Right')
      const reloadedGraph: Graph = largeReloadResult.right

      // VERIFY: Context node exists in reloaded graph
      expect(reloadedGraph.nodes[contextNodeId]).toBeDefined()

      // VERIFY: Parent node should have exactly ONE outgoing edge to the context node
      const reloadedParentNode: GraphNode = reloadedGraph.nodes[parentNodeId]
      expect(reloadedParentNode).toBeDefined()

      const edgesToContextNode: Edge[] = reloadedParentNode.outgoingEdges.filter(
        (edge: Edge) => edge.targetId === contextNodeId
      )

      console.log('\n' + '='.repeat(80))
      console.log('CONTEXT NODE EDGE COUNT VERIFICATION')
      console.log('='.repeat(80))
      console.log(`Parent Node: ${parentNodeId}`)
      console.log(`Context Node: ${contextNodeId}`)
      console.log(`Total outgoing edges from parent: ${reloadedParentNode.outgoingEdges.length}`)
      console.log(`Edges to context node: ${edgesToContextNode.length}`)
      console.log(`\nAll outgoing edges from parent:`)
      reloadedParentNode.outgoingEdges.forEach((edge: Edge, i: number) => {
        console.log(`  ${i + 1}. -> ${edge.targetId}${edge.targetId === contextNodeId ? ' (CONTEXT NODE)' : ''}`)
      })
      console.log('='.repeat(80) + '\n')

      // BUG ASSERTION: Should have exactly ONE edge, not one per subgraph node
      expect(edgesToContextNode.length).toBe(1)

      // ALSO VERIFY: Context node should have exactly ONE incoming edge (from parent)
      const incomingEdgesCount: number = (Object.values(reloadedGraph.nodes) as GraphNode[]).filter((node: GraphNode) =>
        node.outgoingEdges.some((edge: Edge) => edge.targetId === contextNodeId)
      ).length

      console.log(`Incoming edges to context node: ${incomingEdgesCount}`)
      expect(incomingEdgesCount).toBe(1)

      // ALSO VERIFY: Context node itself should have ZERO outgoing edges
      // It should not link back to any of the nodes in its subgraph
      const contextNodeInReloaded: GraphNode = reloadedGraph.nodes[contextNodeId]
      expect(contextNodeInReloaded.outgoingEdges.length).toBe(0)
    })
  })
})
