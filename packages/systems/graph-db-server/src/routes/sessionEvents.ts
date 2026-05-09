import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { SessionRegistry } from '../session/registry.ts'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import {
  getCurrentSeq,
  getDeltasSince,
  getOldestBufferedSeq,
  isReplayAvailableSince,
  subscribe as subscribeDelta,
  type SequencedDeltaEvent,
} from '../events/deltaEventBus.ts'
import { subscribeToProjectedGraph, type ProjectedGraphEvent } from '../events/projectedGraphEventBus.ts'
import { project } from '@vt/graph-state'
import { extractRecentNodesFromDelta } from '@vt/graph-model/graph'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import type { Session } from '../session/types.ts'

type SessionEventTimers = {
  readonly setInterval: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setInterval>
  readonly clearInterval: (timerId: ReturnType<typeof setInterval>) => void
}

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

function stringifyGraphForSSE(graph: ProjectedGraph): string {
  return JSON.stringify(graph, (_key: string, value: unknown) => {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries())
    }
    return value
  })
}

function parseSince(rawSince: string | undefined, currentSeq: number): number {
  if (rawSince === undefined) return currentSeq

  const parsed = Number.parseInt(rawSince, 10)
  if (!Number.isFinite(parsed)) return currentSeq
  return Math.max(0, parsed)
}

export function mountSessionEventsRoute(
  app: Hono,
  registry: SessionRegistry,
  timers: SessionEventTimers = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  },
): void {
  app.get('/sessions/:sessionId/events', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async (s) => {
      await s.write(': connected\n\n')
      const keepaliveId = timers.setInterval(
        () => void s.write(': keepalive\n\n'),
        20_000,
      )

      let unsubscribeProjected: (() => void) | null = null
      let unsubscribeDelta: (() => void) | null = null

      const sendGraph = (graph: ProjectedGraph): void => {
        void s.write(formatSSE('projectedGraph', stringifyGraphForSSE(graph)))
      }

      const projectDeltaForSession = async (event: SequencedDeltaEvent): Promise<ProjectedGraph | null> => {
        const freshSession: Session | null = registry.get(sessionId)
        if (!freshSession) return null

        const state = await buildDaemonState(freshSession)
        const recentNodeIds = extractRecentNodesFromDelta(event.delta)
          .map(delta => delta.nodeToUpsert.absoluteFilePathIsID)
        return { ...project(state), recentNodeIds, seq: event.seq }
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
        sendGraph({
          ...project(state),
          recentNodeIds: [],
          seq: snapshotSeq,
          replayReset: {
            reason: 'buffer_evicted',
            requestedSince,
            oldestSeq,
            currentSeq: snapshotSeq,
          },
        })
        return snapshotSeq
      }

      unsubscribeProjected = subscribeToProjectedGraph((event: ProjectedGraphEvent) => {
        if (event.sessionId !== sessionId) return
        sendGraph(event.graph)
      })

      const currentSeqAtConnect = getCurrentSeq()
      const requestedSince = parseSince(c.req.query('since'), currentSeqAtConnect)
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
      if (!isReplayAvailableSince(requestedSince) && oldestSeq !== null) {
        highWaterSeq = await sendReplayResetSnapshot(requestedSince, oldestSeq)
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

      s.onAbort(() => {
        timers.clearInterval(keepaliveId)
        unsubscribeProjected?.()
        unsubscribeDelta?.()
        unsubscribeProjected = null
        unsubscribeDelta = null
      })

      await new Promise<void>((resolve) => {
        s.onAbort(() => resolve())
      })
    })
  })
}
