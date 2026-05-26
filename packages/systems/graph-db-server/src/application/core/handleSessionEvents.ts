import type { GraphDelta } from '@vt/graph-model/graph'
import { extractRecentNodesFromDelta } from '@vt/graph-model/graph'
import { project, type State } from '@vt/graph-state'
import type { ProjectedGraph } from '@vt/graph-state/contract'

export type ProjectDeltaEventInput = {
  readonly delta: GraphDelta
  readonly seq: number
  readonly suppressForSubscribers?: readonly string[]
}

export type ReplayStrategy =
  | { readonly kind: 'replay' }
  | {
      readonly kind: 'reset'
      readonly requestedSince: number
      readonly oldestSeq: number
    }

export function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

export function stringifyGraphForSSE(graph: ProjectedGraph): string {
  return JSON.stringify(graph, (_key: string, value: unknown) => {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries())
    }
    return value
  })
}

export function coalesceProjectDeltaEvents(
  events: readonly ProjectDeltaEventInput[],
): ProjectDeltaEventInput | null {
  if (events.length === 0) return null

  const suppressForSubscribers = [
    ...new Set(events.flatMap(event => event.suppressForSubscribers ?? [])),
  ]

  return {
    delta: events.flatMap(event => event.delta),
    seq: events[events.length - 1]!.seq,
    ...(suppressForSubscribers.length > 0 ? { suppressForSubscribers } : {}),
  }
}

export function parseSince(rawSince: string | undefined, currentSeq: number): number {
  if (rawSince === undefined) return currentSeq

  const parsed = Number.parseInt(rawSince, 10)
  if (!Number.isFinite(parsed)) return currentSeq
  return Math.max(0, parsed)
}

export function handleProjectDeltaEvent(
  state: State,
  deltaEvent: ProjectDeltaEventInput,
): { graph: ProjectedGraph } {
  const recentNodeIds = extractRecentNodesFromDelta(deltaEvent.delta)
    .map(delta => delta.nodeToUpsert.absoluteFilePathIsID)

  return {
    graph: {
      ...project(state),
      recentNodeIds,
      seq: deltaEvent.seq,
      suppressForSubscribers: deltaEvent.suppressForSubscribers,
    },
  }
}

export function handleReplayResetSnapshot(
  state: State,
  requestedSince: number,
  oldestSeq: number,
  snapshotSeq: number,
): { graph: ProjectedGraph } {
  return {
    graph: {
      ...project(state),
      recentNodeIds: [],
      seq: snapshotSeq,
      replayReset: {
        reason: 'buffer_evicted',
        requestedSince,
        oldestSeq,
        currentSeq: snapshotSeq,
      },
    },
  }
}

export function decideReplayStrategy(input: {
  readonly requestedSince: number
  readonly oldestSeq: number | null
  readonly isReplayAvailable: boolean
}): ReplayStrategy {
  if (!input.isReplayAvailable && input.oldestSeq !== null) {
    return {
      kind: 'reset',
      requestedSince: input.requestedSince,
      oldestSeq: input.oldestSeq,
    }
  }

  return { kind: 'replay' }
}
