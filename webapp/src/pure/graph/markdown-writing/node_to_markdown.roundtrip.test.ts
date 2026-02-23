import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import { createGraph } from '@/pure/graph/createGraph'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

const emptyGraph: Graph = createGraph({})

describe('fromNodeToMarkdownContent', () => {
  describe('round-trip: parse -> write -> parse', () => {
    it('should preserve additionalYAMLProps through round-trip with strings', () => {
      const originalMarkdown: "---\ncolor: \"#FF0000\"\nauthor: \"John Doe\"\nstatus: \"draft\"\n---\n# Test Content\n\nSome content here" = `---
color: "#FF0000"
author: "John Doe"
status: "draft"
---
# Test Content

Some content here`

      // Parse markdown to node
      const node: GraphNode = parseMarkdownToGraphNode(originalMarkdown, 'test.md', emptyGraph)

      // Write node back to markdown
      const writtenMarkdown: string = fromNodeToMarkdownContent(node)

      // Parse again
      const reparsedNode: GraphNode = parseMarkdownToGraphNode(writtenMarkdown, 'test.md', emptyGraph)

      // Check that additionalYAMLProps are preserved
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('John Doe')
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('status')).toBe('draft')
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.size).toBe(2)
    })

    it('should preserve additionalYAMLProps through round-trip with various types', () => {
      const originalMarkdown: "---\ncolor: \"#00FF00\"\npriority: 5\npublished: true\ntags:\n  - important\n  - review\nmetadata:\n  created: \"2024-01-15\"\n  version: 2\n---\n# Complex Test\n\nContent with complex frontmatter" = `---
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
      const node: GraphNode = parseMarkdownToGraphNode(originalMarkdown, 'test.md', emptyGraph)

      // Verify initial parsing
      expect(node.nodeUIMetadata.additionalYAMLProps.get('priority')).toBe('5')
      expect(node.nodeUIMetadata.additionalYAMLProps.get('published')).toBe('true')

      // Write node back to markdown
      const writtenMarkdown: string = fromNodeToMarkdownContent(node)

      // Parse again
      const reparsedNode: GraphNode = parseMarkdownToGraphNode(writtenMarkdown, 'test.md', emptyGraph)

      // Check that all properties are preserved
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('priority')).toBe('5')
      expect(reparsedNode.nodeUIMetadata.additionalYAMLProps.get('published')).toBe('true')

      // Arrays and objects are stored as JSON strings and should be preserved
      const tags: string | undefined = reparsedNode.nodeUIMetadata.additionalYAMLProps.get('tags')
      expect(tags).toBeDefined()
      // After round-trip, arrays are parsed back from YAML so they may be JSON-stringified again
      expect(tags).toBeTruthy()

      const metadata: string | undefined = reparsedNode.nodeUIMetadata.additionalYAMLProps.get('metadata')
      expect(metadata).toBeDefined()
      expect(metadata).toBeTruthy()
    })

    it('should write and parse additionalYAMLProps alongside color (position excluded from write)', () => {
      // Position is still parsed from YAML (for migration), but no longer written
      const node1: GraphNode = {
        absoluteFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Node\n\nContent here',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.some('#ABCDEF'),
          position: O.some({ x: 150, y: 250 }),
          additionalYAMLProps: new Map([
            ['author', 'Jane Smith'],
            ['category', 'research']
          ]),
          isContextNode: false
        }
      }

      // Write to markdown
      const markdown: string = fromNodeToMarkdownContent(node1)

      // Verify markdown contains color and additional props but NOT position
      expect(markdown).toContain('color: #ABCDEF')
      expect(markdown).not.toContain('position:')
      expect(markdown).not.toContain('x: 150')
      expect(markdown).not.toContain('y: 250')
      expect(markdown).toContain('author: Jane Smith')
      expect(markdown).toContain('category: research')

      // Parse back — position will be lost since it wasn't written
      const node2: GraphNode = parseMarkdownToGraphNode(markdown, 'test.md', emptyGraph)

      // Verify additionalYAMLProps are preserved
      expect(node2.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('Jane Smith')
      expect(node2.nodeUIMetadata.additionalYAMLProps.get('category')).toBe('research')

      // Position should be O.none after round-trip since it's no longer written to YAML
      expect(O.isNone(node2.nodeUIMetadata.position)).toBe(true)
    })

    it('should handle round-trip with no frontmatter', () => {
      const originalMarkdown: "# Simple Note\n\nJust content, no frontmatter" = `# Simple Note

Just content, no frontmatter`

      const node1: GraphNode = parseMarkdownToGraphNode(originalMarkdown, 'test.md', emptyGraph)
      const markdown2: string = fromNodeToMarkdownContent(node1)
      const node2: GraphNode = parseMarkdownToGraphNode(markdown2, 'test.md', emptyGraph)

      // Should have empty additionalYAMLProps
      expect(node2.nodeUIMetadata.additionalYAMLProps.size).toBe(0)
      expect(O.isNone(node2.nodeUIMetadata.color)).toBe(true)
      expect(O.isNone(node2.nodeUIMetadata.position)).toBe(true)
    })
  })
})
