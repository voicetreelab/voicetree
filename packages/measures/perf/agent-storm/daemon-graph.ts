import {
    applyGraphDeltaToGraph,
    createEmptyGraph,
    mapNewGraphToDelta,
    type Graph,
    type GraphNode,
    type NodeIdAndFilePath,
} from '@vt/graph-model/graph'

export function normalizeDaemonGraph(raw: { nodes: Record<string, unknown> }): Graph {
    type SerializableGraphNode = GraphNode & {
        nodeUIMetadata?: GraphNode['nodeUIMetadata'] & {
            additionalYAMLProps?: unknown
        }
    }
    const normalizedNodes = Object.fromEntries(
        Object.entries(raw.nodes).map(([nodeId, rawNode]) => {
            const node = rawNode as SerializableGraphNode
            const additional = node.nodeUIMetadata?.additionalYAMLProps
            const revived: ReadonlyMap<string, string> = additional instanceof Map
                ? additional
                : new Map(
                    Object.entries(
                        typeof additional === 'object' && additional !== null
                            ? (additional as Record<string, string>)
                            : {},
                    ),
                )
            return [
                nodeId,
                {
                    ...node,
                    nodeUIMetadata: {
                        ...node.nodeUIMetadata,
                        additionalYAMLProps: revived,
                    },
                },
            ]
        }),
    ) as Record<NodeIdAndFilePath, GraphNode>
    const emptyGraph: Graph = createEmptyGraph()
    return applyGraphDeltaToGraph(
        emptyGraph,
        mapNewGraphToDelta({ ...emptyGraph, nodes: normalizedNodes }),
    )
}
