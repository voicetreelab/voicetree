import type { SelectionMode } from '../session/selection.ts'
import { applySelection } from '../session/selection.ts'
import type { Command } from '../domain/command.ts'
import type { Session } from '../domain/session.ts'

export function handleSelection(
  session: Session,
  nodeIds: readonly string[],
  mode: SelectionMode,
): {
  session: Session
  commands: Command[]
  response: { selection: string[] }
} {
  const nextSelection = applySelection(new Set(session.selection), nodeIds, mode)

  return {
    session: { ...session, selection: nextSelection },
    commands: [{ type: 'RegistryTouch', sessionId: session.id }],
    response: { selection: [...nextSelection] },
  }
}
