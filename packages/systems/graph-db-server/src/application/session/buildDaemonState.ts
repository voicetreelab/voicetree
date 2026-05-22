import type { State } from '@vt/graph-state'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { getReadPaths, getVaultPaths, getWritePath } from '@vt/graph-db-server/state/vaultAllowlist'
import type { VaultState } from '@vt/graph-db-server/contract'
import { projectGraphDerivedFolderTree } from '../projection/graphDerivedFolderTree.ts'
import type { Session } from './types.ts'
import { projectSessionState } from './project.ts'

function resolveWritePath(
  writePathOption: Awaited<ReturnType<typeof getWritePath>>,
): string | null {
  const maybeValue = (writePathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? maybeValue : null
}

export async function buildDaemonState(session: Session): Promise<State> {
  const graph = getGraph()
  const projectRoot = getProjectRootWatchedDirectory()
  const writePath = resolveWritePath(await getWritePath())
  const readPaths = [...(await getReadPaths())]
  const vaultPaths = await getVaultPaths()

  const folderTree: FolderTreeNode | null = projectGraphDerivedFolderTree({
    graph,
    projectRoot: projectRoot ? toAbsolutePath(projectRoot) : null,
    readPaths,
    vaultPaths,
    writePath: writePath ? toAbsolutePath(writePath) : null,
  })

  const vault: VaultState = {
    vaultPath: projectRoot ?? '',
    readPaths,
    writePath: writePath ?? projectRoot ?? '',
  }

  return projectSessionState({ graph, vault, folderTree, session })
}
