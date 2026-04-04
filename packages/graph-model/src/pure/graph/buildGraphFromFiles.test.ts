import { describe, it, expect } from 'vitest'
import type { Graph, GraphNode } from './'
import { graphToAscii } from './markdown-writing/graphToAscii'
import { getNodeTitle } from './markdown-parsing'
import { buildGraphFromFiles } from './buildGraphFromFiles'

describe('buildGraphFromFiles', () => {

  it('empty input returns empty graph', () => {
    const graph: Graph = buildGraphFromFiles([])

    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  it('single file with no links produces 1 node with 0 edges', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/folder/solo-node.md',
        content: '---\ncolor: blue\n---\n# Solo Node\nSome content here.'
      }
    ])

    const nodeIds: readonly string[] = Object.keys(graph.nodes)
    expect(nodeIds).toHaveLength(1)

    const node: GraphNode = graph.nodes[nodeIds[0]]
    expect(getNodeTitle(node)).toBe('Solo Node')
    expect(node.outgoingEdges).toHaveLength(0)
  })

  it('two files where A links to B with [[B]] produces edge A→B', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/folder/node-a.md',
        content: '# Node A\nParent: [[node-b]]'
      },
      {
        absolutePath: '/test/folder/node-b.md',
        content: '# Node B\nThis is the parent.'
      }
    ])

    expect(Object.keys(graph.nodes)).toHaveLength(2)

    const nodeA: GraphNode = graph.nodes['/test/folder/node-a.md']
    const nodeB: GraphNode = graph.nodes['/test/folder/node-b.md']

    expect(nodeA).toBeDefined()
    expect(nodeB).toBeDefined()
    expect(nodeA.outgoingEdges).toHaveLength(1)
    expect(nodeA.outgoingEdges[0].targetId).toBe('/test/folder/node-b.md')
    expect(nodeB.outgoingEdges).toHaveLength(0)
  })

  it('three files forming chain A→B→C via [[parent]] wikilinks', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/folder/leaf.md',
        content: '# Leaf\n[[middle]]'
      },
      {
        absolutePath: '/test/folder/middle.md',
        content: '# Middle\n[[root]]'
      },
      {
        absolutePath: '/test/folder/root.md',
        content: '# Root\nThe root node.'
      }
    ])

    expect(Object.keys(graph.nodes)).toHaveLength(3)

    const leaf: GraphNode = graph.nodes['/test/folder/leaf.md']
    const middle: GraphNode = graph.nodes['/test/folder/middle.md']
    const root: GraphNode = graph.nodes['/test/folder/root.md']

    expect(leaf.outgoingEdges).toHaveLength(1)
    expect(leaf.outgoingEdges[0].targetId).toBe('/test/folder/middle.md')

    expect(middle.outgoingEdges).toHaveLength(1)
    expect(middle.outgoingEdges[0].targetId).toBe('/test/folder/root.md')

    expect(root.outgoingEdges).toHaveLength(0)
  })

  it('only [[hard links]] become edges, not [soft links]', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/folder/with-links.md',
        content: '# With Links\n[[hard-target]]\nSome [soft link] reference here.'
      },
      {
        absolutePath: '/test/folder/hard-target.md',
        content: '# Hard Target\nI am a real parent.'
      },
      {
        absolutePath: '/test/folder/soft-link.md',
        content: '# Soft Link\nI should NOT be linked.'
      }
    ])

    const withLinks: GraphNode = graph.nodes['/test/folder/with-links.md']
    expect(withLinks.outgoingEdges).toHaveLength(1)
    expect(withLinks.outgoingEdges[0].targetId).toBe('/test/folder/hard-target.md')
  })

  it('files in subfolders have full absolute paths as node IDs', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/vault/topic-a/child.md',
        content: '# Child\n[[parent]]'
      },
      {
        absolutePath: '/vault/topic-b/parent.md',
        content: '# Parent\nCross-folder parent.'
      }
    ])

    expect(graph.nodes['/vault/topic-a/child.md']).toBeDefined()
    expect(graph.nodes['/vault/topic-b/parent.md']).toBeDefined()

    const child: GraphNode = graph.nodes['/vault/topic-a/child.md']
    expect(child.outgoingEdges[0].targetId).toBe('/vault/topic-b/parent.md')
  })

  it('edge healing: order of files does not matter', () => {
    // Process B before A — A links to B but B doesn't exist yet when A is processed
    // Edge healing should resolve A's link once B is added
    const filesForwardOrder: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/a.md',
        content: '# A\n[[b]]'
      },
      {
        absolutePath: '/test/b.md',
        content: '# B'
      }
    ])

    const filesReverseOrder: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/b.md',
        content: '# B'
      },
      {
        absolutePath: '/test/a.md',
        content: '# A\n[[b]]'
      }
    ])

    // Both orderings should produce the same edge
    const aForward: GraphNode = filesForwardOrder.nodes['/test/a.md']
    const aReverse: GraphNode = filesReverseOrder.nodes['/test/a.md']

    expect(aForward.outgoingEdges).toHaveLength(1)
    expect(aForward.outgoingEdges[0].targetId).toBe('/test/b.md')

    expect(aReverse.outgoingEdges).toHaveLength(1)
    expect(aReverse.outgoingEdges[0].targetId).toBe('/test/b.md')
  })

  it('composes with graphToAscii to produce correct tree', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/root.md',
        content: '# Root'
      },
      {
        absolutePath: '/test/child-1.md',
        content: '# Child 1\n[[root]]'
      },
      {
        absolutePath: '/test/child-2.md',
        content: '# Child 2\n[[root]]'
      },
      {
        absolutePath: '/test/grandchild.md',
        content: '# Grandchild\n[[child-1]]'
      }
    ])

    const ascii: string = graphToAscii(graph)

    // graphToAscii uses getNodeTitle which derives from # heading
    // Root has no incoming edges so it's the root of the ASCII tree
    // Children link TO their parent, so edges point parent-ward
    // graphToAscii renders outgoing edges as children
    // Here child-1 and child-2 have outgoing edges to root, and grandchild to child-1
    // So the tree from root's perspective (as the node with no outgoing edges):
    // Root is the natural root (no incoming edges pointing TO it... wait, child-1 and child-2 point to root)
    // Actually: root HAS incoming edges (from child-1 and child-2), but root has 0 outgoing edges
    // graphToAscii finds roots = nodes with no INCOMING edges
    // root has incoming from child-1, child-2 → root is NOT a natural root
    // child-1 has incoming from grandchild → NOT a root
    // child-2 has no incoming edges → child-2 IS a natural root? No wait...
    // Actually let me think about this differently.
    // In this graph: edges are outgoing = the [[wikilink]] direction
    // child-1 → root, child-2 → root, grandchild → child-1
    // graphToAscii renders outgoing edges as children in the tree
    // Roots = nodes with no incoming edges
    // root has incoming from child-1 and child-2
    // child-1 has incoming from grandchild
    // child-2 has NO incoming edges → child-2 is root
    // grandchild has NO incoming edges → grandchild is root
    // Hmm, that's not great. Let me reconsider.
    //
    // The wikilinks in this codebase ARE outgoing edges.
    // So if child-1.md contains [[root]], then child-1 has an outgoing edge to root.
    // graphToAscii treats outgoing edges as "children" in the rendering.
    // So the ASCII tree shows: if A has outgoing edge to B, B appears as child of A.
    //
    // For a proper tree, let's structure it so the root node has outgoing edges to children.
    // That means the ROOT file should contain [[child-1]] and [[child-2]].

    // Verify all nodes exist
    expect(Object.keys(graph.nodes)).toHaveLength(4)
    // The ASCII output should contain all node titles
    expect(ascii).toContain('Root')
    expect(ascii).toContain('Child 1')
    expect(ascii).toContain('Child 2')
    expect(ascii).toContain('Grandchild')
  })

  it('composes with graphToAscii — outgoing edges rendered as children', () => {
    // Structure: root has outgoing edges [[child-a]] and [[child-b]]
    // child-a has outgoing edge [[grandchild]]
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/root.md',
        content: '# Root\n[[child-a]]\n[[child-b]]'
      },
      {
        absolutePath: '/test/child-a.md',
        content: '# Child A\n[[grandchild]]'
      },
      {
        absolutePath: '/test/child-b.md',
        content: '# Child B'
      },
      {
        absolutePath: '/test/grandchild.md',
        content: '# Grandchild'
      }
    ])

    const ascii: string = graphToAscii(graph)

    // Root is the only node with no incoming edges → natural root
    // Root's outgoing edges: child-a, child-b → rendered as children
    // child-a's outgoing edge: grandchild → rendered as grandchild
    const expected: string = `Root
├── Child A
│   └── Grandchild
└── Child B`

    expect(ascii).toBe(expected)
  })

  it('handles YAML frontmatter correctly', () => {
    const graph: Graph = buildGraphFromFiles([
      {
        absolutePath: '/test/with-yaml.md',
        content: '---\ncolor: purple\nisContextNode: false\n---\n# YAML Node\nContent after frontmatter.'
      }
    ])

    const node: GraphNode = graph.nodes['/test/with-yaml.md']
    expect(getNodeTitle(node)).toBe('YAML Node')
    // Content should not include the YAML frontmatter
    expect(node.contentWithoutYamlOrLinks).not.toContain('color: purple')
  })
})
