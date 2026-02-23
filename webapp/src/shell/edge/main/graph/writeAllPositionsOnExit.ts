import type { Graph } from '@/pure/graph'
import { savePositionsSync } from '@/shell/edge/main/graph/positions-store'

/**
 * Synchronously persist all node positions to .voicetree/positions.json on app exit.
 *
 * Positions are stored in a single JSON file instead of per-node YAML frontmatter
 * to avoid noisy git diffs when nodes are dragged.
 *
 * @param graph - The graph containing nodes to persist
 * @param projectRoot - The project root directory (where .voicetree/ lives)
 */
export function writeAllPositionsSync(graph: Graph, projectRoot: string): void {
    savePositionsSync(graph, projectRoot)
}
