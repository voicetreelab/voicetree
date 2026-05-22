import type { State } from '@vt/graph-state'
import type { FolderTreeNode } from '@vt/graph-model'
import { buildFolderTree, toAbsolutePath } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { getReadPaths, getVaultPaths, getWritePath } from '@vt/graph-db-server/state/vaultAllowlist'
import { getDirectoryTree } from '@vt/graph-db-server/graph/folderScanner'
import type { VaultState } from '@vt/graph-db-server/contract'
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

  let folderTree: FolderTreeNode | null = null
  if (projectRoot) {
    try {
      const directoryEntry = await getDirectoryTree(projectRoot)
      folderTree = buildFolderTree(
        directoryEntry,
        new Set<string>([...readPaths, ...vaultPaths]),
        writePath ? toAbsolutePath(writePath) : null,
        new Set<string>(Object.keys(graph.nodes)),
      )
    } catch {
      folderTree = null
    }
  }

  const vault: VaultState = {
    vaultPath: projectRoot ?? '',
    readPaths,
    writePath: writePath ?? projectRoot ?? '',
  }

  return projectSessionState({ graph, vault, folderTree, session })
}
