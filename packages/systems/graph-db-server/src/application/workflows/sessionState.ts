import {
  buildFolderTree,
  toAbsolutePath,
  type AbsolutePath,
  type DirectoryEntry,
  type FolderTreeNode,
} from '@vt/graph-model'
import type { LiveStateSnapshot } from '@vt/graph-db-server/contract'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { getReadPaths, getVaultPaths, getWriteFolder } from '@vt/graph-db-server/state/vaultAllowlist'
import { getFolderStateForActiveView } from '@vt/graph-db-server/views/folderStateOps'
import { getFolderTreeReadModel } from '@vt/graph-db-server/state/folder-tree-read-model-store'
import { handleReadSessionState } from '../core/handleSessionState.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

function resolveWriteFolder(
  writeFolderOption: Awaited<ReturnType<typeof getWriteFolder>>,
): AbsolutePath | null {
  const maybeValue = (writeFolderOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? toAbsolutePath(maybeValue) : null
}

function readFolderVisibilitySnapshot(
  projectRoot: string,
): Pick<LiveStateSnapshot, 'folderState' | 'activeView'> {
  if (!projectRoot) {
    return {
      folderState: [],
      activeView: { viewId: 'main', name: 'main' },
    }
  }

  return getFolderStateForActiveView(projectRoot) as Pick<
    LiveStateSnapshot,
    'folderState' | 'activeView'
  >
}

async function readFolderTreeForSnapshot(
  projectRoot: string | null,
  readPaths: readonly string[],
  vaultPaths: readonly string[],
  writeFolder: AbsolutePath | null,
  graphNodePaths: ReadonlySet<string>,
): Promise<FolderTreeNode | null> {
  if (!projectRoot) return null
  let directoryEntry: DirectoryEntry | null
  try {
    directoryEntry = await getFolderTreeReadModel().readRootTree({
      root: toAbsolutePath(projectRoot),
    })
  } catch {
    return null
  }
  if (!directoryEntry) return null
  return buildFolderTree(
    directoryEntry,
    new Set<string>([...readPaths, ...vaultPaths]),
    writeFolder,
    new Set<string>(graphNodePaths),
  )
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
  const projectRoot = getProjectRoot()
  const writeFolder = resolveWriteFolder(await getWriteFolder())
  const readPaths = [...(await getReadPaths())]
  const vaultPaths = await getVaultPaths()

  const folderTree = await readFolderTreeForSnapshot(
    projectRoot,
    readPaths,
    vaultPaths,
    writeFolder,
    new Set(Object.keys(graph.nodes)),
  )

  const result = handleReadSessionState({
    session,
    contentMode,
    graph,
    projectRoot,
    writeFolder,
    readPaths,
    folderTree,
    folderVisibility: readFolderVisibilitySnapshot(projectRoot ?? ''),
  })

  return jsonResult(result.response)
}
