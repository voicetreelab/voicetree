import type {Graph, GraphDelta, UpsertNodeAction} from '@/functional/pure/graph/types.ts'

/**
 * Convert a whole Graph to a GraphDelta.
 *
 * Pure function: same input -> same output, no side effects
 *
 * This is used during initial load where the entire graph needs to be
 * represented as a delta (everything is an "upsert").
 *
 * @param graph - The complete graph to convert
 * @returns GraphDelta containing UpsertNode actions for all nodes
 *
 * @example
 * ```typescript
 * const graph: Graph = { nodes: { 'note1': {...}, 'note2': {...} } }
 * const delta = mapNewGraphToDelta(graph)
 * // delta = [{ type: 'UpsertNode', nodeToUpsert: {...} }, ...]
 * ```
 */
export function mapNewGraphToDelta(graph: Graph): GraphDelta {
    // Convert each node to an UpsertNode action
    const nodeDeltas: readonly UpsertNodeAction[] = Object.values(graph.nodes).map(node => ({
        type: 'UpsertNode' as const,
        nodeToUpsert: node
    }))

    return nodeDeltas
}
