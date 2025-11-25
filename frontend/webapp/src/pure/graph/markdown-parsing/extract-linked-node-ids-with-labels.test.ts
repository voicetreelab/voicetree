import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractEdges } from '@/pure/graph/markdown-parsing/extract-edges.ts'
import type { GraphNode, Edge } from '@/pure/graph'

/**
 * Integration tests for relationship labels feature.
 *
 * Tests the end-to-end flow of extracting wikilinks with relationship labels
 * from markdown content, which should now return Edge[] instead of NodeId[].
 */
describe('extractLinkedNodeIds - relationship labels integration', () => {
  const createNode = (id: string, content = '', title = id): GraphNode => ({
    relativeFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      title,
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  describe('parsing relationship labels from markdown', () => {
    it('should extract edges with labels when text precedes wikilink on same line', () => {
      const content = `# My Document

This references [[intro]] and extends [[architecture]].`

      const nodes = {
        'intro': createNode('intro'),
        'architecture': createNode('architecture')
      }

      const result = extractEdges(content, nodes)

      // Should return Edge[] with labels extracted from text before [[link]]
      expect(result).toEqual([
        { targetId: 'intro', label: 'This references' },
        { targetId: 'architecture', label: 'This references [[intro]] and extends' }
      ] as Edge[])
    })

    it('should extract empty label when wikilink has no preceding text', () => {
      const content = `See [[node-a]] for details.`

      const nodes = {
        'node-a': createNode('node-a')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'node-a', label: 'See' }
      ] as Edge[])
    })

    it('should handle mixed labeled and unlabeled links', () => {
      const content = `
- [[plain-link]]
- references [[intro]]
- [[another-plain]]
- extends [[core]]
`

      const nodes = {
        'plain-link': createNode('plain-link'),
        'intro': createNode('intro'),
        'another-plain': createNode('another-plain'),
        'core': createNode('core')
      }

      const result = extractEdges(content, nodes)

      // After removing "- " prefix, if only "-" remains, it becomes empty label
      expect(result).toEqual([
        { targetId: 'plain-link', label: '-' },
        { targetId: 'intro', label: 'references' },
        { targetId: 'another-plain', label: '-' },
        { targetId: 'core', label: 'extends' }
      ] as Edge[])
    })

    it('should extract multi-word relationship labels', () => {
      const content = `This is a child of [[parent]] and builds upon [[foundation]].`

      const nodes = {
        'parent': createNode('parent'),
        'foundation': createNode('foundation')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'parent', label: 'This is a child of' },
        { targetId: 'foundation', label: 'This is a child of [[parent]] and builds upon' }
      ] as Edge[])
    })

    it('should handle bullet list format with relationship labels', () => {
      const content = `
_Links:_
Parent:
- is child of [[parent-node]]

Children:
- has implementation [[child-1]]
- extends functionality [[child-2]]
`

      const nodes = {
        'parent-node': createNode('parent-node'),
        'child-1': createNode('child-1'),
        'child-2': createNode('child-2')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'parent-node', label: 'is child of' },
        { targetId: 'child-1', label: 'has implementation' },
        { targetId: 'child-2', label: 'extends functionality' }
      ] as Edge[])
    })

    it('should trim whitespace from relationship labels', () => {
      const content = `   references   [[node]]  `

      const nodes = {
        'node': createNode('node')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'node', label: 'references' }
      ] as Edge[])
    })

    it('should handle relationship labels with special characters', () => {
      const content = `
- is-a [[type]]
- part_of [[whole]]
- related-to: [[related]]
`

      const nodes = {
        'type': createNode('type'),
        'whole': createNode('whole'),
        'related': createNode('related')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'type', label: 'is-a' },
        { targetId: 'whole', label: 'part_of' },
        { targetId: 'related', label: 'related-to:' }
      ] as Edge[])
    })

    it('should extract only text on same line as relationship label', () => {
      const content = `
This is a long paragraph
that spans multiple lines.
It eventually references [[node-a]].

And then continues with more text.
`

      const nodes = {
        'node-a': createNode('node-a')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'node-a', label: 'It eventually references' }
      ] as Edge[])
    })

    it('should preserve duplicate removal with labeled edges', () => {
      const content = `
- references [[intro]]
- extends [[intro]]
- [[intro]]
`

      const nodes = {
        'intro': createNode('intro')
      }

      const result = extractEdges(content, nodes)

      // Should keep first occurrence with its label
      expect(result).toEqual([
        { targetId: 'intro', label: 'references' }
      ] as Edge[])
    })

    it('should handle empty content', () => {
      const content = ''
      const nodes = {
        'node': createNode('node')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([])
    })

    it('should preserve unresolved links with labels for future node creation', () => {
      const content = `
- references [[existing]]
- extends [[non-existent]]
`

      const nodes = {
        'existing': createNode('existing')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'existing', label: 'references' },
        { targetId: 'non-existent', label: 'extends' }
      ] as Edge[])
    })

    it('should extract label from user markdown format with Parent: section', () => {
      const content = `---
node_id: 5
title: Understand Google Cloud Lambda Creation (5)
---
### Understand the process of creating a Google Cloud Lambda function.

A bit of background on how I can actually create the lambda itself.


-----------------
_Links:_
Parent:
- is_a_prerequisite_for [[3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md]]`

      const nodes = {
        '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation': createNode('3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation', label: 'is_a_prerequisite_for' }
      ] as Edge[])
    })

    it('DEBUGGING: should extract is_a_prerequisite_for label from real user file', () => {
      // This is the EXACT content from the user's file
      const content = `---
node_id: 5
title: Understand Google Cloud Lambda Creation (5)
---
### Understand the process of creating a Google Cloud Lambda function.

A bit of background on how I can actually create the lambda itself.


-----------------
_Links:_
Parent:
- is_a_prerequisite_for [[3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md]]`

      const nodes = {
        '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation': createNode('3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation')
      }

      const result = extractEdges(content, nodes)

      // Log the actual result for debugging
      console.log('ACTUAL RESULT:', JSON.stringify(result, null, 2))

      // This should extract the label, but currently doesn't
      expect(result).toEqual([
        { targetId: '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation', label: 'is_a_prerequisite_for' }
      ] as Edge[])
    })
  })

  describe('integration with path matching', () => {
    it('should extract labels with absolute path wikilinks', () => {
      const content = 'references [[/Users/user/vault/folder/file.md]]'

      const nodes = {
        'folder/file': createNode('folder/file')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'folder/file', label: 'references' }
      ] as Edge[])
    })

    it('should extract labels with relative path wikilinks', () => {
      const content = 'extends [[../other/node.md]]'

      const nodes = {
        'other/node': createNode('other/node')
      }

      const result = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'other/node', label: 'extends' }
      ] as Edge[])
    })
  })
})
