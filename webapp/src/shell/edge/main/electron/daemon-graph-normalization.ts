import { isDeepStrictEqual } from 'node:util'
import * as O from 'fp-ts/lib/Option.js'
import { applyGraphDeltaToGraph, createEmptyGraph, mapNewGraphToDelta, type Graph, type GraphDelta, type GraphNode, type NodeIdAndFilePath } from '@vt/graph-model'

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

export function buildGraphDiff(previous: Graph, next: Graph): GraphDelta {
  const delta: GraphDelta[number][] = []

  for (const [nodeId, previousNode] of Object.entries(previous.nodes) as Array<
    [NodeIdAndFilePath, GraphNode]
  >) {
    if (!next.nodes[nodeId]) {
      delta.push({
        type: 'DeleteNode',
        nodeId,
        deletedNode: O.some(previousNode),
      })
    }
  }

  for (const [nodeId, nextNode] of Object.entries(next.nodes) as Array<
    [NodeIdAndFilePath, GraphNode]
  >) {
    const previousNode: GraphNode | undefined = previous.nodes[nodeId]
    if (previousNode && isDeepStrictEqual(previousNode, nextNode)) {
      continue
    }

    delta.push({
      type: 'UpsertNode',
      nodeToUpsert: nextNode,
      previousNode: previousNode ? O.some(previousNode) : O.none,
    })
  }

  return delta
}
