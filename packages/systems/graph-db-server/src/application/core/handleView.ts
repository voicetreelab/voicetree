import { project, type State } from '@vt/graph-state'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { renderTreeCover } from '@vt/graph-tools/autoView'
import type { Command } from './command.ts'
import type { Session } from './session.ts'

function normalizeFolderIds(ids: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...ids].map((id) => id.endsWith('/') ? id.slice(0, -1) : id))
}

export function handleRenderView(
  session: Session,
  state: State,
  budgetParam: string | undefined,
  titleParam: string | undefined,
  expandParams: readonly string[],
): {
  commands: Command[]
  response: { output: string; format: 'tree-cover' }
} {
  const budget = budgetParam ? Math.max(1, Math.trunc(Number(budgetParam))) : 30
  const mergedExpands = [...session.expandOverrides, ...expandParams]
  const graph = project(state)

  return {
    commands: [],
    response: {
      output: renderTreeCover(graph, {
        collapsed: normalizeFolderIds(session.collapseSet),
        selected: session.selection,
        pinnedFolderIds: mergedExpands,
        budget,
        title: titleParam,
      }),
      format: 'tree-cover',
    },
  }
}

export function handleReadProjectedGraph(
  state: State,
): { commands: Command[]; response: ProjectedGraph } {
  return {
    commands: [],
    response: project(state),
  }
}

export function handleAddExpandOverride(
  session: Session,
  folderId: string,
): {
  session: Session
  commands: Command[]
  response: { expandOverrides: string[] }
} {
  const expandOverrides = new Set(session.expandOverrides)
  expandOverrides.add(folderId)

  return {
    session: { ...session, expandOverrides },
    commands: [{ type: 'RegistryTouch', sessionId: session.id }],
    response: { expandOverrides: [...expandOverrides] },
  }
}

export function handleDeleteExpandOverride(
  session: Session,
  folderId: string,
): {
  session: Session
  commands: Command[]
  response: { expandOverrides: string[] }
} {
  const expandOverrides = new Set(session.expandOverrides)
  expandOverrides.delete(folderId)

  return {
    session: { ...session, expandOverrides },
    commands: [{ type: 'RegistryTouch', sessionId: session.id }],
    response: { expandOverrides: [...expandOverrides] },
  }
}
