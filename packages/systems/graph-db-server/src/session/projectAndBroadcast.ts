import { project } from '@vt/graph-state'
import type { Session } from './types.ts'
import { buildDaemonState } from './buildDaemonState.ts'
import { publishProjectedGraph } from '../state/events/projectedGraphEventBus.ts'

export async function projectAndBroadcast(session: Session): Promise<ReturnType<typeof project>> {
  const state = await buildDaemonState(session)
  const graph: ReturnType<typeof project> = { ...project(state), recentNodeIds: [] }
  publishProjectedGraph({ sessionId: session.id, graph })
  return graph
}
