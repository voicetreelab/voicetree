// Electron-main adapter over the shared folder-tree payload builder. The actual
// projection (root + starred + external trees) lives in @vt/app-config/folders
// so VTD's browser-mode gateway builds the identical payload. This thin wrapper
// adapts the daemon-client `ProjectState` + full `Graph` to the structural input
// the shared builder takes (project paths + the set of in-graph file paths).

import type { Graph } from '@vt/graph-model'
import type { ProjectState } from '@vt/graph-db-client'
import {
  buildFolderTreeSyncPayload as buildSharedFolderTreeSyncPayload,
  type FolderTreeSyncPayload,
} from '@vt/app-config/folders'

export type { FolderTreeSyncPayload }

export async function buildFolderTreeSyncPayload(
  projectState: ProjectState,
  graph: Graph,
): Promise<FolderTreeSyncPayload> {
  return buildSharedFolderTreeSyncPayload(
    projectState,
    new Set<string>(Object.keys(graph.nodes)),
  )
}
