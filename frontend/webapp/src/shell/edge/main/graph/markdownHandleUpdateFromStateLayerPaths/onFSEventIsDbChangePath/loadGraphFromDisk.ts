import * as fs from 'fs/promises'
import * as path from 'path'
import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import type { Graph, FSUpdate, GraphDelta, GraphNode } from '@/pure/graph'
import { createEmptyGraph, isImageNode } from '@/pure/graph'
import type { Dirent } from 'fs'
import { enforceFileLimit, type FileLimitExceededError } from './fileLimitEnforce'
import { applyPositions } from '@/pure/graph/positioning'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { findBestMatchingNode } from '@/pure/graph/markdown-parsing/extract-edges'

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
 * Node IDs are absolute paths (normalized with forward slashes).
 *
 * @param vaultPaths - Array of absolute paths to vault directories containing markdown files
 * @returns Promise that resolves to a Graph
 *
 * @example
 * ```typescript
 * const graph = await loadGraphFromDisk(['/path/to/vault', '/path/to/openspec'])
 * console.log(`Loaded ${Object.keys(graph.nodes).length} nodes`)
 * ```
 */
export async function loadGraphFromDisk(
    vaultPaths: readonly string[]
): Promise<E.Either<FileLimitExceededError, Graph>> {
    if (vaultPaths.length === 0) {
        return E.right(createEmptyGraph());
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
            // Image files have empty content (don't read binary as UTF-8)
            const content: string = isImageNode(fullPath) ? '' : await fs.readFile(fullPath, 'utf-8')

            const fsEvent: FSUpdate = {
                absolutePath: fullPath,
                content,
                eventType: 'Added'
            }

            // Use unified function (same as incremental!)
            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, currentGraph)
            return applyGraphDeltaToGraph(currentGraph, delta)
        },
        Promise.resolve(createEmptyGraph())
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
 * Node IDs are absolute paths (normalized with forward slashes).
 *
 * @param vaultPath - Absolute path to the new vault directory to load
 * @param existingGraph - The current graph to merge new nodes into
 * @returns Either FileLimitExceededError or { graph: merged graph, delta: new nodes only }
 */
export async function loadVaultPathAdditively(
    vaultPath: string,
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
            // Image files have empty content (don't read binary as UTF-8)
            const content: string = isImageNode(fullPath) ? '' : await fs.readFile(fullPath, 'utf-8');

            const fsEvent: FSUpdate = {
                absolutePath: fullPath,
                content,
                eventType: 'Added'
            };

            // Use unified function (same as loadGraphFromDisk)
            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, currentGraph);

            // Track new node IDs from this delta
            delta.forEach(d => {
                if (d.type === 'UpsertNode') {
                    newNodeIds.push(d.nodeToUpsert.absoluteFilePathIsID);
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
 * Checks if a filename has a supported file extension (markdown or image).
 * Uses isImageNode for image detection.
 */
function isSupportedFile(filename: string): boolean {
  return filename.endsWith('.md') || isImageNode(filename)
}

/**
 * Scans vault directory recursively for markdown and image files.
 *
 * @param vaultPath - Absolute absolutePath to vault directory
 * @returns Array of relative file paths (e.g., ["note.md", "subfolder/other.md", "image.png"])
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
        } else if (entry.isFile() && isSupportedFile(entry.name)) {
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
 * Checks if a node ID (absolute path) belongs to one of the readOnLinkPaths directories.
 *
 * @param nodeId - Absolute path to check
 * @param readOnLinkPaths - Array of absolute paths to readOnLinkPaths directories
 * @returns true if the node is within a readOnLinkPath directory
 */
export function isReadOnLinkPath(nodeId: string, readOnLinkPaths: readonly string[]): boolean {
    return readOnLinkPaths.some((readPath: string) =>
        nodeId.startsWith(readPath + path.sep) || nodeId === readPath
    );
}

/**
 * Loads a graph with lazy loading for readOnLinkPaths.
 *
 * Nodes from immediateLoadPaths are loaded immediately.
 * Nodes from lazyLoadPaths are only loaded if they are linked by visible nodes.
 * Transitive links are resolved recursively.
 *
 * @param immediateLoadPaths - Array of absolute paths to load immediately (writePath + showAllPaths)
 * @param lazyLoadPaths - Array of absolute paths to lazy-load directories
 * @returns Promise that resolves to a Graph with lazy-loaded nodes
 */
export async function loadGraphFromDiskWithLazyLoading(
    immediateLoadPaths: readonly string[],
    lazyLoadPaths: readonly string[]
): Promise<E.Either<FileLimitExceededError, Graph>> {
    // Step 1: Load all immediate paths
    if (immediateLoadPaths.length === 0) {
        return E.right(createEmptyGraph());
    }

    const immediateResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(immediateLoadPaths);

    if (E.isLeft(immediateResult)) {
        return immediateResult;
    }

    let graph: Graph = immediateResult.right;

    // Step 2: If no lazy paths, we're done
    if (lazyLoadPaths.length === 0) {
        return E.right(graph);
    }

    // Step 3: Build an index of files available in lazyLoadPaths for fast lookup
    const readOnLinkFiles: Map<string, { vaultPath: string; relativePath: string }> = new Map();
    for (const readPath of lazyLoadPaths) {
        const files: readonly string[] = await scanMarkdownFiles(readPath);
        for (const relativePath of files) {
            const fullPath: string = path.join(readPath, relativePath);
            readOnLinkFiles.set(fullPath, { vaultPath: readPath, relativePath });
        }
    }

    // Step 4: Resolve linked nodes from lazyLoadPaths (with transitive resolution)
    graph = await resolveLinkedNodes(graph, readOnLinkFiles);

    return E.right(graph);
}

/**
 * Resolves linked nodes from readOnLinkPaths.
 *
 * Scans visible nodes for wikilinks that point to files in readOnLinkPaths.
 * Loads those files and recursively resolves their links.
 *
 * @param graph - Current graph with visible nodes
 * @param readOnLinkFiles - Map of absolute paths to file info for quick lookup
 * @returns Graph with linked nodes from readOnLinkPaths added
 */
async function resolveLinkedNodes(
    graph: Graph,
    readOnLinkFiles: Map<string, { vaultPath: string; relativePath: string }>
): Promise<Graph> {
    // Build a set of all available node IDs from readOnLinkFiles for matching
    const availableNodeIds: Record<string, GraphNode> = {};
    for (const [absolutePath] of readOnLinkFiles) {
        // Create a placeholder node for matching purposes
        availableNodeIds[absolutePath] = {
            absoluteFilePathIsID: absolutePath,
            outgoingEdges: [],
            contentWithoutYamlOrLinks: '',
            nodeUIMetadata: {
                color: O.none,
                position: O.none,
                additionalYAMLProps: new Map()
            }
        };
    }

    // Track which nodes we've already processed to avoid infinite loops
    const processedNodeIds: Set<string> = new Set();
    // Track which readOnLinkPath nodes need to be loaded
    const nodesToLoad: Set<string> = new Set();

    // Find all linked nodes from current visible nodes
    const findLinkedNodes: (currentGraph: Graph) => void = (currentGraph: Graph): void => {
        for (const nodeId of Object.keys(currentGraph.nodes)) {
            if (processedNodeIds.has(nodeId)) continue;
            processedNodeIds.add(nodeId);

            const node: GraphNode = currentGraph.nodes[nodeId];

            // Check each outgoing edge
            for (const edge of node.outgoingEdges) {
                const targetId: string = edge.targetId;

                // Check if the target is in readOnLinkPaths and not already loaded
                if (readOnLinkFiles.has(targetId) && !currentGraph.nodes[targetId]) {
                    nodesToLoad.add(targetId);
                } else {
                    // Try to match the link text against available readOnLinkPath files
                    const matchedNodeId: string | undefined = findBestMatchingNode(targetId, availableNodeIds);
                    if (matchedNodeId && readOnLinkFiles.has(matchedNodeId) && !currentGraph.nodes[matchedNodeId]) {
                        nodesToLoad.add(matchedNodeId);
                    }
                }
            }
        }
    };

    // Initial pass: find all linked nodes from writePath nodes
    findLinkedNodes(graph);

    // Iteratively load nodes and resolve their transitive links
    while (nodesToLoad.size > 0) {
        const nodeIdsToLoad: readonly string[] = [...nodesToLoad];
        nodesToLoad.clear();

        // Load each node
        for (const nodeId of nodeIdsToLoad) {
            const fileInfo: { vaultPath: string; relativePath: string } | undefined = readOnLinkFiles.get(nodeId);
            if (!fileInfo) continue;

            const fullPath: string = path.join(fileInfo.vaultPath, fileInfo.relativePath);
            // Image files have empty content (don't read binary as UTF-8)
            const content: string = isImageNode(fullPath) ? '' : await fs.readFile(fullPath, 'utf-8');

            const fsEvent: FSUpdate = {
                absolutePath: fullPath,
                content,
                eventType: 'Added'
            };

            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph);
            graph = applyGraphDeltaToGraph(graph, delta);
        }

        // Find new linked nodes from the nodes we just loaded
        findLinkedNodes(graph);
    }

    // Apply positions to all nodes
    return applyPositions(graph);
}

/**
 * Resolves any unresolved links after a file change.
 *
 * Called by the file watcher when a file is changed or added.
 * Checks if any outgoing edges from the current graph point to files
 * in readOnLinkPaths that haven't been loaded yet, and loads them.
 *
 * @param currentGraph - Current graph state
 * @param readOnLinkPaths - Array of readOnLinkPaths directories
 * @returns Promise that resolves to updated Graph with newly linked nodes
 */
export async function resolveLinksAfterChange(
    currentGraph: Graph,
    readOnLinkPaths: readonly string[]
): Promise<Graph> {
    if (readOnLinkPaths.length === 0) {
        return currentGraph;
    }

    // Build index of files available in readOnLinkPaths
    const readOnLinkFiles: Map<string, { vaultPath: string; relativePath: string }> = new Map();
    for (const readPath of readOnLinkPaths) {
        try {
            const files: readonly string[] = await scanMarkdownFiles(readPath);
            for (const relativePath of files) {
                const fullPath: string = path.join(readPath, relativePath);
                readOnLinkFiles.set(fullPath, { vaultPath: readPath, relativePath });
            }
        } catch {
            // Directory might not exist or be inaccessible - skip
        }
    }

    // Resolve linked nodes (same logic as initial load)
    return resolveLinkedNodes(currentGraph, readOnLinkFiles);
}
