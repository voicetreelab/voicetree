import {
  buildFolderTree,
  toAbsolutePath,
  type AbsolutePath,
  type FolderTreeNode,
} from '@vt/graph-model'
import type { LiveStateSnapshot } from '@vt/graph-db-server/contract'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { getDirectoryTree } from '@vt/graph-db-server/graph/folderScanner'
import { getReadPaths, getVaultPaths, getWritePath } from '@vt/graph-db-server/state/vaultAllowlist'
import { getFolderStateForActiveView } from '@vt/graph-db-server/views/folderStateOps'
import { handleReadSessionState } from '../core/handleSessionState.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

function resolveWritePath(
  writePathOption: Awaited<ReturnType<typeof getWritePath>>,
): AbsolutePath | null {
  const maybeValue = (writePathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? toAbsolutePath(maybeValue) : null
}

function readFolderVisibilitySnapshot(
  vaultPath: string,
): Pick<LiveStateSnapshot, 'folderState' | 'activeView'> {
  if (!vaultPath) {
    return {
      folderState: [],
      activeView: { viewId: 'main', name: 'main' },
    }
  }

  return getFolderStateForActiveView(vaultPath) as Pick<
    LiveStateSnapshot,
    'folderState' | 'activeView'
  >
}

export async function readSessionStateWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  contentMode: string | undefined,
): Promise<HttpResult> {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const graph = getGraph()
  const projectRoot = getProjectRootWatchedDirectory()
  const writePath = resolveWritePath(await getWritePath())
  const readPaths = [...(await getReadPaths())]
  const vaultPaths = await getVaultPaths()

  let folderTree: FolderTreeNode | null = null
  if (projectRoot) {
    try {
      const directoryEntry = await getDirectoryTree(projectRoot)
      folderTree = buildFolderTree(
        directoryEntry,
        new Set<string>([...readPaths, ...vaultPaths]),
        writePath,
        new Set<string>(Object.keys(graph.nodes)),
      )
    } catch {
      folderTree = null
    }
  }

  const result = handleReadSessionState({
    session,
    contentMode,
    graph,
    projectRoot,
    writePath,
    readPaths,
    folderTree,
    folderVisibility: readFolderVisibilitySnapshot(projectRoot ?? ''),
  })

  return jsonResult(result.response)
}
