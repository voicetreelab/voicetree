/**
 * Integration test for Graph Action → Filesystem persistence
 *
 * BEHAVIOR TESTED:
 * - INPUT: Graph actions (createNode, updateNode, deleteNode)
 * - OUTPUT: Files written to disk, graph state updated
 * - SIDE EFFECTS: Filesystem writes
 *
 * This tests the integration between the pure functional core and filesystem IO.
 * We test the BEHAVIOR, not the IPC mechanism itself.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import { apply_graph_updates } from '@/functional_graph/pure/applyGraphActionsToDB'
import type { Graph, CreateNode, UpdateNode, DeleteNode, Env } from '@/functional_graph/pure/types'

describe('Graph Actions → Filesystem - Behavioral Integration', () => {
  let tempVault: string
  let env: Env

  beforeEach(async () => {
    // Create temporary vault
    tempVault = path.join('/tmp', `test-vault-${Date.now()}`)
    await fs.mkdir(tempVault, { recursive: true })

    // Create environment for executing effects
    env = {
      vaultPath: tempVault,
      broadcast: () => {} // No-op for integration tests
    }
  })

  afterEach(async () => {
    // Cleanup temp vault
    await fs.rm(tempVault, { recursive: true, force: true })
  })

  describe('BEHAVIOR: createNode action → file on disk', () => {
    it('should create a markdown file when createNode is executed', async () => {
      // GIVEN: An empty graph and a createNode action
      const initialGraph: Graph = { nodes: {}, edges: {} }
      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId: 'test_node',
        content: '# Test Node\n\nThis is a test node.',
        position: O.none
      }

      // WHEN: Action is applied and effect is executed
      const effect = apply_graph_updates(initialGraph, createAction)
      const result = await effect(env)()

      // THEN: Effect should succeed
      expect(result._tag).toBe('Right')
      if (result._tag !== 'Right') throw new Error('Effect failed')

      // AND: File should exist on disk
      const filePath = path.join(tempVault, 'test_node.md')
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(true)

      // AND: File should have correct content
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('# Test Node')
      expect(content).toContain('This is a test node.')

      // AND: Returned graph should have the new node
      const newGraph = result.right
      expect(newGraph.nodes['test_node']).toBeDefined()
      expect(newGraph.nodes['test_node'].title).toBe('Test Node')
    })

    it('should create file with content that has no title', async () => {
      // GIVEN: An empty graph
      const initialGraph: Graph = { nodes: {}, edges: {} }
      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId: 'no_title',
        content: 'Just some content without a markdown heading',
        position: O.none
      }

      // WHEN: Action is applied
      const effect = apply_graph_updates(initialGraph, createAction)
      const result = await effect(env)()

      // THEN: File should be created
      expect(result._tag).toBe('Right')
      if (result._tag !== 'Right') throw new Error('Effect failed')

      const filePath = path.join(tempVault, 'no_title.md')
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('Just some content without a markdown heading')

      // AND: Node should have default title "Untitled"
      const newGraph = result.right
      expect(newGraph.nodes['no_title'].title).toBe('Untitled')
    })

    it('should create multiple nodes independently', async () => {
      // GIVEN: An empty graph
      const initialGraph: Graph = { nodes: {}, edges: {} }

      // WHEN: Creating first node
      const node1Action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node1',
        content: '# Node 1\n\nFirst node.',
        position: O.none
      }
      const effect1 = apply_graph_updates(initialGraph, node1Action)
      const result1 = await effect1(env)()
      expect(result1._tag).toBe('Right')
      if (result1._tag !== 'Right') throw new Error('Node1 creation failed')

      // WHEN: Creating second node
      const node2Action: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node2',
        content: '# Node 2\n\nSecond node.',
        position: O.none
      }
      const effect2 = apply_graph_updates(result1.right, node2Action)
      const result2 = await effect2(env)()
      expect(result2._tag).toBe('Right')
      if (result2._tag !== 'Right') throw new Error('Node2 creation failed')

      // THEN: Both files should exist
      const path1 = path.join(tempVault, 'node1.md')
      const path2 = path.join(tempVault, 'node2.md')
      expect(await fs.access(path1).then(() => true).catch(() => false)).toBe(true)
      expect(await fs.access(path2).then(() => true).catch(() => false)).toBe(true)

      // AND: Graph should have both nodes
      const finalGraph = result2.right
      expect(finalGraph.nodes['node1']).toBeDefined()
      expect(finalGraph.nodes['node2']).toBeDefined()
    })
  })

  describe('BEHAVIOR: updateNode action → file content updated', () => {
    it('should update file content when updateNode is executed', async () => {
      // GIVEN: A node exists in graph and on disk
      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId: 'update_test',
        content: '# Original Title\n\nOriginal content.',
        position: O.none
      }
      const createEffect = apply_graph_updates({ nodes: {}, edges: {} }, createAction)
      const createResult = await createEffect(env)()
      expect(createResult._tag).toBe('Right')
      if (createResult._tag !== 'Right') throw new Error('Create failed')
      const graphWithNode = createResult.right

      // WHEN: Updating the node
      const updateAction: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'update_test',
        content: '# Updated Title\n\nNew content added'
      }
      const updateEffect = apply_graph_updates(graphWithNode, updateAction)
      const updateResult = await updateEffect(env)()
      expect(updateResult._tag).toBe('Right')
      if (updateResult._tag !== 'Right') throw new Error('Update failed')

      // THEN: File should have updated content
      const filePath = path.join(tempVault, 'update_test.md')
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('Updated Title')
      expect(content).toContain('New content added')

      // AND: Returned graph should reflect updates
      const updatedGraph = updateResult.right
      expect(updatedGraph.nodes['update_test'].title).toBe('Updated Title')
      expect(updatedGraph.nodes['update_test'].content).toContain('New content added')
    })

    it('should completely replace file content on update', async () => {
      // GIVEN: A node with multi-line content
      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId: 'replace_test',
        content: '# Original\n\nLine 1\nLine 2\nLine 3',
        position: O.none
      }
      const createEffect = apply_graph_updates({ nodes: {}, edges: {} }, createAction)
      const createResult = await createEffect(env)()
      expect(createResult._tag).toBe('Right')
      if (createResult._tag !== 'Right') throw new Error('Create failed')

      // WHEN: Updating with completely new content
      const updateAction: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'replace_test',
        content: '# New Title\n\nCompletely different content'
      }
      const updateEffect = apply_graph_updates(createResult.right, updateAction)
      const updateResult = await updateEffect(env)()
      expect(updateResult._tag).toBe('Right')
      if (updateResult._tag !== 'Right') throw new Error('Update failed')

      // THEN: File should have completely new content (old content gone)
      const filePath = path.join(tempVault, 'replace_test.md')
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe('# New Title\n\nCompletely different content')
      expect(content).not.toContain('Line 1')
      expect(content).not.toContain('Original')
    })
  })

  describe('BEHAVIOR: deleteNode action → file removed from disk', () => {
    it('should delete file when deleteNode is executed', async () => {
      // GIVEN: A node exists in graph and on disk
      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId: 'delete_test',
        content: '# To Be Deleted\n\nThis will be deleted.',
        position: O.none
      }
      const createEffect = apply_graph_updates({ nodes: {}, edges: {} }, createAction)
      const createResult = await createEffect(env)()
      expect(createResult._tag).toBe('Right')
      if (createResult._tag !== 'Right') throw new Error('Create failed')
      const graphWithNode = createResult.right

      const filePath = path.join(tempVault, 'delete_test.md')
      let fileExists = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(true)

      // WHEN: Deleting the node
      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'delete_test'
      }
      const deleteEffect = apply_graph_updates(graphWithNode, deleteAction)
      const deleteResult = await deleteEffect(env)()
      expect(deleteResult._tag).toBe('Right')
      if (deleteResult._tag !== 'Right') throw new Error('Delete failed')

      // THEN: File should be removed from disk
      fileExists = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(false)

      // AND: Node should be removed from returned graph
      const finalGraph = deleteResult.right
      expect(finalGraph.nodes['delete_test']).toBeUndefined()
    })

    it('should remove edges when deleting a node', async () => {
      // GIVEN: A graph with two nodes and an edge
      const createNode1: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node_a',
        content: '# Node A',
        position: O.none
      }
      const createNode2: CreateNode = {
        type: 'CreateNode',
        nodeId: 'node_b',
        content: '# Node B',
        position: O.none
      }

      const effect1 = apply_graph_updates({ nodes: {}, edges: {} }, createNode1)
      const result1 = await effect1(env)()
      expect(result1._tag).toBe('Right')
      if (result1._tag !== 'Right') throw new Error('Node1 creation failed')

      const effect2 = apply_graph_updates(result1.right, createNode2)
      const result2 = await effect2(env)()
      expect(result2._tag).toBe('Right')
      if (result2._tag !== 'Right') throw new Error('Node2 creation failed')

      // Manually add edge for this test (since edge creation isn't implemented yet)
      const graphWithEdge: Graph = {
        ...result2.right,
        edges: { node_a: ['node_b'] }
      }

      // WHEN: Deleting node_b
      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: 'node_b'
      }
      const deleteEffect = apply_graph_updates(graphWithEdge, deleteAction)
      const deleteResult = await deleteEffect(env)()
      expect(deleteResult._tag).toBe('Right')
      if (deleteResult._tag !== 'Right') throw new Error('Delete failed')

      // THEN: Edge should be removed
      const finalGraph = deleteResult.right
      expect(finalGraph.edges['node_a']).toEqual([])
      expect(finalGraph.nodes['node_b']).toBeUndefined()
    })
  })

  describe('BEHAVIOR: Complete workflow - Create → Update → Delete', () => {
    it('should handle full lifecycle of a node with filesystem persistence', async () => {
      const nodeId = 'lifecycle_test'
      const filePath = path.join(tempVault, `${nodeId}.md`)
      let graph: Graph = { nodes: {}, edges: {} }

      // STEP 1: CREATE
      const createAction: CreateNode = {
        type: 'CreateNode',
        nodeId,
        content: '# Initial Version\n\nFirst content.',
        position: O.none
      }
      const createEffect = apply_graph_updates(graph, createAction)
      const createResult = await createEffect(env)()
      expect(createResult._tag).toBe('Right')
      if (createResult._tag !== 'Right') throw new Error('Create failed')
      graph = createResult.right

      // Verify: File exists with correct content
      let content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('Initial Version')
      expect(graph.nodes[nodeId]).toBeDefined()

      // STEP 2: UPDATE (multiple times)
      const updateAction1: UpdateNode = {
        type: 'UpdateNode',
        nodeId,
        content: '# Second Version\n\nUpdated content.'
      }
      const updateEffect1 = apply_graph_updates(graph, updateAction1)
      const updateResult1 = await updateEffect1(env)()
      expect(updateResult1._tag).toBe('Right')
      if (updateResult1._tag !== 'Right') throw new Error('Update 1 failed')
      graph = updateResult1.right

      // Verify: File updated
      content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('Second Version')
      expect(content).not.toContain('Initial Version')

      const updateAction2: UpdateNode = {
        type: 'UpdateNode',
        nodeId,
        content: '# Final Version\n\nFinal content before deletion.'
      }
      const updateEffect2 = apply_graph_updates(graph, updateAction2)
      const updateResult2 = await updateEffect2(env)()
      expect(updateResult2._tag).toBe('Right')
      if (updateResult2._tag !== 'Right') throw new Error('Update 2 failed')
      graph = updateResult2.right

      // Verify: File updated again
      content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('Final Version')
      expect(content).not.toContain('Second Version')

      // STEP 3: DELETE
      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId
      }
      const deleteEffect = apply_graph_updates(graph, deleteAction)
      const deleteResult = await deleteEffect(env)()
      expect(deleteResult._tag).toBe('Right')
      if (deleteResult._tag !== 'Right') throw new Error('Delete failed')
      graph = deleteResult.right

      // Verify: File removed and node gone from graph
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(false)
      expect(graph.nodes[nodeId]).toBeUndefined()
    })
  })

  describe('BEHAVIOR: Error handling', () => {
    it('should fail fast when trying to update nonexistent node', async () => {
      // GIVEN: An empty graph
      const emptyGraph: Graph = { nodes: {}, edges: {} }

      // WHEN: Trying to update a node that doesn't exist
      const invalidUpdate: UpdateNode = {
        type: 'UpdateNode',
        nodeId: 'nonexistent',
        content: '# Should Fail\n\nShould not be written'
      }

      // THEN: Should throw error (fail fast philosophy)
      expect(() => apply_graph_updates(emptyGraph, invalidUpdate)).toThrow('Node nonexistent not found')

      // AND: No file should be created
      const filePath = path.join(tempVault, 'nonexistent.md')
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(false)
    })
  })
})
