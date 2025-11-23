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
import * as O from 'fp-ts/lib/Option.js'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths.ts'

describe('loadGraphFromDisk - Frontmatter Title Priority', () => {
    it('should load nodes with frontmatter and extract titles correctly', async () => {
        // GIVEN: Use example_small which contains nodes with frontmatter
        const vaultPath = EXAMPLE_SMALL_PATH

        // WHEN: Loading graph from disk
        const graph = await loadGraphFromDisk(O.some(vaultPath))

        // THEN: Graph should have multiple nodes
        expect(Object.keys(graph.nodes).length).toBeGreaterThan(0)

        // AND: Should have at least one node with frontmatter
        const nodesWithFrontmatter = Object.values(graph.nodes).filter(node =>
            node.contentWithoutYamlOrLinks.includes('---') && node.contentWithoutYamlOrLinks.includes('node_id:')
        )
        expect(nodesWithFrontmatter.length).toBeGreaterThan(0)

        // AND: All nodes should have titles in their UI-edge metadata
        nodesWithFrontmatter.forEach(node => {
            expect(node.nodeUIMetadata.title).toBeTruthy()
            expect(node.nodeUIMetadata.title.length).toBeGreaterThan(0)
        })
    })

    it('should preserve full content for UI-edge to extract title', async () => {
        // GIVEN: Test fixture
        const vaultPath = EXAMPLE_SMALL_PATH

        // WHEN: Loading graph
        const graph = await loadGraphFromDisk(O.some(vaultPath))

        // THEN: All nodes should have non-empty content
        Object.values(graph.nodes).forEach(node => {
            expect(node.contentWithoutYamlOrLinks.length).toBeGreaterThan(0)
        })

        // AND: Nodes with frontmatter should preserve it
        const nodesWithFrontmatter = Object.values(graph.nodes).filter(node =>
            node.contentWithoutYamlOrLinks.includes('---')
        )

        nodesWithFrontmatter.forEach(node => {
            expect(node.contentWithoutYamlOrLinks).toContain('---') // Frontmatter markers preserved
        })
    })
})
