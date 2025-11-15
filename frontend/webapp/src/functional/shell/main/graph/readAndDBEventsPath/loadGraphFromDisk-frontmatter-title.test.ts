/**
 * Integration test for loadGraphFromDisk with frontmatter title
 *
 * BEHAVIOR TESTED:
 * - INPUT: Markdown file with frontmatter title and ### heading
 * - OUTPUT: GraphNode with correct content that markdownToTitle() can parse
 * - VERIFY: Title from frontmatter is prioritized over ### heading
 */

import { describe, it, expect } from 'vitest'
import { loadGraphFromDisk } from '@/functional/shell/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'
import { markdownToTitle } from '@/functional/pure/graph/markdown-parsing/markdown-to-title.ts'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'

describe('loadGraphFromDisk - Frontmatter Title Priority', () => {
    it('should load node with frontmatter title that overrides ### heading', async () => {
        // GIVEN: Test fixture with frontmatter title and ### heading
        const vaultPath = path.resolve(__dirname, '../../../../../tests/example_folder_fixtures/test-frontmatter-title')

        // WHEN: Loading graph from disk
        const graph = await loadGraphFromDisk(O.some(vaultPath))

        // THEN: Graph should have the node
        expect(Object.keys(graph.nodes)).toHaveLength(1)

        // AND: Node should exist with ID "3"
        const node = graph.nodes['3']
        expect(node).toBeDefined()

        // AND: Node content should include frontmatter
        expect(node.content).toContain("title: 'Bug: Auto-open Markdown Editor (3)'")
        expect(node.content).toContain('### The manual editor')

        // AND: markdownToTitle should extract frontmatter title (not ### heading)
        const title = markdownToTitle(node)
        expect(title).toBe('Bug: Auto-open Markdown Editor (3)')

        // NOT the ### heading:
        expect(title).not.toBe("The manual editor's auto-open Markdown editor functionality is not working when creating new child nodes.")
    })

    it('should preserve full content for UI to extract title', async () => {
        // GIVEN: Test fixture
        const vaultPath = path.resolve(__dirname, '../../../../../tests/example_folder_fixtures/test-frontmatter-title')

        // WHEN: Loading graph
        const graph = await loadGraphFromDisk(O.some(vaultPath))
        const node = graph.nodes['3']

        // THEN: Content should be complete
        expect(node.content.length).toBeGreaterThan(100)

        // AND: Should contain all parts
        expect(node.content).toContain('---') // Frontmatter markers
        expect(node.content).toContain('node_id: 3')
        expect(node.content).toContain("title: 'Bug: Auto-open Markdown Editor (3)'")
        expect(node.content).toContain('### The manual editor')
        expect(node.content).toContain('is_a_bug_encountered_during [[2_Task_Tree_Creation.md]]')
    })
})
