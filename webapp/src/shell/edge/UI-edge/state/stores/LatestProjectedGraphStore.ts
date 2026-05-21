import type { ProjectedGraph } from '@vt/graph-state/contract'

let latestProjectedGraph: ProjectedGraph | null = null
const subscribers: Set<(graph: ProjectedGraph | null) => void> = new Set()

export function publishLatestProjectedGraph(graph: ProjectedGraph): void {
    latestProjectedGraph = graph
    for (const callback of subscribers) {
        callback(graph)
    }
}

export function getLatestProjectedGraph(): ProjectedGraph | null {
    return latestProjectedGraph
}

export function subscribeLatestProjectedGraph(callback: (graph: ProjectedGraph | null) => void): () => void {
    subscribers.add(callback)
    return () => {
        subscribers.delete(callback)
    }
}
