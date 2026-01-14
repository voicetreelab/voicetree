import * as fs from 'fs/promises'
import * as path from 'path'
import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import type { Graph, FSUpdate, GraphDelta } from '@/pure/graph'
import type { Dirent } from 'fs'
import { enforceFileLimit, type FileLimitExceededError } from './fileLimitEnforce'
import { applyPositions } from '@/pure/graph/positioning'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'

/**
 * Loads a graph from the filesystem using progressive edge validation.
 *
 * IO function: Performs side effects (file I/O) and returns a Promise<Graph>.
 *
 * Algorithm (progressive, order-independent):
 * 1. Scan all vault directories recursively for .md files
 * 2. For each file, progressively add to graph using addNodeToGraph
 *    - Validates outgoing edges from new node
 *    - Heals incoming edges to new node (bidirectional validation)
 * 3. Apply positions to all nodes that don't have a position
 * 4. Return Graph with all edges correctly resolved
 *
 * Key property: Loading [A,B,C] produces same result as [C,B,A] (order-independent)
 *
 * @param vaultPaths - Array of absolute paths to vault directories containing markdown files
 * @param watchedDirectory - Absolute path used as base for computing node IDs.
 * @returns Promise that resolves to a Graph
 *
 * @example
 * ```typescript
 * const graph = await loadGraphFromDisk(['/path/to/vault', '/path/to/openspec'], '/path/to')
 * console.log(`Loaded ${Object.keys(graph.nodes).length} nodes`)
 * ```
 */
export async function loadGraphFromDisk(
    vaultPaths: readonly string[],
    watchedDirectory: string
): Promise<E.Either<FileLimitExceededError, Graph>> {
    if (vaultPaths.length === 0) {
        return E.right({ nodes: {} });
    }

    // Step 1: Scan all vault directories for markdown files
    // Each file is stored with its vault path for correct absolute path resolution
    const allFiles: readonly { vaultPath: string; relativePath: string }[] = (
        await Promise.all(
            vaultPaths.map(async (vaultPath) => {
                const files: readonly string[] = await scanMarkdownFiles(vaultPath);
                return files.map(relativePath => ({ vaultPath, relativePath }));
            })
        )
    ).flat();

    // Step 1.5: Enforce file limit (will show error dialog and return Left if exceeded)
    const limitCheck: E.Either<FileLimitExceededError, void> = enforceFileLimit(allFiles.length);
    if (E.isLeft(limitCheck)) {
        return E.left(limitCheck.left);
    }

    // Step 2: Progressively build graph by adding nodes one at a time
    // Each addition validates edges and heals incoming edges (order-independent)
    const graph: Graph = await allFiles.reduce(
        async (graphPromise, { vaultPath, relativePath }) => {
            const currentGraph: Graph = await graphPromise
            const fullPath: string = path.join(vaultPath, relativePath)
            const content: string = await fs.readFile(fullPath, 'utf-8')

            const fsEvent: FSUpdate = {
                absolutePath: fullPath,
                content,
                eventType: 'Added'
            }

            // Use unified function (same as incremental!)
            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, watchedDirectory, currentGraph)
            return applyGraphDeltaToGraph(currentGraph, delta)
        },
        Promise.resolve({ nodes: {} } as Graph)
    )

    // Step 3: Apply positions to all nodes that don't have a position
    return E.right(applyPositions(graph));
}

/**
 * Loads files from a vault path additively into an existing graph.
 *
 * Used when adding a new vault path at runtime (via UI dropdown).
 * This is the bulk load path - more efficient than per-file handleFSEvent calls.
 *
 * Benefits over per-file approach:
 * - Single UI broadcast instead of N broadcasts
 * - No floating editors auto-opened (bulk load behavior)
 * - Pure function (no module state like time-based guards)
 * - Consistent with initial loadGraphFromDisk pattern
 *
 * @param vaultPath - Absolute path to the new vault directory to load
 * @param watchedDirectory - Absolute path used as base for computing node IDs
 * @param existingGraph - The current graph to merge new nodes into
 * @returns Either FileLimitExceededError or { graph: merged graph, delta: new nodes only }
 */
export async function loadVaultPathAdditively(
    vaultPath: string,
    watchedDirectory: string,
    existingGraph: Graph
): Promise<E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }>> {
    // Step 1: Scan the new vault path for markdown files
    const files: readonly string[] = await scanMarkdownFiles(vaultPath);

    // Step 2: Check file limit (existing + new files)
    const existingCount: number = Object.keys(existingGraph.nodes).length;
    const totalCount: number = existingCount + files.length;
    const limitCheck: E.Either<FileLimitExceededError, void> = enforceFileLimit(totalCount);
    if (E.isLeft(limitCheck)) {
        return E.left(limitCheck.left);
    }

    // Step 3: Build graph additively, tracking new node IDs for delta
    const newNodeIds: string[] = [];

    const mergedGraph: Graph = await files.reduce(
        async (graphPromise, relativePath) => {
            const currentGraph: Graph = await graphPromise;
            const fullPath: string = path.join(vaultPath, relativePath);
            const content: string = await fs.readFile(fullPath, 'utf-8');

            const fsEvent: FSUpdate = {
                absolutePath: fullPath,
                content,
                eventType: 'Added'
            };

            // Use unified function (same as loadGraphFromDisk)
            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, watchedDirectory, currentGraph);

            // Track new node IDs from this delta
            delta.forEach(d => {
                if (d.type === 'UpsertNode') {
                    newNodeIds.push(d.nodeToUpsert.relativeFilePathIsID);
                }
            });

            return applyGraphDeltaToGraph(currentGraph, delta);
        },
        Promise.resolve(existingGraph)
    );

    // Step 4: Apply positions only to new nodes (existing nodes keep their positions)
    const graphWithPositions: Graph = applyPositions(mergedGraph);

    // Step 5: Build delta containing only the new nodes (for UI broadcast)
    const resultDelta: GraphDelta = newNodeIds.map(nodeId => ({
        type: 'UpsertNode' as const,
        nodeToUpsert: graphWithPositions.nodes[nodeId],
        previousNode: O.none  // All new nodes
    }));

    return E.right({ graph: graphWithPositions, delta: resultDelta });
}

/**
 * Scans vault directory recursively for markdown files.
 *
 * @param vaultPath - Absolute absolutePath to vault directory
 * @returns Array of relative file paths (e.g., ["note.md", "subfolder/other.md"])
 */
export async function scanMarkdownFiles(vaultPath: string): Promise<readonly string[]> {
  async function scan(dirPath: string, relativePath = ''): Promise<readonly string[]> {
    const entries: Dirent<string>[] = await fs.readdir(dirPath, { withFileTypes: true })

    // Sort entries by name for deterministic ordering
    const sortedEntries: Dirent<string>[] = entries.sort((a, b) => a.name.localeCompare(b.name))

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

