import type { State } from '@vt/graph-state'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { getReadPaths, getVaultPaths, getWriteFolder } from '@vt/graph-db-server/state/vaultAllowlist'
import type { VaultState } from '@vt/graph-db-server/contract'
import { projectGraphDerivedFolderTree } from '../projection/graphDerivedFolderTree.ts'
import type { Session } from './types.ts'
import { projectSessionState } from './project.ts'

function resolveWriteFolder(
  writeFolderOption: Awaited<ReturnType<typeof getWriteFolder>>,
): string | null {
  const maybeValue = (writeFolderOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? maybeValue : null
}

export async function buildDaemonState(session: Session): Promise<State> {
  const graph = getGraph()
  const projectRoot = getProjectRoot()
  const writeFolder = resolveWriteFolder(await getWriteFolder())
  const readPaths = [...(await getReadPaths())]
  const vaultPaths = await getVaultPaths()

  const folderTree: FolderTreeNode | null = projectGraphDerivedFolderTree({
    graph,
    projectRoot: projectRoot ? toAbsolutePath(projectRoot) : null,
    readPaths,
    vaultPaths,
    writeFolder: writeFolder ? toAbsolutePath(writeFolder) : null,
  })

  const vault: VaultState = {
    projectRoot: projectRoot ?? '',
    readPaths,
    writeFolder: writeFolder ?? projectRoot ?? '',
  }

  return projectSessionState({ graph, vault, folderTree, session })
}
