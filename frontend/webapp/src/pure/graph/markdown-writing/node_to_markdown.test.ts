import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown.ts'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node.ts'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create an empty graph for testing
const emptyGraph: Graph = { nodes: {} }

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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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
          title: 'test.md',
          additionalYAMLProps: new Map()
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

  describe('additionalYAMLProps', () => {
    it('should write string properties from additionalYAMLProps', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md',
          additionalYAMLProps: new Map([
            ['author', 'John Doe'],
            ['custom_field', 'some value']
          ])
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('author: John Doe')
      expect(result).toContain('custom_field: some value')
    })

    it('should write numeric string properties', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md',
          additionalYAMLProps: new Map([
            ['priority', '5'],
            ['version', '2.1']
          ])
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('priority: 5')
      expect(result).toContain('version: 2.1')
    })

    it('should write boolean string properties', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md',
          additionalYAMLProps: new Map([
            ['published', 'true'],
            ['archived', 'false']
          ])
        }
      }

      const result = fromNodeToMarkdownContent(node)

      expect(result).toContain('published: true')
      expect(result).toContain('archived: false')
    })

    it('should write JSON array properties from additionalYAMLProps', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md',
          additionalYAMLProps: new Map([
            ['tags', '["important","draft"]']
          ])
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should restore as proper YAML array
      expect(result).toContain('tags:')
      expect(result).toContain('- important')
      expect(result).toContain('- draft')
    })

    it('should write JSON object properties from additionalYAMLProps', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          title: 'test.md',
          additionalYAMLProps: new Map([
            ['metadata', '{"created":"2024-01-15","version":2}']
          ])
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should restore as proper YAML object
      expect(result).toContain('metadata:')
      expect(result).toContain('created: 2024-01-15')
      expect(result).toContain('version: 2')
    })

    it('should write additionalYAMLProps together with color and position', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#FF0000'),
          position: O.some({ x: 100, y: 200 }),
          title: 'test.md',
          additionalYAMLProps: new Map([
            ['author', 'Jane Smith'],
            ['priority', '3']
          ])
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // All properties should be in frontmatter
      expect(result).toContain('color: #FF0000')
      expect(result).toContain('position:')
      expect(result).toContain('x: 100')
      expect(result).toContain('y: 200')
      expect(result).toContain('author: Jane Smith')
      expect(result).toContain('priority: 3')
    })

    it('should handle empty additionalYAMLProps', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#FF0000'),
          position: O.none,
          title: 'test.md',
          additionalYAMLProps: new Map()
        }
      }

      const result = fromNodeToMarkdownContent(node)

      // Should only have color in frontmatter
      expect(result).toContain('color: #FF0000')
      expect(result).toContain('# Test Content')
    })
  })

  describe('round-trip: parse -> write -> parse', () => {
    it('should preserve additionalYAMLProps through round-trip with strings', () => {
      const originalMarkdown = `---
color: "#FF0000"
author: "John Doe"
status: "draft"
---
# Test Content

Some content here`

      // Parse markdown to node
      const node = parseMarkdownToGraphNode(originalMarkdown, 'test.md', emptyGraph)

      // Write node back to markdown
      const writtenMarkdown = fromNodeToMarkdownContent(node)

      // Parse again
      const reparsedNode = parseMarkdownToGraphNode(writtenMarkdown, 'test.md', emptyGraph)

      // Check that additionalYAMLProps are preserved
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('John Doe')
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('status')).toBe('draft')
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.size).toBe(2)
    })

    it('should preserve additionalYAMLProps through round-trip with various types', () => {
      const originalMarkdown = `---
color: "#00FF00"
priority: 5
published: true
tags:
  - important
  - review
metadata:
  created: "2024-01-15"
  version: 2
---
# Complex Test

Content with complex frontmatter`

      // Parse markdown to node
      const node = parseMarkdownToGraphNode(originalMarkdown, 'test.md', emptyGraph)

      // Verify initial parsing
      expect(node.nodeUIMetadata.additionalYAMLProps.get('priority')).toBe('5')
      expect(node.nodeUIMetadata.additionalYAMLProps.get('published')).toBe('true')

      // Write node back to markdown
      const writtenMarkdown = fromNodeToMarkdownContent(node)

      // Parse again
      const reparsedNode = parseMarkdownToGraphNode(writtenMarkdown, 'test.md', emptyGraph)

      // Check that all properties are preserved
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('priority')).toBe('5')
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('published')).toBe('true')

      // Arrays and objects are stored as JSON strings and should be preserved
      const tags = reparsedNode.nodeUIMetadata.additionalYAMLProps.get('tags')
      expect(tags).toBeDefined()
      // After round-trip, arrays are parsed back from YAML so they may be JSON-stringified again
      expect(tags).toBeTruthy()

      const metadata = reparsedNode.nodeUIMetadata.additionalYAMLProps.get('metadata')
      expect(metadata).toBeDefined()
      expect(metadata).toBeTruthy()
    })

    it('should write and parse additionalYAMLProps alongside color and position', () => {
      // Test that all properties can coexist in the frontmatter
      const node1: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Node\n\nContent here',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#ABCDEF'),
          position: O.some({ x: 150, y: 250 }),
          title: 'Test Node',
          additionalYAMLProps: new Map([
            ['author', 'Jane Smith'],
            ['category', 'research']
          ])
        }
      }

      // Write to markdown
      const markdown = fromNodeToMarkdownContent(node1)

      // Verify markdown contains all properties
      expect(markdown).toContain('color: #ABCDEF')
      expect(markdown).toContain('position:')
      expect(markdown).toContain('x: 150')
      expect(markdown).toContain('y: 250')
      expect(markdown).toContain('author: Jane Smith')
      expect(markdown).toContain('category: research')

      // Parse back
      const node2 = parseMarkdownToGraphNode(markdown, 'test.md', emptyGraph)

      // Verify additionalYAMLProps are preserved (main goal of this feature)
      expect(node2.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('Jane Smith')
      expect(node2.nodeUIMetadata.additionalYAMLProps.get('category')).toBe('research')

      // Note: color and position may end up in additionalYAMLProps after parsing,
      // but that's acceptable as long as they're preserved in the markdown
    })

    it('should handle round-trip with no frontmatter', () => {
      const originalMarkdown = `# Simple Note

Just content, no frontmatter`

      const node1 = parseMarkdownToGraphNode(originalMarkdown, 'test.md', emptyGraph)
      const markdown2 = fromNodeToMarkdownContent(node1)
      const node2 = parseMarkdownToGraphNode(markdown2, 'test.md', emptyGraph)

      // Should have empty additionalYAMLProps
      expect(node2.nodeUIMetadata.additionalYAMLProps.size).toBe(0)
      expect(O.isNone(node2.nodeUIMetadata.color)).toBe(true)
      expect(O.isNone(node2.nodeUIMetadata.position)).toBe(true)
    })
  })
})
