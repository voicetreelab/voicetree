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
import { createContextNode } from '@/shell/edge/main/graph/createContextNode.ts'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import { setGraph, setVaultPath, getVaultPath } from '@/shell/edge/main/state/graph-store.ts'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths.ts'
import * as O from 'fp-ts/lib/Option.js'
import { promises as fs } from 'fs'
import path from 'path'
import type { NodeId } from '@/pure/graph'

describe('createContextNode - Integration Tests', () => {
  let createdContextNodeId: NodeId | null = null

  beforeEach(async () => {
    // Initialize vault path with example_small fixture
    setVaultPath(EXAMPLE_SMALL_PATH)

    // Load the graph from disk
    const graph = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
    setGraph(graph)
  })

  afterEach(async () => {
    // Clean up created context node file if it exists
    if (createdContextNodeId) {
      const vaultPath = getVaultPath()
      if (O.isSome(vaultPath)) {
        const contextFilePath = path.join(vaultPath.value, createdContextNodeId)
        await fs.unlink(contextFilePath).catch(() => {
          // File might not exist, that's ok
        })
      }
      createdContextNodeId = null
    }
  })

  describe('BEHAVIOR: Create context node for existing parent node', () => {
    it('should create context node file with ASCII tree and node details', async () => {
      // GIVEN: A parent node that exists in example_small graph
      const parentNodeId: NodeId = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node for this parent
      const contextNodeId = await createContextNode(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Context node ID should be in ctx-nodes directory
      expect(contextNodeId).toContain('ctx-nodes/')
      expect(contextNodeId).toContain(parentNodeId)
      expect(contextNodeId).toMatch(/_context_\d+\.md$/)

      // AND: File should exist on disk
      const vaultPath = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        const contextFilePath = path.join(vaultPath.value, contextNodeId)
        const fileExists = await fs.access(contextFilePath)
          .then(() => true)
          .catch(() => false)

        expect(fileExists).toBe(true)

        // AND: File should have proper structure
        const fileContent = await fs.readFile(contextFilePath, 'utf-8')

        // Should have frontmatter with title
        expect(fileContent).toContain('---')
        expect(fileContent).toContain('title: Context for')

        // Should have heading for context graph
        expect(fileContent).toContain('## Relevant context graph for:')

        // Should have ASCII tree visualization in code block
        expect(fileContent).toContain('```')

        // Should have Node Details section
        expect(fileContent).toContain('## Node Details')
      }
    })

    it('should include parent node and related nodes in context', async () => {
      // GIVEN: Parent node with known connections in example_small
      const parentNodeId: NodeId = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node
      const contextNodeId = await createContextNode(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Read the created file
      const vaultPath = getVaultPath()
      if (O.isSome(vaultPath)) {
        const contextFilePath = path.join(vaultPath.value, contextNodeId)
        const fileContent = await fs.readFile(contextFilePath, 'utf-8')

        // Should contain information about the parent node
        expect(fileContent).toContain('VoiceTree')

        // Should have node details wrapped in XML-style tags
        expect(fileContent).toMatch(/<[^>]+>/)
        expect(fileContent).toMatch(/<\/[^>]+>/)
      }
    })

    it('should create context node that can be loaded back into graph', async () => {
      // GIVEN: A parent node
      const parentNodeId: NodeId = '2_VoiceTree_Node_ID_Duplication_Bug.md'

      // WHEN: Create context node
      const contextNodeId = await createContextNode(parentNodeId)
      createdContextNodeId = contextNodeId

      // AND: Reload graph from disk
      const reloadedGraph = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))

      // THEN: The context node should be present in reloaded graph
      expect(reloadedGraph.nodes[contextNodeId]).toBeDefined()

      // AND: Context node should have the parent node as a connection
      const contextNode = reloadedGraph.nodes[contextNodeId]
      expect(contextNode).toBeDefined()
      expect(contextNode.content).toContain('Context for')
    })
  })

  describe('BEHAVIOR: Error handling', () => {
    it('should throw error if parent node does not exist', async () => {
      // GIVEN: A non-existent node ID
      const nonExistentNodeId: NodeId = 'non_existent_node_12345.md'

      // WHEN/THEN: Should throw error
      await expect(createContextNode(nonExistentNodeId))
        .rejects
        .toThrow(`Node ${nonExistentNodeId} not found in graph`)
    })
  })

  describe('BEHAVIOR: Subgraph extraction with distance limit', () => {
    it('should extract subgraph within distance 7 from parent node', async () => {
      // GIVEN: A parent node in the middle of the graph
      const parentNodeId: NodeId = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node
      const contextNodeId = await createContextNode(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Read the context file
      const vaultPath = getVaultPath()
      if (O.isSome(vaultPath)) {
        const contextFilePath = path.join(vaultPath.value, contextNodeId)
        const fileContent = await fs.readFile(contextFilePath, 'utf-8')

        // Should contain ASCII visualization (which implies subgraph was extracted)
        const codeBlockMatch = fileContent.match(/```\n([\s\S]+?)\n```/)
        expect(codeBlockMatch).toBeTruthy()

        if (codeBlockMatch) {
          const asciiTree = codeBlockMatch[1]
          // ASCII tree should have some structure (nodes and connections)
          expect(asciiTree.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('BEHAVIOR: Node details order should match ASCII tree order', () => {
    it('should list node details in the same order they appear in ASCII tree', async () => {
      // GIVEN: A parent node that exists in example_small graph
      const parentNodeId: NodeId = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

      // WHEN: Create context node for this parent
      const contextNodeId = await createContextNode(parentNodeId)
      createdContextNodeId = contextNodeId

      // THEN: Read the context file
      const vaultPath = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        const contextFilePath = path.join(vaultPath.value, contextNodeId)
        const fileContent = await fs.readFile(contextFilePath, 'utf-8')

        // Extract ASCII tree from content (between first pair of ```)
        const asciiTreeMatch = fileContent.match(/```\n([\s\S]+?)\n```/)
        expect(asciiTreeMatch).toBeTruthy()

        // Extract Node Details section (after ## Node Details)
        const nodeDetailsMatch = fileContent.match(/## Node Details\n([\s\S]+)$/)
        expect(nodeDetailsMatch).toBeTruthy()

        if (asciiTreeMatch && nodeDetailsMatch) {
          const asciiTree = asciiTreeMatch[1]
          const nodeDetailsSection = nodeDetailsMatch[1]

          // Extract node titles from ASCII tree in the order they appear
          // ASCII tree has format like:
          // Node1
          // ├── Node2
          // └── Node3
          const asciiNodeTitles = asciiTree
            .split('\n')
            .map(line => line.replace(/^[│├└─\s]+/, '').trim())
            .filter(title => title.length > 0)

          // Extract node IDs from Node Details section in the order they appear
          // Node details has format: <node_id.md> \n content \n </node_id.md>
          // Match only opening tags (node IDs end with .md and don't start with /)
          // The negative lookahead (?!\/) ensures we don't match paths starting with /
          const nodeDetailIds = Array.from(
            nodeDetailsSection.matchAll(/<([^/>][^>]*\.md)>\s*\n/g)
          ).map(match => match[1].trim())

          // For each node detail ID, find its corresponding title in the graph
          const graph = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
          const nodeDetailTitles = nodeDetailIds.map((nodeId: string) => {
            const node = graph.nodes[nodeId]
            return node?.nodeUIMetadata.title || nodeId
          })

          console.log('\n' + '='.repeat(80))
          console.log('NODE ORDER COMPARISON')
          console.log('='.repeat(80))
          console.log('\nASCII Tree Order:')
          asciiNodeTitles.forEach((title: string, i: number) => console.log(`  ${i + 1}. ${title}`))
          console.log('\nNode Details Order:')
          nodeDetailTitles.forEach((title: string, i: number) => console.log(`  ${i + 1}. ${title}`))
          console.log('='.repeat(80) + '\n')

          // VERIFY: Node details should appear in the same order as ASCII tree
          expect(nodeDetailTitles).toEqual(asciiNodeTitles)
        }
      }
    })
  })
})
