// BF-214 · pure session-state projection.
// Assembles a @vt/graph-state State from the daemon's ambient sources
// (graph, vault, folder-tree) overlaid with a session's view state
// (collapseSet, selection, layout viewport). This is the same shape today's
// webapp/main `buildLiveStateSnapshot` emits — UI + CLI share this function in P7.
import { collectLayoutPositions } from '@vt/graph-state'
import type { State } from '@vt/graph-state'
import type { FolderTreeNode, Graph } from '@vt/graph-model'
import type { VaultState } from '@vt/graph-db-server/contract'
import type { Session } from './types.ts'

export interface ProjectSessionStateArgs {
  readonly graph: Graph
  readonly vault: VaultState
  readonly folderTree: FolderTreeNode | null
  readonly session: Session
}

function normalizeFolderPath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function isSameOrDescendantPath(path: string, maybeDescendant: string): boolean {
  const normalizedPath = normalizeFolderPath(path)
  const normalizedDescendant = normalizeFolderPath(maybeDescendant)
  return normalizedDescendant === normalizedPath
    || normalizedDescendant.startsWith(`${normalizedPath}/`)
}

function isDefaultExpandedFolder(
  folderPath: string,
  expandedTargets: ReadonlySet<string>,
): boolean {
  for (const target of expandedTargets) {
    if (isSameOrDescendantPath(folderPath, target)) {
      return true
    }
  }
  return false
}

function pruneFolderTree(
  node: FolderTreeNode,
  expandedTargets: ReadonlySet<string>,
  manualCollapsedFolders: ReadonlySet<string>,
): FolderTreeNode {
  const folderPath = normalizeFolderPath(node.absolutePath)
  if (
    manualCollapsedFolders.has(folderPath)
    || !isDefaultExpandedFolder(folderPath, expandedTargets)
  ) {
    return {
      ...node,
      children: [],
    }
  }

  return {
    ...node,
    children: node.children.map((child) =>
      'children' in child
        ? pruneFolderTree(child, expandedTargets, manualCollapsedFolders)
        : child,
    ),
  }
}

function projectFolderTree(
  folderTree: FolderTreeNode | null,
  vault: VaultState,
  session: Session,
): readonly FolderTreeNode[] {
  if (!folderTree) {
    return []
  }

  const expandedTargets = new Set(
    [vault.writePath, ...vault.readPaths]
      .filter((path) => path.length > 0)
      .map(normalizeFolderPath),
  )
  const manualCollapsedFolders = new Set(
    [...session.collapseSet].map(normalizeFolderPath),
  )

  return [pruneFolderTree(folderTree, expandedTargets, manualCollapsedFolders)]
}

export function projectSessionState(args: ProjectSessionStateArgs): State {
  const { graph, vault, folderTree, session } = args
  return {
    graph,
    roots: {
      loaded: new Set<string>([vault.writePath, ...vault.readPaths].filter((path) => path.length > 0)),
      folderTree: projectFolderTree(folderTree, vault, session),
    },
    collapseSet: new Set(session.collapseSet),
    selection: new Set(session.selection),
    layout: {
      positions: collectLayoutPositions(graph),
      zoom: session.layout.zoom,
      pan: session.layout.pan,
    },
    meta: {
      schemaVersion: 1,
      revision: 0,
      mutatedAt: new Date(session.lastAccessedAt).toISOString(),
    },
  }
}
