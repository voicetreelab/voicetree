import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown.ts'
import type { GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('fromNodeToMarkdownContent', () => {
  describe('frontmatter generation', () => {
    it('should generate frontmatter from nodeUIMetadata color', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#00FF00'),
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should generate frontmatter with nodeUIMetadata color
      expect(result).toContain('color: #00FF00')
      expect(result).toContain('# Test Content')
    })

    it('should generate frontmatter with only color when position is none', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#00FF00'),
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should only have color in frontmatter
      expect(result).toContain('color: #00FF00')
      expect(result).not.toContain('position:')
      expect(result).toContain('# Test Content')
    })

    it('should generate frontmatter with position from nodeUIMetadata', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.some({ x: 100, y: 200 }),
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should generate frontmatter with nodeUIMetadata position
      expect(result).toContain('position:')
      expect(result).toContain('x: 100')
      expect(result).toContain('y: 200')
      expect(result).toContain('# Test Content')
    })

    it('should include both color and position when nodeUIMetadata has both', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#FFAA00'),
          position: O.some({ x: 300, y: 400 }),
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should have both nodeUIMetadata fields in frontmatter
      expect(result).toContain('color: #FFAA00')
      expect(result).toContain('position:')
      expect(result).toContain('x: 300')
      expect(result).toContain('y: 400')
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

    it('should generate minimal frontmatter', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#AABBCC'),
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should only have nodeUIMetadata color
      expect(result).toContain('color: #AABBCC')
      expect(result).toContain('# Test Content')
    })

    it('should generate frontmatter with both color and position', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
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

    it('should restore wikilinks from [link]* notation', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test\n\nThis has [other-note]* and [another]* links.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // [link]* should be restored to [[link]]
      expect(result).toContain('[[other-note]]')
      expect(result).toContain('[[another]]')
      expect(result).not.toContain('[other-note]*')
      expect(result).not.toContain('[another]*')
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

    it('should not duplicate wikilinks already in content as [link]*', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test\n\nSee [child1.md]* for details.',
        outgoingEdges: [{ targetId: 'child1.md', label: '' }, { targetId: 'child2.md', label: '' }],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md'
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // child1.md is already in content, so it will be restored to [[child1.md]]
      // and shouldn't be appended again
      expect(result).toContain('[[child1.md]]')
      // child2.md is not in content, so it should be appended
      expect(result).toContain('[[child2.md]]')
      // Count occurrences - child1.md should only appear once
      const child1Count = (result.match(/\[\[child1\.md\]\]/g) ?? []).length
      expect(child1Count).toBe(1)
    })
  })
})
