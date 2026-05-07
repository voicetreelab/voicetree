import { project } from '@vt/graph-state'
import type { Session } from './types.ts'
import { buildDaemonState } from './buildDaemonState.ts'

export async function projectAndBroadcast(session: Session): Promise<ReturnType<typeof project>> {
  const state = await buildDaemonState(session)
  const graph = project(state)
  // Wave 2 (BF-257): pushSSE(session.id, graph)
  return graph
}
