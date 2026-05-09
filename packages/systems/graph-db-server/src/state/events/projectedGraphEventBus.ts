import type { ProjectedGraph } from '@vt/graph-state/contract'

export type ProjectedGraphEvent = {
  sessionId: string
  graph: ProjectedGraph
}

type ProjectedGraphCallback = (event: ProjectedGraphEvent) => void

const subscribers = new Set<ProjectedGraphCallback>()

export function publishProjectedGraph(event: ProjectedGraphEvent): void {
  for (const callback of subscribers) {
    callback(event)
  }
}

export function subscribeToProjectedGraph(callback: ProjectedGraphCallback): () => void {
  subscribers.add(callback)
  return () => { subscribers.delete(callback) }
}
