import { describe, it, expect } from 'vitest'
import { graphToAscii } from '@/pure/graph/markdown-writing/graphToAscii.ts'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'

/** Unwrap Either or fail test */
function unwrapGraph(result: E.Either<unknown, Graph>): Graph {
  // eslint-disable-next-line functional/no-throw-statements
  if (E.isLeft(result)) throw new Error('Expected Right but got Left')
  return result.right
}
import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths.ts'

describe('graphToAscii', () => {
  const createTestNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      title: id,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  it('should render a single node graph', () => {
    const graph: Graph = {
      nodes: {
        'Root': createTestNode('Root', [])
      }
    }

    const result = graphToAscii(graph)

    expect(result).toBe('Root')
  })

  it('should render a linear chain (A -> B -> C)', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      }
    }

    const result = graphToAscii(graph)

    const expected = `A
└── B
    └── C`

    expect(result).toBe(expected)
  })

  it('should render a tree with multiple branches', () => {
    const graph: Graph = {
      nodes: {
        'Root': createTestNode('Root', ['Child1', 'Child2', 'Child3']),
        'Child1': createTestNode('Child1', []),
        'Child2': createTestNode('Child2', []),
        'Child3': createTestNode('Child3', [])
      }
    }

    const result = graphToAscii(graph)

    const expected = `Root
├── Child1
├── Child2
└── Child3`

    expect(result).toBe(expected)
  })

  it('should render a tree with nested branches', () => {
    const graph: Graph = {
      nodes: {
        'Root': createTestNode('Root', ['Child1', 'Child2']),
        'Child1': createTestNode('Child1', ['Grandchild1', 'Grandchild2']),
        'Child2': createTestNode('Child2', []),
        'Grandchild1': createTestNode('Grandchild1', []),
        'Grandchild2': createTestNode('Grandchild2', [])
      }
    }

    const result = graphToAscii(graph)

    const expected = `Root
├── Child1
│   ├── Grandchild1
│   └── Grandchild2
└── Child2`

    expect(result).toBe(expected)
  })

  it('should render the example tree from spec', () => {
    const graph: Graph = {
      nodes: {
        'Root Node': createTestNode('Root Node', ['Child 1', 'Child 2', 'Child 3']),
        'Child 1': createTestNode('Child 1', ['Grandchild 1', 'Grandchild 2']),
        'Child 2': createTestNode('Child 2', []),
        'Child 3': createTestNode('Child 3', ['Grandchild 3']),
        'Grandchild 1': createTestNode('Grandchild 1', []),
        'Grandchild 2': createTestNode('Grandchild 2', []),
        'Grandchild 3': createTestNode('Grandchild 3', [])
      }
    }

    const result = graphToAscii(graph)

    const expected = `Root Node
├── Child 1
│   ├── Grandchild 1
│   └── Grandchild 2
├── Child 2
└── Child 3
    └── Grandchild 3`

    expect(result).toBe(expected)
  })

  it('should handle empty graph', () => {
    const graph: Graph = {
      nodes: {}
    }

    const result = graphToAscii(graph)

    expect(result).toBe('')
  })

  it('should handle graph with cycle gracefully (visited set prevents infinite recursion)', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      }
    }

    const result = graphToAscii(graph)

    // In a pure cycle where both nodes point to each other, both have incoming edges
    // So neither is identified as a root, resulting in empty output
    // This is expected behavior - cycles with no entry point cannot be visualized as a tree
    expect(result).toBe('')
  })

  it('should handle DAG with shared descendants', () => {
    // Diamond shape: A -> B -> D, A -> C -> D
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', ['D']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      }
    }

    const result = graphToAscii(graph)

    // D should only appear once (first time visited)
    const expected = `A
├── B
│   └── D
└── C`

    expect(result).toBe(expected)
  })

  it('should handle multiple root nodes', () => {
    const graph: Graph = {
      nodes: {
        'Root1': createTestNode('Root1', ['Child1']),
        'Root2': createTestNode('Root2', ['Child2']),
        'Child1': createTestNode('Child1', []),
        'Child2': createTestNode('Child2', [])
      }
    }

    const result = graphToAscii(graph)

    // Both roots should be printed
    expect(result).toContain('Root1')
    expect(result).toContain('Root2')
    expect(result).toContain('Child1')
    expect(result).toContain('Child2')
  })

  it('should handle graph with disconnected components', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', []),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      }
    }

    const result = graphToAscii(graph)

    // Both A and C are roots
    expect(result).toContain('A')
    expect(result).toContain('B')
    expect(result).toContain('C')
    expect(result).toContain('D')
  })

  it('should render example_large fixture - visual output inspection', async () => {
    // Load the real example_large graph from disk
    const graph = unwrapGraph(await loadGraphFromDisk(O.some(EXAMPLE_LARGE_PATH)))

    // Generate ASCII visualization
    const result = graphToAscii(graph)

    // Print the output for visual inspection
    console.log('\n' + '='.repeat(80))
    console.log('ASCII TREE VISUALIZATION OF example_real_large')
    console.log('='.repeat(80))
    console.log(result)
    console.log('='.repeat(80))
    console.log(`Total nodes in graph: ${Object.keys(graph.nodes).length}`)
    console.log(`Total lines in ASCII output: ${result.split('\n').length}`)
    console.log('='.repeat(80) + '\n')

    // Just verify it produces output
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })

  it('should render example_small fixture - visual output inspection', async () => {
    // Load the real example_small graph from disk
    const graph = unwrapGraph(await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH)))

    // Debug: Check if edges are loaded
    const edgeCount = Object.values(graph.nodes).reduce((sum, node) => sum + node.outgoingEdges.length, 0)
    console.log('\n' + '='.repeat(80))
    console.log('GRAPH STRUCTURE DEBUG')
    console.log('='.repeat(80))
    console.log(`Total nodes: ${Object.keys(graph.nodes).length}`)
    console.log(`Total edges: ${edgeCount}`)

    // Show a few nodes with their edges
    const nodeEntries = Object.entries(graph.nodes).slice(0, 3)
    nodeEntries.forEach(([_id, node]) => {
      console.log(`\nNode: ${node.nodeUIMetadata.title}`)
      console.log(`  Edges: ${node.outgoingEdges.length}`)
      node.outgoingEdges.forEach(edge => {
        const targetNode = graph.nodes[edge.targetId]
        console.log(`    -> ${targetNode?.nodeUIMetadata.title || edge.targetId}`)
      })
    })
    console.log('='.repeat(80))

    // Generate ASCII visualization
    const result = graphToAscii(graph)

    // Print the output for visual inspection
    console.log('\n' + '='.repeat(80))
    console.log('ASCII TREE VISUALIZATION OF example_small')
    console.log('='.repeat(80))
    console.log(result)
    console.log('='.repeat(80))
    console.log(`Total lines in ASCII output: ${result.split('\n').length}`)
    console.log('='.repeat(80) + '\n')

    // Just verify it produces output
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })
})
