import { applyGraphDeltaToGraph, createEmptyGraph, mapNewGraphToDelta, type Graph, type GraphNode, type NodeIdAndFilePath } from '@vt/graph-model'

type DaemonClient = { getGraph(): Promise<unknown> }

export function normalizeDaemonGraph(raw: { nodes: Record<string, unknown> }): Graph {
  const emptyGraph: Graph = createEmptyGraph()
  return applyGraphDeltaToGraph(
    emptyGraph,
    mapNewGraphToDelta({
      ...emptyGraph,
      nodes: raw.nodes as Record<NodeIdAndFilePath, GraphNode>,
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
