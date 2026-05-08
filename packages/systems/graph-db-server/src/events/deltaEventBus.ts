import type { GraphDelta } from '@vt/graph-model/graph'

export type SourceTaggedDelta = {
  delta: GraphDelta
  source: string
}

export type DeltaEventCallback = (event: SourceTaggedDelta) => void

const subscribers = new Set<DeltaEventCallback>()

export function subscribe(callback: DeltaEventCallback): () => void {
  subscribers.add(callback)
  return () => { subscribers.delete(callback) }
}

export function publish(event: SourceTaggedDelta): void {
  for (const callback of subscribers) {
    callback(event)
  }
}

export function subscriberCount(): number {
  return subscribers.size
}
