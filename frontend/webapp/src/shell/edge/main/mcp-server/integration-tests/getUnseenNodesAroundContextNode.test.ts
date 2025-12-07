/**
 * Integration test for getUnseenNodesAroundContextNode MCP tool
 *
 * BEHAVIOR TESTED:
 * - INPUT: A context node ID
 * - OUTPUT: Nodes that exist in the current graph traversal but were NOT
 *   in the original context node's containedNodeIds
 *
 * This tests the integration of:
 * - Loading graph from disk
 * - Creating a context node (which stores containedNodeIds)
 * - Adding a new node to the graph
 * - Calling getUnseenNodesAroundContextNode to detect new nodes
 * - Verifying the MCP server tool returns correct results
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createContextNode } from '@/shell/edge/main/graph/context-nodes/createContextNode'
import { getUnseenNodesAroundContextNode, type UnseenNode } from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/loadGraphFromDisk'
import { setGraph, getGraph } from '@/shell/edge/main/state/graph-store'
import { setVaultPath, getVaultPath } from '@/shell/edge/main/graph/watchFolder'
import { applyGraphDeltaToDBThroughMem } from '@/shell/edge/main/graph/markdownReadWritePaths/writePath/applyGraphDeltaToDBThroughMem'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { promises as fs } from 'fs'
import path from 'path'
import type { NodeIdAndFilePath, FSUpdate, Graph, GraphDelta } from '@/pure/graph'

describe('getUnseenNodesAroundContextNode - Integration Tests', () => {
    let createdContextNodeId: NodeIdAndFilePath | null = null
    let createdNewNodeId: NodeIdAndFilePath | null = null
    let parentNodeBackups: Map<NodeIdAndFilePath, string> = new Map()

    beforeEach(async () => {
        // Initialize vault path with example_small fixture
        setVaultPath(EXAMPLE_SMALL_PATH)

        // Load the graph from disk
        const loadResult: E.Either<
            import('@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce').FileLimitExceededError,
            Graph
        > = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
        if (E.isLeft(loadResult)) throw new Error('Expected Right')
        const graph: Graph = loadResult.right
        setGraph(graph)

        // Clear parent node backups
        parentNodeBackups = new Map()
    })

    afterEach(async () => {
        const vaultPath: O.Option<string> = getVaultPath()

        // Clean up created context node file if it exists
        if (createdContextNodeId && O.isSome(vaultPath)) {
            const contextFilePath: string = path.join(vaultPath.value, createdContextNodeId)
            await fs.unlink(contextFilePath).catch(() => {
                // File might not exist, that's ok
            })
            createdContextNodeId = null
        }

        // Clean up created new node file if it exists
        if (createdNewNodeId && O.isSome(vaultPath)) {
            const newNodeFilePath: string = path.join(vaultPath.value, createdNewNodeId)
            await fs.unlink(newNodeFilePath).catch(() => {
                // File might not exist, that's ok
            })
            createdNewNodeId = null
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
    async function createContextNodeWithBackup(
        parentNodeId: NodeIdAndFilePath
    ): Promise<NodeIdAndFilePath> {
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

    /**
     * Helper function to add a new node linked to a parent
     */
    async function addNewNodeLinkedToParent(
        nodeId: string,
        content: string,
        parentNodeId: NodeIdAndFilePath
    ): Promise<NodeIdAndFilePath> {
        const vaultPath: O.Option<string> = getVaultPath()
        if (O.isNone(vaultPath)) throw new Error('Vault path not set')

        // Build markdown content with parent link
        const markdownContent: string = `${content}\n\n-----------------\n_Links:_\nParent:\n- child_of [[${parentNodeId}]]\n`

        // Create FSUpdate event
        const absolutePath: string = `${vaultPath.value}/${nodeId}`
        const fsEvent: FSUpdate = {
            absolutePath,
            content: markdownContent,
            eventType: 'Added'
        }

        // Apply to graph using pure function
        const currentGraph: Graph = getGraph()
        const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, vaultPath.value, currentGraph)

        // Persist to filesystem
        await applyGraphDeltaToDBThroughMem(delta)

        return nodeId
    }

    describe('BEHAVIOR: Return unseen nodes after adding new node', () => {
        it('should return newly added node that was not in original context', async () => {
            // GIVEN: A parent node that exists in example_small graph
            const parentNodeId: NodeIdAndFilePath =
                '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

            // WHEN: Create context node for this parent
            const contextNodeId: NodeIdAndFilePath =
                await createContextNodeWithBackup(parentNodeId)
            createdContextNodeId = contextNodeId

            // Reload graph to include the context node
            const loadResult1: E.Either<
                import('@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce').FileLimitExceededError,
                Graph
            > = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
            if (E.isLeft(loadResult1)) throw new Error('Expected Right')
            setGraph(loadResult1.right)

            // AND: Add a new node linked to the parent
            const newNodeId: NodeIdAndFilePath = 'test_unseen_node_integration.md'
            createdNewNodeId = await addNewNodeLinkedToParent(
                newNodeId,
                '# Test Unseen Node\n\nThis node was added after the context was created.',
                parentNodeId
            )

            // Reload graph to include the new node
            const loadResult2: E.Either<
                import('@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce').FileLimitExceededError,
                Graph
            > = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
            if (E.isLeft(loadResult2)) throw new Error('Expected Right')
            setGraph(loadResult2.right)

            // THEN: Call getUnseenNodesAroundContextNode
            const unseenNodes: readonly UnseenNode[] = getUnseenNodesAroundContextNode(contextNodeId)

            // VERIFY: The new node should be in the unseen nodes
            const newNodeInUnseen: UnseenNode | undefined = unseenNodes.find((n: UnseenNode) => n.nodeId === newNodeId)
            expect(newNodeInUnseen).toBeDefined()
            expect(newNodeInUnseen?.content).toContain('Test Unseen Node')
        })

        it('should return empty array when no new nodes have been added', async () => {
            // GIVEN: A parent node that exists in example_small graph
            const parentNodeId: NodeIdAndFilePath =
                '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

            // WHEN: Create context node for this parent
            const contextNodeId: NodeIdAndFilePath =
                await createContextNodeWithBackup(parentNodeId)
            createdContextNodeId = contextNodeId

            // Reload graph to include the context node
            const loadResult: E.Either<
                import('@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce').FileLimitExceededError,
                Graph
            > = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
            if (E.isLeft(loadResult)) throw new Error('Expected Right')
            setGraph(loadResult.right)

            // THEN: Call getUnseenNodesAroundContextNode without adding any new nodes
            const unseenNodes: readonly UnseenNode[] = getUnseenNodesAroundContextNode(contextNodeId)

            // VERIFY: Should return empty array since graph hasn't changed
            expect(unseenNodes).toHaveLength(0)
        })
    })

    describe('BEHAVIOR: Error handling', () => {
        it('should throw error if context node does not exist', () => {
            // GIVEN: A non-existent context node ID
            const nonExistentContextNodeId: NodeIdAndFilePath =
                'ctx-nodes/non_existent_context_node.md'

            // WHEN/THEN: Should throw error
            expect(() =>
                getUnseenNodesAroundContextNode(nonExistentContextNodeId)
            ).toThrow(`Context node ${nonExistentContextNodeId} not found in graph`)
        })

        it('should throw error if context node has no containedNodeIds', async () => {
            // GIVEN: A regular node (not a context node, so no containedNodeIds)
            const regularNodeId: NodeIdAndFilePath =
                '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

            // WHEN/THEN: Should throw error
            expect(() => getUnseenNodesAroundContextNode(regularNodeId)).toThrow(
                `Context node ${regularNodeId} has no containedNodeIds metadata`
            )
        })
    })

    describe('BEHAVIOR: Content returned should be without YAML frontmatter', () => {
        it('should return content without YAML or link markers', async () => {
            // GIVEN: A parent node and context node
            const parentNodeId: NodeIdAndFilePath =
                '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'

            const contextNodeId: NodeIdAndFilePath =
                await createContextNodeWithBackup(parentNodeId)
            createdContextNodeId = contextNodeId

            // Reload graph
            const loadResult1: E.Either<
                import('@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce').FileLimitExceededError,
                Graph
            > = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
            if (E.isLeft(loadResult1)) throw new Error('Expected Right')
            setGraph(loadResult1.right)

            // Add a new node with YAML frontmatter in the markdown
            const newNodeId: NodeIdAndFilePath = 'test_yaml_content_node.md'
            const contentWithFrontmatter: string = `---
title: Test Node With Frontmatter
color: blue
---
# Actual Content

This is the actual content without frontmatter.`

            createdNewNodeId = await addNewNodeLinkedToParent(
                newNodeId,
                contentWithFrontmatter,
                parentNodeId
            )

            // Reload graph
            const loadResult2: E.Either<
                import('@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce').FileLimitExceededError,
                Graph
            > = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH))
            if (E.isLeft(loadResult2)) throw new Error('Expected Right')
            setGraph(loadResult2.right)

            // WHEN: Get unseen nodes
            const unseenNodes: readonly UnseenNode[] = getUnseenNodesAroundContextNode(contextNodeId)

            // THEN: Find the new node
            const newNode: UnseenNode | undefined = unseenNodes.find((n: UnseenNode) => n.nodeId === newNodeId)
            expect(newNode).toBeDefined()

            // VERIFY: Content should NOT have YAML frontmatter (starts with ---)
            // Note: Content may contain "---" elsewhere (like link separators "-----------------")
            // so we check it doesn't START with frontmatter pattern
            expect(newNode?.content).not.toMatch(/^---\n/)
            expect(newNode?.content).not.toContain('title:')
            expect(newNode?.content).not.toContain('color:')

            // VERIFY: Content should have the actual content
            expect(newNode?.content).toContain('Actual Content')
        })
    })
})
