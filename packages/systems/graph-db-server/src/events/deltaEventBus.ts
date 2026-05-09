import type { GraphDelta } from '@vt/graph-model/graph'

export type SourceTaggedDelta = {
  delta: GraphDelta
  source: string
}

export type SequencedDeltaEvent = SourceTaggedDelta & {
  seq: number
}

export type DeltaEventCallback = (event: SequencedDeltaEvent) => void

const BUFFER_SIZE = 1000
const subscribers = new Set<DeltaEventCallback>()
const buffer: SequencedDeltaEvent[] = []
let nextSeq = 0

export function subscribe(callback: DeltaEventCallback): () => void {
  subscribers.add(callback)
  return () => { subscribers.delete(callback) }
}

export function publish(event: SourceTaggedDelta): { seq: number } {
  const sequencedEvent = { ...event, seq: ++nextSeq }
  buffer.push(sequencedEvent)
  if (buffer.length > BUFFER_SIZE) {
    buffer.shift()
  }

  for (const callback of subscribers) {
    callback(sequencedEvent)
  }

  return { seq: sequencedEvent.seq }
}

export function getDeltasSince(since: number): readonly SequencedDeltaEvent[] {
  return buffer.filter(event => event.seq > since)
}

export function getCurrentSeq(): number {
  return nextSeq
}

export function getOldestBufferedSeq(): number | null {
  return buffer[0]?.seq ?? null
}

export function isReplayAvailableSince(since: number): boolean {
  const oldestSeq = getOldestBufferedSeq()
  return oldestSeq === null || since >= oldestSeq - 1
}

export function subscriberCount(): number {
  return subscribers.size
}
