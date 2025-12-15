import { describe, it, expect } from 'vitest'
import { graphToAscii } from '@/pure/graph/markdown-writing/graphToAscii'
import type { Graph, GraphNode } from '@/pure/graph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'

describe('graphToAscii', () => {
  // Title is derived from content, so use # heading to set the title
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
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
    const graph: Graph = {
      nodes: {
        'Root': createTestNode('Root', [])
      }
    }

    const result: string = graphToAscii(graph)

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

    const result: string = graphToAscii(graph)

    const expected: "A\n└── B\n    └── C" = `A
└── B
    └── C`

    expect(result).toBe(expected)
  })

  it('should render trees with multiple and nested branches', () => {
    // Test both multiple children and nested grandchildren
    const graph: Graph = {
      nodes: {
        'Root': createTestNode('Root', ['Child1', 'Child2', 'Child3']),
        'Child1': createTestNode('Child1', ['Grandchild1', 'Grandchild2']),
        'Child2': createTestNode('Child2', []),
        'Child3': createTestNode('Child3', ['Grandchild3']),
        'Grandchild1': createTestNode('Grandchild1', []),
        'Grandchild2': createTestNode('Grandchild2', []),
        'Grandchild3': createTestNode('Grandchild3', [])
      }
    }

    const result: string = graphToAscii(graph)

    const expected: "Root\n├── Child1\n│   ├── Grandchild1\n│   └── Grandchild2\n├── Child2\n└── Child3\n    └── Grandchild3" = `Root
├── Child1
│   ├── Grandchild1
│   └── Grandchild2
├── Child2
└── Child3
    └── Grandchild3`

    expect(result).toBe(expected)
  })

  it('should handle empty graph', () => {
    const graph: Graph = {
      nodes: {}
    }

    const result: string = graphToAscii(graph)

    expect(result).toBe('')
  })

  it('should handle graph with cycle gracefully (visited set prevents infinite recursion)', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      }
    }

    const result: string = graphToAscii(graph)

    // In a pure cycle where both nodes point to each other, both have incoming edges
    // So neither is identified as a root, resulting in empty output
    // This is expected behavior - cycles with no entry point cannot be visualized as a tree
    expect(result).toBe('')
  })

  it('should use forcedRootNodeId as root for cycles (star pattern fix)', () => {
    // This simulates the star pattern after context node removal:
    // A -> ContextNode <- B becomes A <-> B (bidirectional)
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      }
    }

    // Without forced root: empty (no natural roots)
    expect(graphToAscii(graph)).toBe('')

    // With forced root A: should show A as root with B as child
    const resultA: string = graphToAscii(graph, 'A')
    expect(resultA).toBe('A\n└── B')

    // With forced root B: should show B as root with A as child
    const resultB: string = graphToAscii(graph, 'B')
    expect(resultB).toBe('B\n└── A')
  })

  it('should ignore forcedRootNodeId if node does not exist in graph', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      }
    }

    // Forced root that doesn't exist should fall back to natural root detection
    const result: string = graphToAscii(graph, 'NonExistent')
    expect(result).toBe('A\n└── B')
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

    const result: string = graphToAscii(graph)

    // D should only appear once (first time visited)
    const expected: "A\n├── B\n│   └── D\n└── C" = `A
├── B
│   └── D
└── C`

    expect(result).toBe(expected)
  })

  it('should handle multiple roots and disconnected components', () => {
    // Graph with two disconnected trees
    const graph: Graph = {
      nodes: {
        'Root1': createTestNode('Root1', ['Child1']),
        'Root2': createTestNode('Root2', ['Child2']),
        'Child1': createTestNode('Child1', []),
        'Child2': createTestNode('Child2', [])
      }
    }

    const result: string = graphToAscii(graph)

    // All nodes from both disconnected components should appear
    expect(result).toContain('Root1')
    expect(result).toContain('Root2')
    expect(result).toContain('Child1')
    expect(result).toContain('Child2')
  })

  it('should render example_large fixture - visual output inspection', async () => {
    // Load the real example_large graph from disk
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(EXAMPLE_LARGE_PATH), O.some(EXAMPLE_LARGE_PATH))
    // eslint-disable-next-line functional/no-throw-statements
    if (E.isLeft(loadResult)) throw new Error('Expected Right')
    const graph: Graph = loadResult.right

    // Generate ASCII visualization
    const result: string = graphToAscii(graph)

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
    const loadResult2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(EXAMPLE_SMALL_PATH), O.some(EXAMPLE_SMALL_PATH))
    // eslint-disable-next-line functional/no-throw-statements
    if (E.isLeft(loadResult2)) throw new Error('Expected Right')
    const graph: Graph = loadResult2.right

    // Debug: Check if edges are loaded
    const edgeCount: number = Object.values(graph.nodes).reduce((sum, node: GraphNode) => sum + node.outgoingEdges.length, 0)
    console.log('\n' + '='.repeat(80))
    console.log('GRAPH STRUCTURE DEBUG')
    console.log('='.repeat(80))
    console.log(`Total nodes: ${Object.keys(graph.nodes).length}`)
    console.log(`Total edges: ${edgeCount}`)

    // Show a few nodes with their edges
    const nodeEntries: readonly (readonly [string, GraphNode])[] = Object.entries(graph.nodes).slice(0, 3)
    nodeEntries.forEach(([_id, node]: readonly [string, GraphNode]) => {
      console.log(`\nNode: ${getNodeTitle(node)}`)
      console.log(`  Edges: ${node.outgoingEdges.length}`)
      node.outgoingEdges.forEach((edge: { readonly targetId: string }) => {
        const targetNode: GraphNode = graph.nodes[edge.targetId]
        console.log(`    -> ${targetNode ? getNodeTitle(targetNode) : edge.targetId}`)
      })
    })
    console.log('='.repeat(80))

    // Generate ASCII visualization
    const result: string = graphToAscii(graph)

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
