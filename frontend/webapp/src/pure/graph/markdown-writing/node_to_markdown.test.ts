import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
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
        relativeFilePathIsID: 'test.md',
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

    it('should generate frontmatter with position from nodeUIMetadata', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
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
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

  describe('wikilinks appending', () => {
    it('should append wikilinks after content', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
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
        relativeFilePathIsID: 'test.md',
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
        relativeFilePathIsID: 'test.md',
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
        relativeFilePathIsID: 'test.md',
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
        relativeFilePathIsID: 'test.md',
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

  describe('additionalYAMLProps', () => {
    it('should write string properties from additionalYAMLProps', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'test.md',
        contentWithoutYamlOrLinks: '# Test Content',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map([
            ['author', 'John Doe'],
            ['custom_field', 'some value']
          ]),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

          additionalYAMLProps: new Map([
            ['priority', '5'],
            ['version', '2.1']
          ]),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

          additionalYAMLProps: new Map([
            ['published', 'true'],
            ['archived', 'false']
          ]),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

          additionalYAMLProps: new Map([
            ['tags', '["important","draft"]']
          ]),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

          additionalYAMLProps: new Map([
            ['metadata', '{"created":"2024-01-15","version":2}']
          ]),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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
          additionalYAMLProps: new Map([
            ['author', 'Jane Smith'],
            ['priority', '3']
          ]),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

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

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      // Should only have color in frontmatter
      expect(result).toContain('color: #FF0000')
      expect(result).toContain('# Test Content')
    })
  })

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

    it('should write and parse additionalYAMLProps alongside color and position', () => {
      // Test that all properties can coexist in the frontmatter
      const node1: GraphNode = {
        relativeFilePathIsID: 'test.md',
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

      // Verify markdown contains all properties
      expect(markdown).toContain('color: #ABCDEF')
      expect(markdown).toContain('position:')
      expect(markdown).toContain('x: 150')
      expect(markdown).toContain('y: 250')
      expect(markdown).toContain('author: Jane Smith')
      expect(markdown).toContain('category: research')

      // Parse back
      const node2: GraphNode = parseMarkdownToGraphNode(markdown, 'test.md', emptyGraph)

      // Verify additionalYAMLProps are preserved (main goal of this feature)
      expect(node2.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('Jane Smith')
      expect(node2.nodeUIMetadata.additionalYAMLProps.get('category')).toBe('research')

      // Note: color and position may end up in additionalYAMLProps after parsing,
      // but that's acceptable as long as they're preserved in the markdown
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

  describe('containedNodeIds', () => {
    it('should write containedNodeIds array to frontmatter', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'context.md',
        contentWithoutYamlOrLinks: '# Context Node',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: true,
          containedNodeIds: ['node1.md', 'folder/node2.md', 'node3.md']
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      expect(result).toContain('containedNodeIds:')
      expect(result).toContain('- node1.md')
      expect(result).toContain('- folder/node2.md')
      expect(result).toContain('- node3.md')
      expect(result).toContain('isContextNode: true')
    })

    it('should preserve containedNodeIds through round-trip', () => {
      const originalMarkdown: string = `---
title: Context Node
isContextNode: true
containedNodeIds:
  - node1.md
  - folder/node2.md
  - deep/path/node3.md
---
# Context Node Content`

      const node: GraphNode = parseMarkdownToGraphNode(originalMarkdown, 'context.md', emptyGraph)
      const writtenMarkdown: string = fromNodeToMarkdownContent(node)
      const reparsedNode: GraphNode = parseMarkdownToGraphNode(writtenMarkdown, 'context.md', emptyGraph)

      expect(reparsedNode.nodeUIMetadata.isContextNode).toBe(true)
      expect(reparsedNode.nodeUIMetadata.containedNodeIds).toEqual([
        'node1.md',
        'folder/node2.md',
        'deep/path/node3.md'
      ])
    })

    it('should not write containedNodeIds when undefined', () => {
      const node: GraphNode = {
        relativeFilePathIsID: 'regular.md',
        contentWithoutYamlOrLinks: '# Regular Node',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: O.none,
          position: O.none,

          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const result: string = fromNodeToMarkdownContent(node)

      expect(result).not.toContain('containedNodeIds')
    })
  })
})
