import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown.ts'
import type { GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('fromNodeToMarkdownContent', () => {
  describe('frontmatter merging', () => {
    it('should merge nodeUIMetadata color over content frontmatter color when both present', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: `---
color: "#FF0000"
---
# Test Content`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#00FF00'),
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // nodeUIMetadata color (#00FF00) should win over content color (#FF0000)
      expect(result).toContain('color: #00FF00')
      expect(result).not.toContain('color: "#FF0000"')
      expect(result).toContain('# Test Content')
    })

    it('should preserve content frontmatter position when nodeUIMetadata has no position', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: `---
position:
  x: 150
  y: 250
color: "#FF0000"
---
# Test Content`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#00FF00'),
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should preserve position from content
      expect(result).toContain('position:')
      expect(result).toContain('x: 150')
      expect(result).toContain('y: 250')
      // nodeUIMetadata color should still win
      expect(result).toContain('color: #00FF00')
      expect(result).toContain('# Test Content')
    })

    it('should merge nodeUIMetadata position over content frontmatter position when both present', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: `---
position:
  x: 150
  y: 250
---
# Test Content`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.some({ x: 100, y: 200 }),
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // nodeUIMetadata position should win
      expect(result).toContain('position:')
      expect(result).toContain('x: 100')
      expect(result).toContain('y: 200')
      expect(result).not.toContain('x: 150')
      expect(result).not.toContain('y: 250')
      expect(result).toContain('# Test Content')
    })

    it('should include both color and position when content has title/summary and nodeUIMetadata has both', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: `---
title: "My Node"
summary: "A summary"
---
# Test Content`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#FFAA00'),
          position: O.some({ x: 300, y: 400 }),
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should have both nodeUIMetadata fields
      expect(result).toContain('color: #FFAA00')
      expect(result).toContain('position:')
      expect(result).toContain('x: 300')
      expect(result).toContain('y: 400')
      // Should preserve title and summary from content (quotes are optional in YAML)
      expect(result).toContain('title: My Node')
      expect(result).toContain('summary: A summary')
      expect(result).toContain('# Test Content')
    })

    it('should work as currently does when content has no frontmatter', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content\n\nJust plain content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#0000FF'),
          position: O.some({ x: 50, y: 75 }),
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('---\n')
      expect(result).toContain('color: #0000FF')
      expect(result).toContain('position:')
      expect(result).toContain('x: 50')
      expect(result).toContain('y: 75')
      expect(result).toContain('# Test Content')
    })

    it('should preserve other frontmatter fields not in nodeUIMetadata', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: `---
title: "Original Title"
summary: "Original Summary"
node_id: "original-id"
custom_field: "should be preserved"
---
# Test Content`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#AABBCC'),
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should preserve all fields from content (quotes are optional for simple strings in YAML)
      expect(result).toContain('title: Original Title')
      expect(result).toContain('summary: Original Summary')
      expect(result).toContain('node_id: original-id')
      expect(result).toContain('custom_field: should be preserved')
      // Should add nodeUIMetadata color
      expect(result).toContain('color: #AABBCC')
    })

    it('should handle empty content frontmatter with nodeUIMetadata', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: `---
---
# Test Content`,
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#DDEEFF'),
          position: O.some({ x: 10, y: 20 }),
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('color: #DDEEFF')
      expect(result).toContain('position:')
      expect(result).toContain('x: 10')
      expect(result).toContain('y: 20')
      expect(result).toContain('# Test Content')
    })
  })

  describe('wikilinks appending', () => {
    it('should append wikilinks after content', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [{ targetId: 'child1.md', label: '' }, { targetId: 'child2.md', label: '' }],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('# Test Content')
      expect(result).toContain('[[child1.md]]')
      expect(result).toContain('[[child2.md]]')
      // Check wikilinks come after content
      expect(result.indexOf('# Test Content')).toBeLessThan(result.indexOf('[[child1.md]]'))
    })

    it('should not append wikilinks when outgoingEdges is empty', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('# Test Content')
      expect(result).not.toContain('[[')
    })
  })
})
