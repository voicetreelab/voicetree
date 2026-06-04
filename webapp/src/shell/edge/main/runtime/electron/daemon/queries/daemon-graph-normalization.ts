import { rehydrateSerializedGraph, type Graph } from '@vt/graph-model'

type DaemonClient = { getGraph(): Promise<unknown> }

export async function getNormalizedDaemonGraph(client: DaemonClient): Promise<Graph> {
  const rawGraph: Awaited<ReturnType<DaemonClient['getGraph']>> = await client.getGraph()
  return rehydrateSerializedGraph({
    nodes:
      typeof rawGraph === 'object' && rawGraph !== null && 'nodes' in rawGraph
        ? (rawGraph.nodes as Record<string, unknown>)
        : {},
  })
}
