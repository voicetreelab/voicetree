/**
 * Integration test for applyGraphDeltaToDB
 *
 * BEHAVIOR TESTED:
 * - INPUT: GraphDelta with UpsertNode action
 * - OUTPUT: GraphNode file written to disk
 * - INPUT: GraphDelta with DeleteNode action
 * - OUTPUT: GraphNode file removed from disk
 *
 * This e2e-tests the integration of:
 * - applyGraphDeltaToDB shell function
 * - apply_graph_deltas_to_db pure core effect
 * - Filesystem write/delete operations
 *
 * Testing Strategy:
 * - Initialize vault path with example_small fixture directory
 * - Create a new node via UpsertNode delta
 * - Verify file exists on disk with correct content
 * - Delete the node via DeleteNode delta
 * - Verify file is removed from disk
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyGraphDeltaToDBThroughMem } from '@/shell/edge/main/graph/markdownReadWritePaths/writePath/applyGraphDeltaToDBThroughMem'
import { setGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath, clearVaultPath } from '@/shell/edge/main/graph/watchFolder'
import type { GraphDelta, UpsertNodeDelta, DeleteNode, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import { promises as fs } from 'fs'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'

const TEST_NODE_ID: "test-integration-node" = 'test-integration-node'
const TEST_FILE_PATH: string = path.join(EXAMPLE_SMALL_PATH, `${TEST_NODE_ID}.md`)

describe('applyGraphDeltaToDB - Integration Tests', () => {
  beforeEach(() => {
    // Initialize state with empty graph and example_small vault path
    setGraph({ nodes: {} })
    setVaultPath(EXAMPLE_SMALL_PATH)
  })

  afterEach(async () => {
    // Clean up test file if it exists
    await fs.unlink(TEST_FILE_PATH).catch(() => {
      // File might not exist, that's ok
    })
  })

  describe('BEHAVIOR: Apply UpsertNode delta writes file to disk', () => {
    it('should write node file to disk when UpsertNode delta is applied', async () => {
      // GIVEN: A UpsertNode delta
      const testNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        contentWithoutYamlOrLinks: '# Test Integration GraphNode\n\nThis is test content for integration testing.',
        outgoingEdges: [],
        nodeUIMetadata: {

          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const upsertAction: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: testNode,
        previousNode: O.none
      }

      const delta: GraphDelta = [upsertAction]

      // WHEN: Apply the delta to DB
      await applyGraphDeltaToDBThroughMem(delta)

      // THEN: File should exist on disk
      const fileExists: boolean = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)

      expect(fileExists).toBe(true)

      // AND: File should have correct content
      const fileContent: string = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('# Test Integration GraphNode')
      expect(fileContent).toContain('This is test content for integration testing.')
    })

    it('should write node file with outgoing edges as markdown links', async () => {
      // GIVEN: Node with outgoing edges
      const testNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        contentWithoutYamlOrLinks: '# GraphNode With Links\n\nThis node links to [[1_VoiceTree_Website_Development_and_Node_Display_Bug]] and [[2_VoiceTree_Node_ID_Duplication_Bug]].',
        outgoingEdges: [
          { targetId: '1_VoiceTree_Website_Development_and_Node_Display_Bug', label: '' },
          { targetId: '2_VoiceTree_Node_ID_Duplication_Bug', label: '' }
        ],
        nodeUIMetadata: {

          color: O.some('#FF5733'),
          position: O.some({ x: 100, y: 200 }),
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: testNode,
        previousNode: O.none
      }]

      // WHEN: Apply the delta
      await applyGraphDeltaToDBThroughMem(delta)

      // THEN: File should exist with markdown links
      const fileContent: string = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('[[1_VoiceTree_Website_Development_and_Node_Display_Bug]]')
      expect(fileContent).toContain('[[2_VoiceTree_Node_ID_Duplication_Bug]]')

      // AND: Should have frontmatter with color and position
      expect(fileContent).toContain('---')
      expect(fileContent).toContain('color: #FF5733')
      expect(fileContent).toContain('x: 100')
      expect(fileContent).toContain('y: 200')
    })
  })

  describe('BEHAVIOR: Apply DeleteNode delta removes file from disk', () => {
    it('should delete node file from disk when DeleteNode delta is applied', async () => {
      // GIVEN: An existing file on disk
      // First create the file
      const testNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        contentWithoutYamlOrLinks: '# GraphNode To Delete\n\nThis node will be deleted.',
        outgoingEdges: [],
        nodeUIMetadata: {

          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const createDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: testNode,
        previousNode: O.none
      }]

      await applyGraphDeltaToDBThroughMem(createDelta)

      // Verify file exists
      const fileExistsBeforeDelete: boolean = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)
      expect(fileExistsBeforeDelete).toBe(true)

      // WHEN: Apply DeleteNode delta
      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId: TEST_NODE_ID,
        deletedNode: O.none
      }

      const deleteDelta: GraphDelta = [deleteAction]
      await applyGraphDeltaToDBThroughMem(deleteDelta)

      // THEN: File should no longer exist
      const fileExistsAfterDelete: boolean = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)

      expect(fileExistsAfterDelete).toBe(false)
    })
  })

  describe('BEHAVIOR: Apply multiple deltas in sequence', () => {
    it('should handle create -> update -> delete sequence', async () => {
      // STEP 1: Create node
      const createNode: GraphNode = {
        relativeFilePathIsID: TEST_NODE_ID,
        contentWithoutYamlOrLinks: '# Original Content',
        outgoingEdges: [],
        nodeUIMetadata: {

          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      await applyGraphDeltaToDBThroughMem([{
        type: 'UpsertNode',
        nodeToUpsert: createNode,
        previousNode: O.none
      }])

      let fileContent: string = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('# Original Content')

      // STEP 2: Update node
      const updateNode: GraphNode = {
        ...createNode,
        contentWithoutYamlOrLinks: '# Updated Content\n\nThis content has been updated.',
        nodeUIMetadata: {

          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      await applyGraphDeltaToDBThroughMem([{
        type: 'UpsertNode',
        nodeToUpsert: updateNode,
        previousNode: O.none
      }])

      fileContent = await fs.readFile(TEST_FILE_PATH, 'utf-8')
      expect(fileContent).toContain('# Updated Content')
      expect(fileContent).toContain('This content has been updated.')

      // STEP 3: Delete node
      await applyGraphDeltaToDBThroughMem([{
        type: 'DeleteNode',
        nodeId: TEST_NODE_ID,
        deletedNode: O.none
      }])

      const fileExists: boolean = await fs.access(TEST_FILE_PATH)
        .then(() => true)
        .catch(() => false)
      expect(fileExists).toBe(false)
    })
  })

  describe('BEHAVIOR: Error handling', () => {
    it('should throw error if vault path is not initialized', async () => {
      // GIVEN: Vault path not set
      clearVaultPath() // Clear vault path to None

      const delta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: {
          relativeFilePathIsID: TEST_NODE_ID,
          contentWithoutYamlOrLinks: '# Test',
          outgoingEdges: [],
          nodeUIMetadata: {

            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: O.none
      }]

      // WHEN/THEN: Should throw error about vault path
      await expect(applyGraphDeltaToDBThroughMem(delta))
        .rejects
        .toThrow('Vault path not initialized')
    })
  })
})
