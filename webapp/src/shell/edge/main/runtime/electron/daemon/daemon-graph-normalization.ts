import { applyGraphDeltaToGraph, createEmptyGraph, mapNewGraphToDelta, type Graph, type GraphNode, type NodeIdAndFilePath } from '@vt/graph-model'

type DaemonClient = { getGraph(): Promise<unknown> }
type SerializableGraphNode = GraphNode & {
  nodeUIMetadata?: GraphNode['nodeUIMetadata'] & {
    additionalYAMLProps?: unknown
  }
}

function normalizeGraphNodes(
  nodes: Record<string, unknown>,
): Record<NodeIdAndFilePath, GraphNode> {
  return Object.fromEntries(
    Object.entries(nodes).map(([nodeId, rawNode]) => {
      const node: SerializableGraphNode = rawNode as SerializableGraphNode

      const additionalYAMLProps: unknown = node.nodeUIMetadata?.additionalYAMLProps
      const revivedAdditionalYAMLProps: ReadonlyMap<string, string> =
        additionalYAMLProps instanceof Map
          ? additionalYAMLProps
          : new Map(
              Object.entries(
                typeof additionalYAMLProps === 'object' &&
                  additionalYAMLProps !== null
                  ? (additionalYAMLProps as Record<string, string>)
                  : {},
              ),
            )

      return [
        nodeId,
        {
          ...node,
          nodeUIMetadata: {
            ...node.nodeUIMetadata,
            additionalYAMLProps: revivedAdditionalYAMLProps,
          },
        },
      ]
    }),
  ) as Record<NodeIdAndFilePath, GraphNode>
}

export function normalizeDaemonGraph(raw: { nodes: Record<string, unknown> }): Graph {
  const emptyGraph: Graph = createEmptyGraph()
  return applyGraphDeltaToGraph(
    emptyGraph,
    mapNewGraphToDelta({
      ...emptyGraph,
      nodes: normalizeGraphNodes(raw.nodes),
    }),
  )
}

export async function getNormalizedDaemonGraph(client: DaemonClient): Promise<Graph> {
  const rawGraph: Awaited<ReturnType<DaemonClient['getGraph']>> = await client.getGraph()
  const graph: Graph = normalizeDaemonGraph({
    nodes:
      typeof rawGraph === 'object' && rawGraph !== null && 'nodes' in rawGraph
        ? (rawGraph.nodes as Record<string, unknown>)
        : {},
  })
  return graph
}
