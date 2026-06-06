import * as fs from 'fs/promises'
import fsSync from 'fs'
import * as path from 'path'
import normalizePath from 'normalize-path'
import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import type { Graph, FSUpdate, GraphDelta, GraphNode } from '@vt/graph-model/graph'
import { createEmptyGraph, isImageNode } from '@vt/graph-model/graph'
import type { Dirent } from 'fs'
import { enforceFileLimit, type FileLimitExceededError } from './fileLimitEnforce'
import { applyPositions, rebaseNewClusterPositions } from '@vt/graph-model/spatial'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@vt/graph-model/graph'
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph'
import { IGNORED_DIRECTORY_NAMES } from '../ignoredDirectoryNames'

type ProjectFileRecord = {
    readonly projectRoot: string;
    readonly relativePath: string;
};

type FileContentRecord = {
    readonly fullPath: string;
    readonly content: string;
};

function createProjectFileRecords(projectRoot: string, files: readonly string[]): readonly ProjectFileRecord[] {
    return files.map(relativePath => ({ projectRoot, relativePath }));
}

function createAddedFileEvent(absolutePath: string, content: string): FSUpdate {
    return {
        absolutePath,
        content,
        eventType: 'Added'
    };
}

function applyFileContentsToGraph(
    fileContents: readonly FileContentRecord[],
    initialGraph: Graph
): Graph {
    return fileContents.reduce(
        (currentGraph, { fullPath, content }) => {
            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(
                createAddedFileEvent(fullPath, content),
                currentGraph
            );
            return applyGraphDeltaToGraph(currentGraph, delta);
        },
        initialGraph
    );
}

function nodeIdForProjectRelativePath(projectRoot: string, relativePath: string): string {
    return normalizePath(path.join(projectRoot, relativePath));
}

function selectNewProjectFiles(
    files: readonly string[],
    projectRoot: string,
    existingGraph: Graph
): readonly string[] {
    return files.filter((relativePath: string) => !(nodeIdForProjectRelativePath(projectRoot, relativePath) in existingGraph.nodes));
}

function createUpsertDeltaForNodeIds(graph: Graph, nodeIds: readonly string[]): GraphDelta {
    return nodeIds.map(nodeId => ({
        type: 'UpsertNode' as const,
        nodeToUpsert: graph.nodes[nodeId],
        previousNode: O.none
    }));
}

async function readGraphFileContent(fullPath: string): Promise<FileContentRecord> {
    return {
        fullPath,
        content: isImageNode(fullPath) ? '' : await fs.readFile(fullPath, 'utf-8')
    };
}

/**
 * Loads a graph from the filesystem using progressive edge validation.
 *
 * IO function: Performs side effects (file I/O) and returns a Promise<Graph>.
 *
 * Algorithm (progressive, order-independent):
 * 1. Scan all project directories recursively for .md files
 * 2. For each file, progressively add to graph using addNodeToGraph
 *    - Validates outgoing edges from new node
 *    - Heals incoming edges to new node (bidirectional validation)
 * 3. Apply positions to all nodes that don't have a position
 * 4. Return Graph with all edges correctly resolved
 *
 * Key property: Loading [A,B,C] produces same result as [C,B,A] (order-independent)
 * Node IDs are absolute paths (normalized with forward slashes).
 *
 * @param projectPaths - Array of absolute paths to project directories containing markdown files
 * @returns Promise that resolves to a Graph
 *
 * @example
 * ```typescript
 * const graph = await loadGraphFromDisk(['/path/to/project', '/path/to/openspec'])
 * ```
 */
export async function loadGraphFromDisk(
    projectPaths: readonly string[]
): Promise<E.Either<FileLimitExceededError, Graph>> {
    if (projectPaths.length === 0) {
        return E.right(createEmptyGraph());
    }

    // Step 1: Scan all project directories for markdown files
    // Each file is stored with its project path for correct absolute path resolution
    const allFiles: readonly { projectRoot: string; relativePath: string }[] = (
        await Promise.all(
            projectPaths.map(async (projectRoot) => {
                const files: readonly string[] = await scanMarkdownFiles(projectRoot);
                return createProjectFileRecords(projectRoot, files);
            })
        )
    ).flat();

    // Step 1.5: Enforce file limit (will show error dialog and return Left if exceeded)
    const limitCheck: E.Either<FileLimitExceededError, void> = enforceFileLimit(allFiles.length);
    if (E.isLeft(limitCheck)) {
        return E.left(limitCheck.left);
    }

    // Step 2a: Read all files in parallel
    const fileContents: readonly FileContentRecord[] = await Promise.all(
        allFiles.map(({ projectRoot, relativePath }) => readGraphFileContent(path.join(projectRoot, relativePath)))
    )

    // Step 2b: Progressively build graph by adding nodes one at a time
    // Each addition validates edges and heals incoming edges (order-independent per JSDoc above)
    const graph: Graph = applyFileContentsToGraph(fileContents, createEmptyGraph())

    // Step 3: Apply positions to all nodes that don't have a position
    return E.right(applyPositions(graph));
}

/**
 * Loads files from a project path additively into an existing graph.
 *
 * Used when adding a new project path at runtime (via UI dropdown).
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
 * @param projectRoot - Absolute path to the new project directory to load
 * @param existingGraph - The current graph to merge new nodes into
 * @returns Either FileLimitExceededError or { graph: merged graph, delta: new nodes only }
 */
export async function loadProjectPathAdditively(
    projectRoot: string,
    existingGraph: Graph
): Promise<E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }>> {
    // Step 1: Scan the new project path for markdown files
    const files: readonly string[] = await scanMarkdownFiles(projectRoot);

    // Step 2: Filter out files already in the graph (avoid double-counting)
    const newFiles: readonly string[] = selectNewProjectFiles(files, projectRoot, existingGraph);

    // Step 3: Check file limit (existing + genuinely new files)
    const existingCount: number = Object.keys(existingGraph.nodes).length;
    const totalCount: number = existingCount + newFiles.length;
    const limitCheck: E.Either<FileLimitExceededError, void> = enforceFileLimit(totalCount);
    if (E.isLeft(limitCheck)) {
        return E.left(limitCheck.left);
    }

    // Step 3: Read new files in parallel, then build the graph sequentially from memory
    const fileContents: readonly FileContentRecord[] = await Promise.all(
        newFiles.map(relativePath => readGraphFileContent(path.join(projectRoot, relativePath)))
    );
    const newNodeIds: readonly string[] = newFiles.map(relativePath => nodeIdForProjectRelativePath(projectRoot, relativePath));
    const mergedGraph: Graph = applyFileContentsToGraph(fileContents, existingGraph);

    // Step 4: Apply positions only to new nodes (existing nodes keep their positions)
    const graphWithPositions: Graph = applyPositions(mergedGraph);

    // Step 4.5: Rebase new cluster positions relative to existing nodes
    // This prevents viewport collapse when new nodes are far from existing ones
    const existingNodeIds: readonly string[] = Object.keys(existingGraph.nodes);
    const graphRebased: Graph = rebaseNewClusterPositions(graphWithPositions, existingNodeIds, newNodeIds);

    // Step 5: Build delta containing only the new nodes (for UI broadcast)
    const resultDelta: GraphDelta = createUpsertDeltaForNodeIds(graphRebased, newNodeIds);

    return E.right({ graph: graphRebased, delta: resultDelta });
}

/**
 * Checks if a filename has a supported file extension (markdown or image).
 * Uses isImageNode for image detection.
 */
function isSupportedFile(filename: string): boolean {
  return filename.endsWith('.md') || isImageNode(filename)
}

// Directories that must never be loaded into the graph even when nested inside
// a project. Hidden directories (names starting with '.') are also skipped — most
// notably `.voicetree/prompts/`, which would otherwise leak per-project tooling
// markdown files in as graph nodes when a project root is scanned. The ignored
// names live in `IGNORED_DIRECTORY_NAMES` (shared with the folder watcher).
function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name)
}

/**
 * Scans project directory recursively for markdown and image files.
 *
 * Skips hidden directories (names starting with '.') and common noise
 * directories (node_modules, dist, build, etc.), matching the behavior of the
 * folder-selector scanner.
 *
 * @param projectRoot - Absolute absolutePath to project directory
 * @returns Array of relative file paths (e.g., ["note.md", "subfolder/other.md", "image.png"])
 */
export async function scanMarkdownFiles(projectRoot: string): Promise<readonly string[]> {
  return scanMarkdownFilesInDirectory(projectRoot)
}

async function scanMarkdownFilesInDirectory(dirPath: string, relativePath = ''): Promise<readonly string[]> {
    const entries: Dirent<string>[] = await fs.readdir(dirPath, { withFileTypes: true })

    // Sort entries by name for deterministic ordering
    const sortedEntries: Dirent<string>[] = entries.sort((a, b) => a.name.localeCompare(b.name))

    const results: (readonly string[])[] = await Promise.all(
      sortedEntries.map(async (entry) => {
        const fullPath: string = path.join(dirPath, entry.name)
        const relPath: string = relativePath ? path.join(relativePath, entry.name) : entry.name

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) return []
          if (isIgnoredDirectoryName(entry.name)) return []
          return scanMarkdownFilesInDirectory(fullPath, relPath)
        } else if (entry.isFile() && isSupportedFile(entry.name)) {
          return [relPath]
        }
        return []
      })
    )

    return results.flat()
}

/**
 * Checks if a node ID (absolute path) belongs to one of the expanded folder directories.
 *
 * @param nodeId - Absolute path to check (expected to be normalized with forward slashes)
 * @param expandedPaths - Array of absolute expanded folder paths
 * @returns true if the node is within a readPath directory
 */
export function isReadPath(nodeId: string, expandedPaths: readonly string[]): boolean {
    return expandedPaths.some((expandedPath: string) => {
        const normalizedReadPath: string = normalizePath(expandedPath);
        return nodeId.startsWith(normalizedReadPath + '/') || nodeId === normalizedReadPath;
    });
}

function normalizeProjectRoots(projectRoots: readonly string[]): readonly string[] {
    return [...new Set(projectRoots.map(projectRoot => normalizePath(projectRoot)))]
}

/**
 * Loads a single file and returns the delta.
 * I/O function - reads file from disk.
 *
 * @param filePath - Absolute path to file to load
 * @param graph - Current graph (for edge healing)
 * @returns GraphDelta for the loaded node, or empty array on error
 */
async function loadFileAsNode(
    filePath: string,
    graph: Graph
): Promise<GraphDelta> {
    try {
        const { fullPath, content } = await readGraphFileContent(filePath);
        return addNodeToGraphWithEdgeHealingFromFSEvent(createAddedFileEvent(fullPath, content), graph);
    } catch {
        // File might not exist or be inaccessible - skip
        return [];
    }
}

/** The nodes introduced (or healed) by a delta — the seeds whose links we follow. */
function upsertedNodesOf(delta: GraphDelta): readonly GraphNode[] {
    return delta.flatMap(d => (d.type === 'UpsertNode' ? [d.nodeToUpsert] : []));
}

/**
 * Resolves an *absolute* wikilink target to an on-disk markdown file path that
 * is not yet in the graph, or `undefined` otherwise.
 *
 * Returns undefined when the link is relative (relative links are healed against
 * loaded nodes by the graph-model edge indexes, never loaded from disk), when
 * the target is already loaded, when it was already attempted this pass, or when
 * it does not exist on disk.
 *
 * Absolute targets intentionally escape folder-visibility and project
 * boundaries: an absolute link to a file in an unloaded folder or a sibling
 * repo still loads, via a single `existsSync`.
 *
 * @param attemptedTargets - Per-pass set of normalized paths already considered (mutated).
 */
function resolveLoadableTargetPath(
    linkTarget: string,
    projectRoots: readonly string[],
    graph: Graph,
    attemptedTargets: Set<string>
): string | undefined {
    const withExtension: string = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
    let targetPath: string | undefined;
    let targetExists = false;
    if (linkTarget.startsWith('/')) {
        targetPath = normalizePath(withExtension);
        targetExists = fsSync.existsSync(targetPath);
    } else {
        if (!linkTarget.includes('/') && !linkTarget.includes('\\')) return undefined;
        for (const projectRoot of projectRoots) {
            const candidate = normalizePath(path.join(projectRoot, withExtension));
            if (fsSync.existsSync(candidate)) {
                targetPath = candidate;
                targetExists = true;
                break;
            }
        }
    }

    if (!targetPath) return undefined;

    if (graph.nodes[targetPath]) return undefined;
    if (attemptedTargets.has(targetPath)) return undefined;
    attemptedTargets.add(targetPath);

    return targetExists ? targetPath : undefined;
}

/** Collects the loadable absolute targets across a frontier of nodes (deduped). */
function collectLoadableAbsoluteTargets(
    nodes: readonly GraphNode[],
    projectRoots: readonly string[],
    graph: Graph,
    attemptedTargets: Set<string>
): readonly string[] {
    const targets: Set<string> = new Set();
    for (const node of nodes) {
        for (const edge of node.outgoingEdges) {
            const resolved: string | undefined = resolveLoadableTargetPath(edge.targetId, projectRoots, graph, attemptedTargets);
            if (resolved) targets.add(resolved);
        }
    }
    return [...targets];
}

/**
 * Loads the *absolute*-path wikilink targets referenced by an upsert delta.
 *
 * Relative wikilinks are intentionally NOT handled here. The graph-model edge
 * indexes (`nodeByBaseName` / `unresolvedLinksIndex`) already resolve a relative
 * link the instant its basename matches a loaded node, in both directions
 * (a new node's links to loaded targets, and existing nodes waiting for a newly
 * loaded target — see `addNodeToGraphWithEdgeHealingFromFSEvent`). A relative
 * link with no loaded match stays dangling by design: the resolver must not
 * crawl disk and resurrect files from folders the user has unloaded.
 *
 * Absolute wikilinks keep their precise-load semantics: an absolute target is
 * loaded from wherever it lives on disk — including outside every loaded folder
 * and outside the project root — via a single `existsSync`. This is the only
 * genuinely-new file loading the resolver still performs.
 *
 * Resolution is delta-scoped and transitive: it follows the absolute edges of
 * the upserted nodes, then of any file those edges loaded, until no new
 * absolute target appears. It performs zero directory crawls.
 *
 * @param graph - Current graph (already includes the upserted delta).
 * @param delta - The upserted delta whose absolute links to follow.
 * @returns GraphDelta of newly-loaded absolute-target nodes (caller applies it).
 */
export async function resolveAbsoluteLinkedNodes(
    graph: Graph,
    delta: GraphDelta,
    projectRoots: readonly string[] = []
): Promise<GraphDelta> {
    const accumulatedDelta: GraphDelta[number][] = [];
    // Normalized target paths already considered, across the whole transitive pass.
    const attemptedTargets: Set<string> = new Set();
    const normalizedProjectRoots: readonly string[] = normalizeProjectRoots(projectRoots);
    let workingGraph: Graph = graph;
    let frontier: readonly GraphNode[] = upsertedNodesOf(delta);

    while (frontier.length > 0) {
        const targetsToLoad: readonly string[] = collectLoadableAbsoluteTargets(frontier, normalizedProjectRoots, workingGraph, attemptedTargets);
        const newlyLoaded: GraphNode[] = [];

        for (const targetPath of targetsToLoad) {
            if (workingGraph.nodes[targetPath]) continue; // Already loaded (e.g. by an earlier target this pass)

            const loadDelta: GraphDelta = await loadFileAsNode(targetPath, workingGraph);
            if (loadDelta.length > 0) {
                workingGraph = applyGraphDeltaToGraph(workingGraph, loadDelta);
                accumulatedDelta.push(...loadDelta);
                newlyLoaded.push(...upsertedNodesOf(loadDelta));
            }
        }

        frontier = newlyLoaded;
    }

    return accumulatedDelta;
}
