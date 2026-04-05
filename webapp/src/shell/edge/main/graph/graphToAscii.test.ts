import { describe, it, expect } from 'vitest'
import { graphToAscii } from '@vt/graph-model/pure/graph/markdown-writing/graphToAscii'
import type { Graph, GraphNode } from '@vt/graph-model/pure/graph'
import { createGraph, createEmptyGraph } from '@vt/graph-model/pure/graph/createGraph'
import { getNodeTitle } from '@vt/graph-model/pure/graph/markdown-parsing'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'

describe('graphToAscii', () => {
  // Title is derived from content, so use # heading to set the title
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    absoluteFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `# ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  it('should render a single node graph', () => {
    const graph: Graph = createGraph({ 'Root': createTestNode('Root', []) })
    expect(graphToAscii(graph)).toBe('Root')
  })

  it('should render a linear chain (A -> B -> C)', () => {
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['B']),
      'B': createTestNode('B', ['C']),
      'C': createTestNode('C', [])
    })
    expect(graphToAscii(graph)).toBe('A\n└── B\n    └── C')
  })

  it('should render trees with multiple and nested branches', () => {
    const graph: Graph = createGraph({
      'Root': createTestNode('Root', ['Child1', 'Child2', 'Child3']),
      'Child1': createTestNode('Child1', ['Grandchild1', 'Grandchild2']),
      'Child2': createTestNode('Child2', []),
      'Child3': createTestNode('Child3', ['Grandchild3']),
      'Grandchild1': createTestNode('Grandchild1', []),
      'Grandchild2': createTestNode('Grandchild2', []),
      'Grandchild3': createTestNode('Grandchild3', [])
    })

    const expected: string = `Root
├── Child1
│   ├── Grandchild1
│   └── Grandchild2
├── Child2
└── Child3
    └── Grandchild3`
    expect(graphToAscii(graph)).toBe(expected)
  })

  it('should handle empty graph', () => {
    expect(graphToAscii(createEmptyGraph())).toBe('')
  })

  it('should handle graph with cycle gracefully (visited set prevents infinite recursion)', () => {
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['B']),
      'B': createTestNode('B', ['A'])
    })
    // In a pure cycle, neither node is a natural root — empty output
    expect(graphToAscii(graph)).toBe('')
  })

  it('should use forcedRootNodeId as root for cycles (star pattern fix)', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      }
    }

    expect(graphToAscii(graph)).toBe('')
    expect(graphToAscii(graph, 'A')).toBe('A\n└── B')
    expect(graphToAscii(graph, 'B')).toBe('B\n└── A')
  })

  it('should ignore forcedRootNodeId if node does not exist in graph', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      }
    }
    expect(graphToAscii(graph, 'NonExistent')).toBe('A\n└── B')
  })

  it('should handle DAG with shared descendants', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', ['D']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      }
    }

    const expected: string = `A
├── B
│   └── D
└── C`
    expect(graphToAscii(graph)).toBe(expected)
  })

  it('should handle multiple roots and disconnected components', () => {
    const graph: Graph = {
      nodes: {
        'Root1': createTestNode('Root1', ['Child1']),
        'Root2': createTestNode('Root2', ['Child2']),
        'Child1': createTestNode('Child1', []),
        'Child2': createTestNode('Child2', [])
      }
    }

    const result: string = graphToAscii(graph)
    expect(result).toContain('Root1')
    expect(result).toContain('Root2')
    expect(result).toContain('Child1')
    expect(result).toContain('Child2')
  })

  it('should render example_large fixture - visual output inspection', async () => {
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([EXAMPLE_LARGE_PATH])
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right

    const result: string = graphToAscii(graph)
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })

  it('should render example_small fixture - visual output inspection', async () => {
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([EXAMPLE_SMALL_PATH])
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right

    const edgeCount: number = Object.values(graph.nodes).reduce((sum, node: GraphNode) => sum + node.outgoingEdges.length, 0)
    console.log(`Total nodes: ${Object.keys(graph.nodes).length}, Total edges: ${edgeCount}`)

    const nodeEntries: readonly (readonly [string, GraphNode])[] = Object.entries(graph.nodes).slice(0, 3)
    nodeEntries.forEach(([_id, node]: readonly [string, GraphNode]) => {
      console.log(`Node: ${getNodeTitle(node)}, Edges: ${node.outgoingEdges.length}`)
    })

    const result: string = graphToAscii(graph)
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })
})
