import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { SessionRegistry } from '../session/registry.ts'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { subscribe as subscribeDelta } from '../events/deltaEventBus.ts'
import { subscribeToProjectedGraph, type ProjectedGraphEvent } from '../events/projectedGraphEventBus.ts'
import { project } from '@vt/graph-state'
import { extractRecentNodesFromDelta } from '@vt/graph-model/graph'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import type { Session } from '../session/types.ts'

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

export function mountSessionEventsRoute(
  app: Hono,
  registry: SessionRegistry,
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

      let unsubscribeProjected: (() => void) | null = null
      let unsubscribeDelta: (() => void) | null = null

      const sendGraph = (graph: ProjectedGraph): void => {
        void s.write(formatSSE('projectedGraph', stringifyGraphForSSE(graph)))
      }

      unsubscribeProjected = subscribeToProjectedGraph((event: ProjectedGraphEvent) => {
        if (event.sessionId !== sessionId) return
        sendGraph(event.graph)
      })

      unsubscribeDelta = subscribeDelta((event) => {
        void (async () => {
          const freshSession: Session | null = registry.get(sessionId)
          if (!freshSession) return
          const state = await buildDaemonState(freshSession)
          const recentNodeIds = extractRecentNodesFromDelta(event.delta)
            .map(delta => delta.nodeToUpsert.absoluteFilePathIsID)
          const graph = { ...project(state), recentNodeIds }
          sendGraph(graph)
        })()
      })

      s.onAbort(() => {
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
