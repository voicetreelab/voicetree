import { project } from '@vt/graph-state'
import type { Session } from './types.ts'
import { buildDaemonState } from './buildDaemonState.ts'
import { publishProjectedGraph } from '../events/projectedGraphEventBus.ts'

export async function projectAndBroadcast(session: Session): Promise<ReturnType<typeof project>> {
  const state = await buildDaemonState(session)
  const graph = project(state)
  publishProjectedGraph({ sessionId: session.id, graph })
  return graph
}
