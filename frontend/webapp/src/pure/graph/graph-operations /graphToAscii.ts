/**
 * Pure function to convert a Graph structure into an ASCII tree visualization.
 * Ports the Python `visualize_markdown_tree` logic to TypeScript.
 */

import type { Graph, NodeId } from '@/pure/graph'
import { reverseGraphEdges } from './graph-transformations.ts'

/**
 * Converts a Graph into an ASCII tree visualization.
 *
 * The function finds root nodes (nodes with no incoming edges) and recursively
 * prints the tree structure using box-drawing characters.
 *
 * Handles cycles gracefully using a visited set to prevent infinite recursion.
 *
 * @param graph - The graph to visualize
 * @returns Multi-line ASCII string with tree structure
 *
 * @example
 * ```
 * Root Node
 * ├── Child 1
 * │   ├── Grandchild 1
 * │   └── Grandchild 2
 * ├── Child 2
 * └── Child 3
 *     └── Grandchild 3
 * ```
 */


export function graphToAscii(graph: Graph): string {
  const lines: string[] = []
  const visited = new Set<NodeId>()

  // Find root nodes (nodes with no incoming edges)
  // We reverse the graph to identify which nodes have no incoming edges
  const reversedGraph = reverseGraphEdges(graph)
  const roots = Object.keys(graph.nodes).filter(nodeId => {
    const reversedNode = reversedGraph.nodes[nodeId]
    return !reversedNode || reversedNode.outgoingEdges.length === 0
  })

  /**
   * Recursive helper to print tree structure
   */
  function printTree(
    nodeId: NodeId,
    prefix: string = '',
    isLast: boolean = true,
    isRoot: boolean = true
  ): void {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node = graph.nodes[nodeId]
    if (!node) return // Safety check for missing nodes

    const title = node.nodeUIMetadata.title

    // Print current node with connectors
    if (isRoot) {
      lines.push(title)
    } else {
      const connector = isLast ? '└── ' : '├── '
      lines.push(prefix + connector + title)
    }

    // Print children
    const children = node.outgoingEdges.map(e => e.targetId)
    children.forEach((childId, index) => {
      const isLastChild = index === children.length - 1
      const extension = isLast ? '    ' : '│   '
      const childPrefix = isRoot ? '' : prefix + extension
      printTree(childId, childPrefix, isLastChild, false)
    })
  }

  // Print all root nodes
  roots.forEach(rootId => printTree(rootId))

  return lines.join('\n')
}

export type GraphToAscii = typeof graphToAscii
