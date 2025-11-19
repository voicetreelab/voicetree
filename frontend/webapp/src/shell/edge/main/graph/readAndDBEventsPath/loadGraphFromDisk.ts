import * as fs from 'fs/promises'
import * as path from 'path'
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import type { Graph, NodeId } from '@/pure/graph'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing'
import { extractEdges } from '@/pure/graph/markdown-parsing/extract-edges.ts'
import { enforceFileLimit } from './fileLimitEnforce.ts'
import { setOutgoingEdges, reverseGraphEdges } from '@/pure/graph'
import { applyPositions } from '@/pure/graph/positioning'

/**
 * Loads a graph from the filesystem.
 *
 * IO function: Performs side effects (file I/O) and returns a Promise<Graph>.
 *
 * @param vaultPath - Absolute absolutePath to the vault directory containing markdown files
 * @returns Promise that resolves to a Graph
 *
 * Algorithm:
 * 1. Scan vault directory recursively for .md files
 * 2. Read each file and parse into GraphNode (preliminary, without outgoingEdges)
 * 3. Build final nodes with outgoingEdges extracted from wikilinks in content
 * 4. Return Graph with nodes containing their outgoingEdges
 *
 * @example
 * ```typescript
 * const graph = await loadGraphFromDisk('/absolutePath/to/vault')
 * console.log(`Loaded ${Object.keys(graph.nodes).length} nodes`)
 * ```
 */
export async function loadGraphFromDisk(vaultPath: O.Option<string>): Promise<Graph> {
    if (O.isNone(vaultPath)) {
        return { nodes: {} };
    }

    // Step 1: Scan directory for markdown files
    const files = await scanMarkdownFiles(vaultPath.value)

    // Step 1.5: Enforce file limit (will show error dialog and return Left if exceeded)
    const limitCheck = enforceFileLimit(files.length);
    if (E.isLeft(limitCheck)) {
        // Return empty graph if file limit exceeded
        return { nodes: {} };
    }
    // Step 2: Load preliminary nodes
    const preliminaryNodes = await loadNodes(vaultPath.value, files)

    // Step 3: Build final nodes with outgoingEdges from wikilinks
    const graph : Graph = {nodes : buildNodesWithEdges(preliminaryNodes) };

    // Step 4: Apply positions to all nodes that don't have a position
    return reverseGraphEdges(applyPositions(reverseGraphEdges(graph)));
}

/**
 * Scans vault directory recursively for markdown files.
 *
 * @param vaultPath - Absolute absolutePath to vault directory
 * @returns Array of relative file paths (e.g., ["note.md", "subfolder/other.md"])
 */
async function scanMarkdownFiles(vaultPath: string): Promise<readonly string[]> {
  async function scan(dirPath: string, relativePath = ''): Promise<readonly string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    // Sort entries by name for deterministic ordering
    const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name))

    const results = await Promise.all(
      sortedEntries.map(async (entry) => {
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
 * @param vaultPath - Absolute absolutePath to vault directory
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
    return [node.relativeFilePathIsID, node] as const
  })

  const nodeEntries = await Promise.all(nodePromises)
  return Object.fromEntries(nodeEntries)
}

/**
 * Builds final nodes with outgoingEdges extracted from wikilinks in content.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param nodes - Record of preliminary nodes (may have empty/incorrect outgoingEdges)
 * @returns Record of nodes with correct outgoingEdges populated from wikilinks
 */
function buildNodesWithEdges(
  nodes: Record<NodeId, Graph['nodes'][NodeId]>
): Record<NodeId, Graph['nodes'][NodeId]> {
  const nodeEntries = Object.entries(nodes).map(([nodeId, node]) => {
    // Nodes already have edges extracted (from parseMarkdownToGraphNode)
    // But those edges have raw link text as targetId, not resolved node IDs
    // We need to re-extract and validate them against the full graph
    const validatedEdges = extractEdges(node.content, nodes)
    const nodeWithValidatedEdges = setOutgoingEdges(node, validatedEdges)
     // todo, we want to do this progressively, so this function will no longer be necessary,
     // todo never want temporal state, adding a collection of single node is same as adding a whole graph
     // this will be done by keeping all edges for nodes, even if they aren't yet pointing to any existing node
     // and
     // don't delete the comment, remove it to relevant new code as explanation.

     // here's the reasoning that led to this:

     // system, should clarify file event hook for upsert (has graph), versus initial load. WAIT WE DON’T need this. if an upsert has an incoming edge to it, we validate it. (upsert, graph) -> upsert. (o(1) with index. hmm but may as  well just do (graph-> graph)? the difference is we can validate as we go, don’t have to do it at a specific moment in time (temporally stateful!!).  but do we want edges to nodes that don’t exist yet in graph? create node after initial. yes. delete node, yes. we really really don’t want a difference between initial load, and subsequent fs events. anyway,
    return [nodeId, nodeWithValidatedEdges] as const
  })

  return Object.fromEntries(nodeEntries)
}
