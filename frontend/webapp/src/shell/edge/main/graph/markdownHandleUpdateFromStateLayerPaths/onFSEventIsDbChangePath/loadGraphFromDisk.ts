import * as fs from 'fs/promises'
import fsSync from 'fs'
import * as path from 'path'
import normalizePath from 'normalize-path'
import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import type { Graph, FSUpdate, GraphDelta, GraphNode } from '@/pure/graph'
import { createEmptyGraph, isImageNode } from '@/pure/graph'
import type { Dirent } from 'fs'
import { enforceFileLimit, type FileLimitExceededError } from './fileLimitEnforce'
import { applyPositions } from '@/pure/graph/positioning'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { linkMatchScore } from '@/pure/graph/markdown-parsing/extract-edges'
import { findFileByName } from '@/shell/edge/main/graph/loading/findFileByName'

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
 * Checks if a node ID (absolute path) belongs to one of the readPaths directories.
 *
 * @param nodeId - Absolute path to check (expected to be normalized with forward slashes)
 * @param readPaths - Array of absolute paths to readPaths directories
 * @returns true if the node is within a readPath directory
 */
export function isReadPath(nodeId: string, readPaths: readonly string[]): boolean {
    return readPaths.some((readPath: string) => {
        const normalizedReadPath: string = normalizePath(readPath);
        return nodeId.startsWith(normalizedReadPath + '/') || nodeId === normalizedReadPath;
    });
}

/**
 * Loads a graph with ALL files from both writePath and readPaths.
 *
 * Both writePath and readPaths load all files immediately.
 * Resolve-on-link behavior is handled separately for watched folder files
 * outside writePath/readPaths via resolveLinkedNodesInWatchedFolder.
 *
 * @param writePathPaths - Array of absolute paths to load (writePath)
 * @param readPaths - Array of absolute paths to load (readPaths - all files loaded immediately)
 * @returns Promise that resolves to a Graph with all nodes loaded
 */
export async function loadGraphFromDiskWithLazyLoading(
    writePathPaths: readonly string[],
    readPaths: readonly string[]
): Promise<E.Either<FileLimitExceededError, Graph>> {
    // Load ALL files from both writePath and readPaths immediately
    // (readPaths are no longer lazy-loaded)
    const allPaths: readonly string[] = [...writePathPaths, ...readPaths];

    if (allPaths.length === 0) {
        return E.right(createEmptyGraph());
    }

    return loadGraphFromDisk(allPaths);
}

/**
 * Resolves wikilinks in the graph by searching the watched folder.
 *
 * For each unresolved wikilink in the graph:
 * - Absolute path links (start with /): check if file exists using fs.existsSync
 * - Relative path links: use findFileByName() to suffix-match in watchedFolder
 *
 * Uses linkMatchScore to pick the best match when multiple files match.
 * Recursively resolves transitive links (A→B→C all get loaded).
 *
 * This is the "resolve-on-link" behavior for files in the watched folder
 * that are outside writePath/readPaths.
 *
 * @param graph - Current graph with nodes
 * @param watchedFolder - The root folder to search for linked files
 * @returns GraphDelta containing all resolved nodes (caller applies to graph)
 */
export async function resolveLinkedNodesInWatchedFolder(
    graph: Graph,
    watchedFolder: string
): Promise<GraphDelta> {
    // Track which nodes we've already processed to avoid infinite loops
    const processedNodeIds: Set<string> = new Set();
    // Track which files need to be loaded
    const filesToLoad: Set<string> = new Set();
    // Accumulate all deltas from resolution (mutable array, returned as GraphDelta)
    const accumulatedDelta: GraphDelta[number][] = [];
    // Working copy of graph for resolution
    let workingGraph: Graph = graph;

    // Extract link targets from a node's outgoing edges
    const extractLinkTargets: (node: GraphNode) => readonly string[] = (node: GraphNode): readonly string[] => {
        return node.outgoingEdges.map(edge => edge.targetId);
    };

    // Resolve a single link target to an absolute file path
    const resolveLinkTarget: (linkTarget: string) => Promise<string | undefined> = async (linkTarget: string): Promise<string | undefined> => {
        // Case 1: Absolute path - check if file exists
        if (linkTarget.startsWith('/')) {
            // Ensure .md extension
            const targetPath: string = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
            if (fsSync.existsSync(targetPath)) {
                return targetPath;
            }
            return undefined;
        }

        // Case 2: Relative path - use findFileByName to suffix-match
        // Extract the filename from the link (last component)
        const linkComponents: readonly string[] = linkTarget.split(/[/\\]/);
        const searchPattern: string = linkComponents[linkComponents.length - 1].replace(/\.md$/, '');

        if (!searchPattern) return undefined;

        const matchingFiles: readonly string[] = await findFileByName(searchPattern, watchedFolder);

        if (matchingFiles.length === 0) return undefined;

        if (matchingFiles.length === 1) return matchingFiles[0];

        // Multiple matches - use linkMatchScore to pick the best one
        let bestMatch: string = matchingFiles[0];
        let bestScore: number = linkMatchScore(linkTarget, matchingFiles[0]);

        for (let i: number = 1; i < matchingFiles.length; i++) {
            const score: number = linkMatchScore(linkTarget, matchingFiles[i]);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = matchingFiles[i];
            }
        }

        return bestMatch;
    };

    // Find all unresolved links from nodes in the graph
    const findUnresolvedLinks: (currentGraph: Graph) => Promise<void> = async (currentGraph: Graph): Promise<void> => {
        for (const nodeId of Object.keys(currentGraph.nodes)) {
            if (processedNodeIds.has(nodeId)) continue;
            processedNodeIds.add(nodeId);

            const node: GraphNode = currentGraph.nodes[nodeId];
            const linkTargets: readonly string[] = extractLinkTargets(node);

            for (const target of linkTargets) {
                // Skip if already in graph
                if (currentGraph.nodes[target]) continue;

                // Try to resolve the link
                const resolvedPath: string | undefined = await resolveLinkTarget(target);
                if (resolvedPath && !currentGraph.nodes[resolvedPath]) {
                    filesToLoad.add(resolvedPath);
                }
            }
        }
    };

    // Initial pass: find all unresolved links
    await findUnresolvedLinks(workingGraph);

    // Iteratively load files and resolve their transitive links
    while (filesToLoad.size > 0) {
        const pathsToLoad: readonly string[] = [...filesToLoad];
        filesToLoad.clear();

        // Load each file
        for (const filePath of pathsToLoad) {
            if (workingGraph.nodes[filePath]) continue; // Already loaded

            try {
                // Image files have empty content (don't read binary as UTF-8)
                const content: string = isImageNode(filePath) ? '' : await fs.readFile(filePath, 'utf-8');

                const fsEvent: FSUpdate = {
                    absolutePath: filePath,
                    content,
                    eventType: 'Added'
                };

                const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, workingGraph);
                workingGraph = applyGraphDeltaToGraph(workingGraph, delta);
                // Accumulate deltas for return
                accumulatedDelta.push(...delta);
            } catch {
                // File might not exist or be inaccessible - skip
            }
        }

        // Find new unresolved links from the nodes we just loaded
        await findUnresolvedLinks(workingGraph);
    }

    // Return accumulated delta (caller handles positioning and applying to state)
    return accumulatedDelta;
}
