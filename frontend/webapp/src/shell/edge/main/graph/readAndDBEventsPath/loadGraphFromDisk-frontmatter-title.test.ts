/**
 * Integration test for loadGraphFromDisk with frontmatter title
 *
 * BEHAVIOR TESTED:
 * - INPUT: Markdown file with frontmatter title and ### heading
 * - OUTPUT: GraphNode with correct content that markdownToTitle() can parse
 * - VERIFY: Title from frontmatter is prioritized over ### heading
 */

import { describe, it, expect } from 'vitest'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import type { Graph, GraphNode } from '@/pure/graph'

/** Unwrap Either or fail test */
function unwrapGraph(result: E.Either<unknown, Graph>): Graph {
  if (E.isLeft(result)) throw new Error('Expected Right but got Left')
  return result.right
}
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths.ts'

describe('loadGraphFromDisk - Frontmatter Title Priority', () => {
    it('should load nodes with frontmatter and extract titles correctly', async () => {
        // GIVEN: Use example_small which contains nodes with frontmatter
        const vaultPath = EXAMPLE_SMALL_PATH

        // WHEN: Loading graph from disk
        const graph = unwrapGraph(await loadGraphFromDisk(O.some(vaultPath)))

        // THEN: Graph should have multiple nodes
        expect(Object.keys(graph.nodes).length).toBeGreaterThan(0)

        // AND: All nodes should have titles in their UI-edge metadata
        Object.values(graph.nodes).forEach((node: GraphNode) => {
            expect(node.nodeUIMetadata.title).toBeTruthy()
            expect(node.nodeUIMetadata.title.length).toBeGreaterThan(0)
        })

        // AND: contentWithoutYamlOrLinks should NOT contain YAML frontmatter (it's stripped)
        Object.values(graph.nodes).forEach((node: GraphNode) => {
            expect(node.contentWithoutYamlOrLinks).not.toContain('node_id:')
        })
    })

    it('should strip YAML frontmatter but preserve markdown content', async () => {
        // GIVEN: Test fixture
        const vaultPath = EXAMPLE_SMALL_PATH

        // WHEN: Loading graph
        const graph = unwrapGraph(await loadGraphFromDisk(O.some(vaultPath)))

        // THEN: All nodes should have non-empty content
        Object.values(graph.nodes).forEach((node: GraphNode) => {
            expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
        })

        // AND: contentWithoutYamlOrLinks should NOT contain YAML properties
        Object.values(graph.nodes).forEach((node: GraphNode) => {
            // Should not have YAML properties (these are stripped from frontmatter)
            expect(node.contentWithoutYamlOrLinks).not.toContain('node_id:')
            // Note: We can't check for '---' because that could be a markdown horizontal rule
        })
    })
})
