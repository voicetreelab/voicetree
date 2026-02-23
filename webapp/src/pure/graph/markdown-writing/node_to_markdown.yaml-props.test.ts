import { describe, it, expect } from 'vitest'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import { createGraph } from '@/pure/graph/createGraph'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

const emptyGraph: Graph = createGraph({})

describe('fromNodeToMarkdownContent', () => {
  describe('additionalYAMLProps', () => {
    it('should write string properties from additionalYAMLProps', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
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
        absoluteFilePathIsID: 'test.md',
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
        absoluteFilePathIsID: 'test.md',
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
        absoluteFilePathIsID: 'test.md',
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
        absoluteFilePathIsID: 'test.md',
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

    it('should write additionalYAMLProps together with color (position excluded)', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
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

      // Color and additional props should be in frontmatter, but NOT position
      expect(result).toContain('color: #FF0000')
      expect(result).not.toContain('position:')
      expect(result).not.toContain('x: 100')
      expect(result).not.toContain('y: 200')
      expect(result).toContain('author: Jane Smith')
      expect(result).toContain('priority: 3')
    })

    it('should handle empty additionalYAMLProps', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'test.md',
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

  describe('containedNodeIds', () => {
    it('should write containedNodeIds array to frontmatter', () => {
      const node: GraphNode = {
        absoluteFilePathIsID: 'context.md',
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
        absoluteFilePathIsID: 'regular.md',
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
