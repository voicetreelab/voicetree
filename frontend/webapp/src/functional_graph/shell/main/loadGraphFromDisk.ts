import * as fs from 'fs/promises'
import * as path from 'path'
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import type { Graph, NodeId } from '@/functional_graph/pure/types'
import { parseMarkdownToGraphNode } from '@/functional_graph/pure/markdown_parsing/parse-markdown-to-node'
import { extractLinkedNodeIds } from '@/functional_graph/pure/markdown_parsing/extract-linked-node-ids'
import { enforceFileLimit } from './fileLimitEnforce'

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
 * 2. Read each file and parse into Node (preliminary, without outgoingEdges)
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
    const nodesWithEdges = buildNodesWithEdges(preliminaryNodes)

    return { nodes: nodesWithEdges }
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
 * @param vaultPath - Absolute absolutePath to vault directory
 * @param files - Array of relative file paths
 * @returns Record mapping node ID to Node
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
    const outgoingEdges = extractLinkedNodeIds(node.content, nodes)
    const nodeWithEdges = { ...node, outgoingEdges }
    return [nodeId, nodeWithEdges] as const
  })

  return Object.fromEntries(nodeEntries)
}
