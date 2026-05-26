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

function sameSuppressSet(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const aSet = new Set(a ?? [])
  const bSet = new Set(b ?? [])
  if (aSet.size !== bSet.size) return false
  for (const value of aSet) if (!bSet.has(value)) return false
  return true
}

function coalesceHomogeneousBatch(
  events: readonly ProjectDeltaEventInput[],
): ProjectDeltaEventInput {
  const suppressForSubscribers = events[0]!.suppressForSubscribers ?? []
  return {
    delta: events.flatMap(event => event.delta),
    seq: events[events.length - 1]!.seq,
    ...(suppressForSubscribers.length > 0 ? { suppressForSubscribers } : {}),
  }
}

/**
 * Reduce a burst of buffered delta events into the minimal sequence of
 * projections the SSE wire needs to deliver.
 *
 * Events that share the same `suppressForSubscribers` set are coalesced
 * into one combined event (deltas concatenated, latest seq, shared
 * suppress preserved). Events with different suppress sets must NOT be
 * coalesced — the SSE renderer applies the projection's suppress set to
 * every nodeDelta in the batch, so unioning heterogeneous suppress sets
 * would cause editor-X to be skipped for updates that did not originate
 * from editor-X (e.g. a user's typing-echo suppression bleeding onto a
 * subsequent external write to the same node). Contiguous events with
 * matching suppress collapse; runs are split at every suppress-set
 * boundary.
 */
export function batchProjectDeltaEvents(
  events: readonly ProjectDeltaEventInput[],
): readonly ProjectDeltaEventInput[] {
  if (events.length === 0) return []
  const batches: ProjectDeltaEventInput[][] = [[events[0]!]]
  for (let i = 1; i < events.length; i++) {
    const current = events[i]!
    const lastBatch = batches[batches.length - 1]!
    const lastEvent = lastBatch[lastBatch.length - 1]!
    if (sameSuppressSet(lastEvent.suppressForSubscribers, current.suppressForSubscribers)) {
      lastBatch.push(current)
    } else {
      batches.push([current])
    }
  }
  return batches.map(coalesceHomogeneousBatch)
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
