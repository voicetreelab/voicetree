import { describe, expect, test } from 'vitest'
import type { GraphNode } from '@vt/graph-model'
import { createEmptyGraph, parseMarkdownToGraphNode } from '@vt/graph-model'
import {
  identitiesMatch,
  identityOfAddedMarkdown,
  identityOfNode,
  type MoveIdentity,
} from './moveIdentity.ts'

const nodeWith = (kind: GraphNode['kind'], contentWithoutYamlOrLinks: string): GraphNode =>
  ({ kind, contentWithoutYamlOrLinks } as GraphNode)

describe('identitiesMatch', () => {
  test('equal kind + content match', () => {
    const a: MoveIdentity = { kind: 'leaf', contentWithoutYamlOrLinks: '# Title\nbody' }
    const b: MoveIdentity = { kind: 'leaf', contentWithoutYamlOrLinks: '# Title\nbody' }
    expect(identitiesMatch(a, b)).toBe(true)
  })

  test('different content does not match', () => {
    const a: MoveIdentity = { kind: 'leaf', contentWithoutYamlOrLinks: 'one' }
    const b: MoveIdentity = { kind: 'leaf', contentWithoutYamlOrLinks: 'two' }
    expect(identitiesMatch(a, b)).toBe(false)
  })

  test('different kind does not match', () => {
    const a: MoveIdentity = { kind: 'leaf', contentWithoutYamlOrLinks: 'x' }
    const b: MoveIdentity = { kind: 'folder', contentWithoutYamlOrLinks: 'x' }
    expect(identitiesMatch(a, b)).toBe(false)
  })
})

describe('identityOfAddedMarkdown', () => {
  test('strips YAML frontmatter and wikilink syntax', () => {
    const content = '---\ncolor: blue\n---\n# Heading\nSee [[other-note]] here.\n'
    expect(identityOfAddedMarkdown(content, '/p/note.md')).toEqual({
      kind: 'leaf',
      contentWithoutYamlOrLinks: '# Heading\nSee [other-note]* here.\n',
    })
  })

  /**
   * The load-bearing invariant: the identity computed from raw file content on
   * the add side must equal the identity of the node parseMarkdownToGraphNode
   * produces from the same content — otherwise a real move would never be
   * recognised as the same node.
   */
  test('matches identityOfNode(parseMarkdownToGraphNode(content)) for the same content', () => {
    const content = '---\nagent_name: Emi\n---\n# Note\nA paragraph with a [[link-target]] inside.\n'
    const node: GraphNode = parseMarkdownToGraphNode(content, '/p/note.md', createEmptyGraph())
    expect(identitiesMatch(identityOfNode(node), identityOfAddedMarkdown(content, '/p/note.md'))).toBe(true)
  })
})

describe('identityOfNode', () => {
  test('reads kind and contentWithoutYamlOrLinks from the node', () => {
    expect(identityOfNode(nodeWith('leaf', 'hello'))).toEqual({
      kind: 'leaf',
      contentWithoutYamlOrLinks: 'hello',
    })
  })
})
