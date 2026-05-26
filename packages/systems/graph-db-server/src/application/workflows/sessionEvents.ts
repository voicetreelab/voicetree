import type { ProjectedGraph } from '@vt/graph-state/contract'
import {
  batchProjectDeltaEvents,
  decideReplayStrategy,
  formatSSE,
  handleProjectDeltaEvent,
  handleReplayResetSnapshot,
  parseSince,
  stringifyGraphForSSE,
  type ProjectDeltaEventInput,
} from '../core/handleSessionEvents.ts'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import type { Session } from '../session/types.ts'
import {
  getCurrentSeq,
  getDeltasSince,
  getOldestBufferedSeq,
  isReplayAvailableSince,
  subscribe as subscribeDelta,
  type SequencedDeltaEvent,
} from '@vt/graph-db-server/state/events/deltaEventBus'
import {
  subscribeToProjectedGraph,
  type ProjectedGraphEvent,
} from '@vt/graph-db-server/state/events/projectedGraphEventBus'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'
import { traceGraphdSpan } from '@vt/graph-db-server/watch-folder/paths/traceGraphdSpan'

export type SessionEventTimers = {
  readonly setInterval: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setInterval>
  readonly clearInterval: (timerId: ReturnType<typeof setInterval>) => void
}

export type SessionEventStream = {
  readonly write: (chunk: string) => Promise<void>
  readonly onAbort: (callback: () => void) => void
}

export function sessionExistsWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
): boolean {
  return registry.get(sessionId) !== null
}

export async function runSessionEventsWorkflow(input: {
  readonly registry: WorkflowSessionRegistry
  readonly sessionId: string
  readonly since: string | undefined
  readonly timers: SessionEventTimers
  readonly stream: SessionEventStream
}): Promise<void> {
  const { registry, sessionId, since, timers, stream } = input
  await stream.write(': connected\n\n')
  const keepaliveId = timers.setInterval(
    () => void stream.write(': keepalive\n\n'),
    20_000,
  )

  let unsubscribeProjected: (() => void) | null = null
  let unsubscribeDelta: (() => void) | null = null

  const sendGraph = async (graph: ProjectedGraph): Promise<void> => {
    const payload = await traceGraphdSpan('session.events.stringify-projected-graph', async (span) => {
      const data = stringifyGraphForSSE(graph)
      span.setAttribute('graph.seq', graph.seq ?? 0)
      span.setAttribute('graph.nodes', graph.nodes.length)
      span.setAttribute('graph.edges', graph.edges.length)
      span.setAttribute('graph.recent_nodes', graph.recentNodeIds?.length ?? 0)
      span.setAttribute('sse.data_bytes', Buffer.byteLength(data, 'utf8'))
      return formatSSE('projectedGraph', data)
    })

    await traceGraphdSpan('session.events.write-projected-graph-sse', async (span) => {
      span.setAttribute('graph.seq', graph.seq ?? 0)
      span.setAttribute('sse.payload_bytes', Buffer.byteLength(payload, 'utf8'))
      await stream.write(payload)
    })
  }

  const projectDeltaForSession = async (
    event: ProjectDeltaEventInput,
  ): Promise<ProjectedGraph | null> => {
    const freshSession: Session | null = registry.get(sessionId)
    if (!freshSession) return null

    const state = await traceGraphdSpan('session.events.build-daemon-state', async (span) => {
      span.setAttribute('session.id', sessionId)
      span.setAttribute('graph.delta.seq', event.seq)
      span.setAttribute('graph.delta.actions', event.delta.length)
      return await buildDaemonState(freshSession)
    })

    return await traceGraphdSpan('session.events.project-delta', async (span) => {
      span.setAttribute('session.id', sessionId)
      span.setAttribute('graph.delta.seq', event.seq)
      span.setAttribute('graph.delta.actions', event.delta.length)
      const graph = handleProjectDeltaEvent(state, event).graph
      span.setAttribute('graph.nodes', graph.nodes.length)
      span.setAttribute('graph.edges', graph.edges.length)
      span.setAttribute('graph.recent_nodes', graph.recentNodeIds?.length ?? 0)
      return graph
    })
  }

  const sendDeltaProjection = async (event: ProjectDeltaEventInput): Promise<void> => {
    const graph = await projectDeltaForSession(event)
    if (!graph) return
    await sendGraph(graph)
  }

  let pendingLiveEvents: SequencedDeltaEvent[] = []
  let liveFlushScheduled = false
  const flushLiveDeltaProjection = async (): Promise<void> => {
    liveFlushScheduled = false
    const events = pendingLiveEvents
    pendingLiveEvents = []
    for (const batched of batchProjectDeltaEvents(events)) {
      await sendDeltaProjection(batched)
    }
    if (pendingLiveEvents.length > 0 && !liveFlushScheduled) {
      liveFlushScheduled = true
      queueMicrotask(() => void flushLiveDeltaProjection())
    }
  }

  const enqueueLiveDeltaProjection = (event: SequencedDeltaEvent): void => {
    pendingLiveEvents.push(event)
    if (liveFlushScheduled) return
    liveFlushScheduled = true
    queueMicrotask(() => void flushLiveDeltaProjection())
  }

  const sendReplayResetSnapshot = async (
    requestedSince: number,
    oldestSeq: number,
  ): Promise<number> => {
    const snapshotSeq = getCurrentSeq()
    const freshSession: Session | null = registry.get(sessionId)
    if (!freshSession) return snapshotSeq

    const state = await buildDaemonState(freshSession)
    await sendGraph(handleReplayResetSnapshot(
      state,
      requestedSince,
      oldestSeq,
      snapshotSeq,
    ).graph)
    return snapshotSeq
  }

  unsubscribeProjected = subscribeToProjectedGraph((event: ProjectedGraphEvent) => {
    if (event.sessionId !== sessionId) return
    void sendGraph(event.graph)
  })

  const currentSeqAtConnect = getCurrentSeq()
  const requestedSince = parseSince(since, currentSeqAtConnect)
  const replayEvents = getDeltasSince(requestedSince)
  let highWaterSeq = replayEvents.at(-1)?.seq ?? requestedSince
  let replayComplete = false
  const queuedLiveEvents: SequencedDeltaEvent[] = []

  unsubscribeDelta = subscribeDelta((event) => {
    if (!replayComplete) {
      queuedLiveEvents.push(event)
      return
    }
    enqueueLiveDeltaProjection(event)
  })

  const oldestSeq = getOldestBufferedSeq()
  const replayStrategy = decideReplayStrategy({
    requestedSince,
    oldestSeq,
    isReplayAvailable: isReplayAvailableSince(requestedSince),
  })
  if (replayStrategy.kind === 'reset') {
    highWaterSeq = await sendReplayResetSnapshot(
      replayStrategy.requestedSince,
      replayStrategy.oldestSeq,
    )
  } else {
    for (const event of replayEvents) {
      await sendDeltaProjection(event)
    }
  }

  replayComplete = true
  for (const event of queuedLiveEvents) {
    if (event.seq > highWaterSeq) {
      enqueueLiveDeltaProjection(event)
    }
  }

  stream.onAbort(() => {
    timers.clearInterval(keepaliveId)
    unsubscribeProjected?.()
    unsubscribeDelta?.()
    unsubscribeProjected = null
    unsubscribeDelta = null
  })

  await new Promise<void>((resolve) => {
    stream.onAbort(() => resolve())
  })
}
