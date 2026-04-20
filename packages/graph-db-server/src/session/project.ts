// BF-214 · pure session-state projection.
// Assembles a @vt/graph-state State from the daemon's ambient sources
// (graph, vault, folder-tree) overlaid with a session's view state
// (collapseSet, selection, layout viewport). This is the same shape today's
// webapp/main `buildLiveStateSnapshot` emits — UI + CLI share this function in P7.
import { collectLayoutPositions } from '@vt/graph-state'
import type { State } from '@vt/graph-state'
import type { FolderTreeNode, Graph } from '@vt/graph-model'
import type { VaultState } from '../contract.ts'
import type { Session } from './types.ts'

export interface ProjectSessionStateArgs {
  readonly graph: Graph
  readonly vault: VaultState
  readonly folderTree: FolderTreeNode | null
  readonly session: Session
}

export function projectSessionState(args: ProjectSessionStateArgs): State {
  const { graph, vault, folderTree, session } = args
  return {
    graph,
    roots: {
      loaded: new Set<string>(vault.readPaths),
      folderTree: folderTree ? [folderTree] : [],
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
