import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import type { GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('fromNodeToMarkdownContent', () => {
  describe('wikilinks appending', () => {
    it('should append wikilinks after content', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [{ targetId: 'child1.md', label: '' }, { targetId: 'child2.md', label: '' }],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      expect(result).toContain('# Test Content')
      expect(result).toContain('[[child1.md]]')
      expect(result).toContain('[[child2.md]]')
      // Check wikilinks come after content
      expect(result.indexOf('# Test Content')).toBeLessThan(result.indexOf('[[child1.md]]'))
    })

    it('should not append wikilinks when outgoingEdges is empty', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      expect(result).toContain('# Test Content')
      expect(result).not.toContain('[[')
    })

    it('should not duplicate wikilinks already in content as [link]*', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test\n\nSee [child1.md]* for details.',
        outgoingEdges: [{ targetId: 'child1.md', label: '' }, { targetId: 'child2.md', label: '' }],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // child1.md is already in content, so it will be restored to [[child1.md]]
      // and shouldn't be appended again
      expect(result).toContain('[[child1.md]]')
      // child2.md is not in content, so it should be appended
      expect(result).toContain('[[child2.md]]')
      // Count occurrences - child1.md should only appear once
      const child1Count: number = (result.match(/\[\[child1\.md\]\]/g) ?? []).length
      expect(child1Count).toBe(1)
    })

    /**
     * BUG: Edge Duplication on Add in WikiLink Editor
     *
     * When user types a relative link (e.g., [[linked-node]]) but the edge is stored
     * with the full path (e.g., "linked-node.md"), the deduplication check fails
     * because it does literal string matching instead of using linkMatchScore().
     *
     * This causes duplicate links: both [[linked-node]] (user's original) and
     * [[linked-node.md]] (appended from edge) appear in the output.
     */
    it('BUG: should not duplicate wikilinks when link format differs from edge targetId', () => {
      // Scenario: User typed [[linked-node]] (no .md extension)
      // Edge was created with targetId: "linked-node.md" (with extension)
      // These refer to the same node but deduplication fails due to literal string match
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test\n\nSee [linked-node]* for details.',
        outgoingEdges: [{ targetId: 'linked-node.md', label: '' }],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // After restoration: [[linked-node]] is in content
      // Edge has targetId: "linked-node.md"
      // BUG: Current code appends [[linked-node.md]] because string match fails
      // EXPECTED: Should recognize these refer to same node and NOT append

      // Count all wikilinks that resolve to the same node
      const linkedNodeCount: number = (result.match(/\[\[linked-node(\.md)?\]\]/g) ?? []).length
      expect(linkedNodeCount).toBe(1)  // Should only have ONE link, not two
    })

    it('BUG: should not duplicate wikilinks when relative vs absolute path differs', () => {
      // Scenario: User typed [[foo]] but node is in subfolder "subfolder/foo.md"
      // Edge targetId has full path, content has short relative form
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test\n\nSee [foo]* for details.',
        outgoingEdges: [{ targetId: 'subfolder/foo.md', label: '' }],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // BUG: Appends [[subfolder/foo.md]] even though [[foo]] already links to that node
      // This happens because literal string match fails

      // Should not have both [[foo]] AND [[subfolder/foo.md]]
      const hasFooShort: boolean = result.includes('[[foo]]')
      const hasFooLong: boolean = result.includes('[[subfolder/foo.md]]')

      // EXPECTED: Only one of them, not both
      expect(hasFooShort && hasFooLong).toBe(false)
    })
  })
})
