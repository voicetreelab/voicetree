import type { Graph } from '@vt/graph-model/graph'
import { nodeLayoutIO } from '@vt/app-config/node-layout-io'

/**
 * Synchronously persist all node spatial layout (position + size) to
 * .voicetree/node-layout.json on app exit.
 *
 * Layout is stored in a single JSON file instead of per-node YAML frontmatter
 * to avoid noisy git diffs when nodes are dragged or folders resized.
 *
 * @param graph - The graph containing nodes to persist
 * @param projectRoot - The project root directory (where .voicetree/ lives)
 */
export function writeAllNodeLayoutSync(graph: Graph, projectRoot: string): void {
    nodeLayoutIO.save(graph, projectRoot)
}
