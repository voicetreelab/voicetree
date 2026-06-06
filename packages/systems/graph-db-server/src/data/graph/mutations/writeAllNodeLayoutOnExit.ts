import type { Graph, Size } from '@vt/graph-model/graph'
import { nodeLayoutIO } from '@vt/app-config/node-layout-io'

/**
 * Synchronously persist all spatial layout to .voicetree/node-layout.json on
 * app exit / project switch: per-node position+size (from the graph) plus
 * folder sizes keyed by FolderId (from the folder-layout store, passed in).
 *
 * Layout is stored in a single JSON file instead of per-node YAML frontmatter
 * to avoid noisy git diffs when nodes are dragged or folders resized.
 *
 * @param graph - The graph containing nodes to persist
 * @param folderSizes - Expanded-folder sizes keyed by FolderId
 * @param projectRoot - The project root directory (where .voicetree/ lives)
 */
export function writeAllNodeLayoutSync(
    graph: Graph,
    folderSizes: ReadonlyMap<string, Size>,
    projectRoot: string,
): void {
    nodeLayoutIO.save(graph, folderSizes, projectRoot)
}
