import type { ProjectedGraph } from '@vt/graph-state/contract'
import {
  decideReplayStrategy,
  formatSSE,
  handleProjectDeltaEvent,
  handleReplayResetSnapshot,
  parseSince,
  stringifyGraphForSSE,
} from '../../core/handleSessionEvents.ts'
import { buildDaemonState } from '../../session/buildDaemonState.ts'
import type { Session } from '../../session/types.ts'
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

  const sendGraph = (graph: ProjectedGraph): void => {
    void stream.write(formatSSE('projectedGraph', stringifyGraphForSSE(graph)))
  }

  const projectDeltaForSession = async (
    event: SequencedDeltaEvent,
  ): Promise<ProjectedGraph | null> => {
    const freshSession: Session | null = registry.get(sessionId)
    if (!freshSession) return null

    const state = await buildDaemonState(freshSession)
    return handleProjectDeltaEvent(state, event).graph
  }

  const sendDeltaProjection = async (event: SequencedDeltaEvent): Promise<void> => {
    const graph = await projectDeltaForSession(event)
    if (!graph) return
    sendGraph(graph)
  }

  const sendReplayResetSnapshot = async (
    requestedSince: number,
    oldestSeq: number,
  ): Promise<number> => {
    const snapshotSeq = getCurrentSeq()
    const freshSession: Session | null = registry.get(sessionId)
    if (!freshSession) return snapshotSeq

    const state = await buildDaemonState(freshSession)
    sendGraph(handleReplayResetSnapshot(
      state,
      requestedSince,
      oldestSeq,
      snapshotSeq,
    ).graph)
    return snapshotSeq
  }

  unsubscribeProjected = subscribeToProjectedGraph((event: ProjectedGraphEvent) => {
    if (event.sessionId !== sessionId) return
    sendGraph(event.graph)
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
    void sendDeltaProjection(event)
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
      void sendDeltaProjection(event)
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
