import * as fs from 'fs/promises'
import * as path from 'path'
import type { Graph, NodeId } from '@/functional_graph/pure/types.ts'
import { parseMarkdownToGraphNode } from '@/functional_graph/pure/markdown_parsing/parse-markdown-to-node.ts'
import { extractLinkedNodeIds } from '@/functional_graph/pure/markdown_parsing/extract-linked-node-ids.ts'

/**
 * Loads a graph from the filesystem.
 *
 * IO function: Wraps side effects (file I/O) in a function that returns a Promise.
 * The function itself is pure - calling it returns the same IO effect for the same input.
 * Only when the returned function is executed (called) do side effects occur.
 *
 * @param vaultPath - Absolute path to the vault directory containing markdown files
 * @returns IO effect that, when executed, produces a Graph
 *
 * Algorithm:
 * 1. Scan vault directory recursively for .md files
 * 2. Read each file and parse into GraphNode
 * 3. Build adjacency list by extracting wikilinks from each node
 * 4. Return Graph with nodes and edges
 *
 * @example
 * ```typescript
 * // Creating the IO effect (pure, no side effects)
 * const loadGraph = loadGraphFromDisk('/path/to/vault')
 *
 * // Executing the IO effect (triggers file I/O)
 * const graph = await loadGraph()
 * console.log(`Loaded ${Object.keys(graph.nodes).length} nodes`)
 * ```
 */
export function loadGraphFromDisk(vaultPath: string): () => Promise<Graph> {
  return async () => {
    // Step 1: Scan directory for markdown files
    const files = await scanMarkdownFiles(vaultPath)

    // Step 2: Load all nodes
    const nodes = await loadNodes(vaultPath, files)

    // Step 3: Build edges from wikilinks
    const edges = buildEdges(nodes)

    return { nodes, edges }
  }
}

/**
 * Scans vault directory recursively for markdown files.
 *
 * @param vaultPath - Absolute path to vault directory
 * @returns Array of relative file paths (e.g., ["note.md", "subfolder/other.md"])
 */
async function scanMarkdownFiles(vaultPath: string): Promise<readonly string[]> {
  async function scan(dirPath: string, relativePath = ''): Promise<readonly string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    const results = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name)
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name

        if (entry.isDirectory()) {
          return scan(fullPath, relPath)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          return [relPath]
        }
        return []
      })
    )

    return results.flat()
  }

  return scan(vaultPath)
}

/**
 * Loads all markdown files into GraphNodes.
 *
 * @param vaultPath - Absolute path to vault directory
 * @param files - Array of relative file paths
 * @returns Record mapping node ID to GraphNode
 */
async function loadNodes(
  vaultPath: string,
  files: readonly string[]
): Promise<Record<NodeId, Graph['nodes'][NodeId]>> {
  const nodePromises = files.map(async (file) => {
    const fullPath = path.join(vaultPath, file)
    const content = await fs.readFile(fullPath, 'utf-8')
    const node = parseMarkdownToGraphNode(content, file)
    return [node.id, node] as const
  })

  const nodeEntries = await Promise.all(nodePromises)
  return Object.fromEntries(nodeEntries)
}

/**
 * Builds adjacency list from wikilinks in node content.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param nodes - Record of all nodes
 * @returns Adjacency list mapping node ID to array of linked node IDs
 */
function buildEdges(nodes: Record<NodeId, Graph['nodes'][NodeId]>): Graph['edges'] {
  const edgeEntries = Object.entries(nodes).map(([nodeId, node]) => {
    const linkedIds = extractLinkedNodeIds(node.content, nodes)
    return [nodeId, linkedIds] as const
  })

  return Object.fromEntries(edgeEntries)
}
