import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import type { GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('fromNodeToMarkdownContent', () => {
  describe('frontmatter generation', () => {
    it('should generate frontmatter from nodeUIMetadata color', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#00FF00'),
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Should generate frontmatter with nodeUIMetadata color
      expect(result).toContain('color: #00FF00')
      expect(result).toContain('# Test Content')
    })

    it('should generate frontmatter with only color when position is none', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#00FF00'),
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Should only have color in frontmatter
      expect(result).toContain('color: #00FF00')
      expect(result).not.toContain('position:')
      expect(result).toContain('# Test Content')
    })

    it('should NOT generate position in frontmatter (stored in positions.json)', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.some({ x: 100, y: 200 }),
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Position is now stored in .voicetree/positions.json, not in YAML
      expect(result).not.toContain('position:')
      expect(result).not.toContain('x: 100')
      expect(result).not.toContain('y: 200')
      expect(result).toContain('# Test Content')
    })

    it('should exclude position even with float values', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.some({ x: 497.79198993276833, y: -19.08618457963695 }),
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Position should not appear in YAML at all (stored in positions.json)
      expect(result).not.toContain('position:')
      expect(result).not.toContain('x:')
      expect(result).not.toContain('y:')
    })

    it('should include only color when nodeUIMetadata has both color and position', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#FFAA00'),
          position: O.some({ x: 300, y: 400 }),
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Should have color but NOT position in frontmatter
      expect(result).toContain('color: #FFAA00')
      expect(result).not.toContain('position:')
      expect(result).not.toContain('x: 300')
      expect(result).not.toContain('y: 400')
      expect(result).toContain('# Test Content')
    })

    it('should generate frontmatter when content has no prior frontmatter', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content\n\nJust plain content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#0000FF'),
          position: O.some({ x: 50, y: 75 }),
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      expect(result).toContain('---\n')
      expect(result).toContain('color: #0000FF')
      expect(result).not.toContain('position:')
      expect(result).not.toContain('x: 50')
      expect(result).not.toContain('y: 75')
      expect(result).toContain('# Test Content')
    })

    it('should generate minimal frontmatter', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#AABBCC'),
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Should only have nodeUIMetadata color
      expect(result).toContain('color: #AABBCC')
      expect(result).toContain('# Test Content')
    })

    it('should generate frontmatter with only color, not position', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#DDEEFF'),
          position: O.some({ x: 10, y: 20 }),
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      expect(result).toContain('color: #DDEEFF')
      expect(result).not.toContain('position:')
      expect(result).not.toContain('x: 10')
      expect(result).not.toContain('y: 20')
      expect(result).toContain('# Test Content')
    })

    it('should restore wikilinks from [link]* notation', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test\n\nThis has [other-note]* and [another]* links.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // [link]* should be restored to [[link]]
      expect(result).toContain('[[other-note]]')
      expect(result).toContain('[[another]]')
      expect(result).not.toContain('[other-note]*')
      expect(result).not.toContain('[another]*')
    })
  })
})
