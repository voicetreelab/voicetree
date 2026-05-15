import { dispatchCollapse, dispatchExpand } from '@vt/graph-state/state/collapseSetStore'
import type { Command } from './command.ts'
import type { Session } from './session.ts'

export type CollapseAction = 'collapse' | 'expand'

export function handleCollapse(
  session: Session,
  folderId: string,
  action: CollapseAction,
): { session: Session; commands: Command[]; response: { collapseSet: string[] } } {
  const collapseSet = action === 'collapse'
    ? dispatchCollapse(session.collapseSet, folderId)
    : dispatchExpand(session.collapseSet, folderId)
  const nextSession = { ...session, collapseSet }

  return {
    session: nextSession,
    commands: [
      { type: 'RegistryTouch', sessionId: session.id },
      { type: 'ProjectAndBroadcast', session: nextSession },
    ],
    response: { collapseSet: [...collapseSet] },
  }
}
