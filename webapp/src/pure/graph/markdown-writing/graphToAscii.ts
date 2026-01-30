/**
 * Pure function to convert a Graph structure into an ASCII tree visualization.
 * Ports the Python `visualize_markdown_tree` logic to TypeScript.
 */

import type { Graph, NodeIdAndFilePath, GraphNode } from '@/pure/graph'
import { reverseGraphEdges } from '@/pure/graph/graph-operations/graph-transformations'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'

/**
 * Converts a Graph into an ASCII tree visualization.
 *
 * The function finds root nodes (nodes with no incoming edges) and recursively
 * prints the tree structure using box-drawing characters.
 *
 * Handles cycles gracefully using a visited set to prevent infinite recursion.
 *
 * @param graph - The graph to visualize
 * @param forcedRootNodeId - Optional node ID to use as the root, regardless of graph structure.
 *                           Useful when the graph has cycles (e.g., after star pattern removal)
 *                           where no natural root exists.
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


export function graphToAscii(graph: Graph, forcedRootNodeId?: NodeIdAndFilePath): string {
  // eslint-disable-next-line functional/prefer-readonly-type
  const lines: string[] = []
  // eslint-disable-next-line functional/prefer-readonly-type
  const visited: Set<string> = new Set<NodeIdAndFilePath>()

  // Determine roots: use forced root if provided, otherwise find natural roots
  const roots: readonly string[] = (() => {
    // If a forced root is provided and exists in the graph, use it
    if (forcedRootNodeId && graph.nodes[forcedRootNodeId]) {
      return [forcedRootNodeId]
    }

    // Find root nodes (nodes with no incoming edges)
    // We reverse the graph to identify which nodes have no incoming edges
    const reversedGraph: Graph = reverseGraphEdges(graph)
    return Object.keys(graph.nodes).filter(nodeId => {
      const reversedNode: GraphNode = reversedGraph.nodes[nodeId]
      return !reversedNode || reversedNode.outgoingEdges.length === 0
    })
  })()

  /**
   * Recursive helper to print tree structure
   */
  function printTree(
    nodeId: NodeIdAndFilePath,
    prefix: string = '',
    isLast: boolean = true,
    isRoot: boolean = true
  ): void {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node: GraphNode = graph.nodes[nodeId]
    if (!node) return // Safety check for missing nodes

    const title: string = getNodeTitle(node)

    // Print current node with connectors
    if (isRoot) {
      lines.push(title)
    } else {
      const connector: "└── " | "├── " = isLast ? '└── ' : '├── '
      lines.push(prefix + connector + title)
    }

    // Print children
    const children: readonly string[] = node.outgoingEdges.map(e => e.targetId)
    children.forEach((childId, index) => {
      const isLastChild: boolean = index === children.length - 1
      const extension: "    " | "│   " = isLast ? '    ' : '│   '
      const childPrefix: string = isRoot ? '' : prefix + extension
      printTree(childId, childPrefix, isLastChild, false)
    })
  }

  // Print all root nodes
  roots.forEach(rootId => printTree(rootId))

  return lines.join('\n')
}

export type GraphToAscii = typeof graphToAscii
