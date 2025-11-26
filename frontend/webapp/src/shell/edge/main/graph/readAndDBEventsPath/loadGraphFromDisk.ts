import * as fs from 'fs/promises'
import * as path from 'path'
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import type { Graph, FSUpdate } from '@/pure/graph'
import { enforceFileLimit, type FileLimitExceededError } from './fileLimitEnforce'
import { applyPositions } from '@/pure/graph/positioning'
import { addNodeToGraph } from '@/pure/graph/graphDelta/addNodeToGraph'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'

/**
 * Loads a graph from the filesystem using progressive edge validation.
 *
 * IO function: Performs side effects (file I/O) and returns a Promise<Graph>.
 *
 * Algorithm (progressive, order-independent):
 * 1. Scan vault directory recursively for .md files
 * 2. For each file, progressively add to graph using addNodeToGraph
 *    - Validates outgoing edges from new node
 *    - Heals incoming edges to new node (bidirectional validation)
 * 3. Apply positions to all nodes that don't have a position
 * 4. Return Graph with all edges correctly resolved
 *
 * Key property: Loading [A,B,C] produces same result as [C,B,A] (order-independent)
 *
 * @param vaultPath - Absolute path to the vault directory containing markdown files
 * @returns Promise that resolves to a Graph
 *
 * @example
 * ```typescript
 * const graph = await loadGraphFromDisk(O.some('/path/to/vault'))
 * console.log(`Loaded ${Object.keys(graph.nodes).length} nodes`)
 * ```
 */
export async function loadGraphFromDisk(vaultPath: O.Option<string>): Promise<E.Either<FileLimitExceededError, Graph>> {
    if (O.isNone(vaultPath)) {
        return E.right({ nodes: {} });
    }

    // Step 1: Scan directory for markdown files
    const files: readonly string[] = await scanMarkdownFiles(vaultPath.value)

    // Step 1.5: Enforce file limit (will show error dialog and return Left if exceeded)
    const limitCheck: E.Either<FileLimitExceededError, void> = enforceFileLimit(files.length);
    if (E.isLeft(limitCheck)) {
        return E.left(limitCheck.left);
    }

    // Step 2: Progressively build graph by adding nodes one at a time
    // Each addition validates edges and heals incoming edges (order-independent)
    const graph: Graph = await files.reduce(
        async (graphPromise, file) => {
            const currentGraph: Graph = await graphPromise
            const fullPath: string = path.join(vaultPath.value, file)
            const content: string = await fs.readFile(fullPath, 'utf-8')

            const fsEvent: FSUpdate = {
                absolutePath: fullPath,
                content,
                eventType: 'Added'
            }

            // Use unified function (same as incremental!)
            const delta: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphDelta = addNodeToGraph(fsEvent, vaultPath.value, currentGraph)
            return applyGraphDeltaToGraph(currentGraph, delta)
        },
        Promise.resolve({ nodes: {} } as Graph)
    )

    // Step 3: Apply positions to all nodes that don't have a position
    return E.right(applyPositions(graph));
}

/**
 * Scans vault directory recursively for markdown files.
 *
 * @param vaultPath - Absolute absolutePath to vault directory
 * @returns Array of relative file paths (e.g., ["note.md", "subfolder/other.md"])
 */
async function scanMarkdownFiles(vaultPath: string): Promise<readonly string[]> {
  async function scan(dirPath: string, relativePath = ''): Promise<readonly string[]> {
    const entries: import("fs").Dirent<string>[] = await fs.readdir(dirPath, { withFileTypes: true })

    // Sort entries by name for deterministic ordering
    const sortedEntries: import("fs").Dirent<string>[] = entries.sort((a, b) => a.name.localeCompare(b.name))

    const results: (readonly string[])[] = await Promise.all(
      sortedEntries.map(async (entry) => {
        const fullPath: string = path.join(dirPath, entry.name)
        const relPath: string = relativePath ? path.join(relativePath, entry.name) : entry.name

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

