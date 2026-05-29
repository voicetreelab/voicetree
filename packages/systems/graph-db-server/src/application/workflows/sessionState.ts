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
import { getReadPaths, getProjectPaths, getWriteFolderPath } from '@vt/graph-db-server/state/projectAllowlist'
import { getFolderStateForActiveView } from '@vt/graph-db-server/views/folderStateOps'
import { getFolderTreeReadModel } from '@vt/graph-db-server/state/folder-tree-read-model-store'
import { handleReadSessionState } from '../core/handleSessionState.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

function resolveWriteFolderPath(
  writeFolderPathOption: Awaited<ReturnType<typeof getWriteFolderPath>>,
): AbsolutePath | null {
  const maybeValue = (writeFolderPathOption as { value?: unknown }).value
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
  projectPaths: readonly string[],
  writeFolderPath: AbsolutePath | null,
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
    new Set<string>([...readPaths, ...projectPaths]),
    writeFolderPath,
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
  const writeFolderPath = resolveWriteFolderPath(await getWriteFolderPath())
  const readPaths = [...(await getReadPaths())]
  const projectPaths = await getProjectPaths()

  const folderTree = await readFolderTreeForSnapshot(
    projectRoot,
    readPaths,
    projectPaths,
    writeFolderPath,
    new Set(Object.keys(graph.nodes)),
  )

  const result = handleReadSessionState({
    session,
    contentMode,
    graph,
    projectRoot,
    writeFolderPath,
    readPaths,
    folderTree,
    folderVisibility: readFolderVisibilitySnapshot(projectRoot ?? ''),
  })

  return jsonResult(result.response)
}
