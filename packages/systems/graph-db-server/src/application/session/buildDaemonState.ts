import type { State } from '@vt/graph-state'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode, Graph } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { getReadPaths, getVaultPaths, getWriteFolderPath } from '@vt/graph-db-server/state/vaultAllowlist'
import type { VaultState } from '@vt/graph-db-server/contract'
import { getProject } from '../workflows/state/projectState.ts'
import { projectGraphDerivedFolderTree } from '../projection/graphDerivedFolderTree.ts'
import type { Session } from './types.ts'
import { projectSessionState } from './project.ts'

type DaemonStateSnapshot = {
  readonly folderTree: FolderTreeNode | null
  readonly graph: Graph
  readonly projectRoot: string | null
  readonly projectVersion: number
  readonly readPaths: readonly string[]
  readonly session: Session
  readonly vault: VaultState
  readonly vaultPaths: readonly string[]
  readonly vaultVersion: number
  readonly writeFolderPath: string | null
}

function resolveWriteFolderPath(
  writeFolderPathOption: Awaited<ReturnType<typeof getWriteFolderPath>>,
): string | null {
  const maybeValue = (writeFolderPathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? maybeValue : null
}

function getProjectVersion(): number {
  return getProject()?.version ?? 0
}

function getVaultVersion(): number {
  return getProject()?.vaultVersion ?? 0
}

export async function readDaemonStateSnapshot(session: Session): Promise<DaemonStateSnapshot> {
  const graph = getGraph()
  const projectRoot = getProjectRoot()
  const projectVersion = getProjectVersion()
  const vaultVersion = getVaultVersion()
  const writeFolderPath = resolveWriteFolderPath(await getWriteFolderPath())
  const readPaths = [...(await getReadPaths())]
  const vaultPaths = await getVaultPaths()

  const folderTree: FolderTreeNode | null = projectGraphDerivedFolderTree({
    graph,
    projectRoot: projectRoot ? toAbsolutePath(projectRoot) : null,
    readPaths,
    vaultPaths,
    writeFolderPath: writeFolderPath ? toAbsolutePath(writeFolderPath) : null,
  })

  const vault: VaultState = {
    projectRoot: projectRoot ?? '',
    readPaths,
    writeFolderPath: writeFolderPath ?? projectRoot ?? '',
  }

  return {
    folderTree,
    graph,
    projectRoot,
    projectVersion,
    readPaths,
    session,
    vault,
    vaultPaths,
    vaultVersion,
    writeFolderPath,
  }
}

function projectDaemonStateSnapshot(snapshot: DaemonStateSnapshot): State {
  return projectSessionState({
    graph: snapshot.graph,
    vault: snapshot.vault,
    folderTree: snapshot.folderTree,
    session: snapshot.session,
  })
}

export async function buildDaemonState(session: Session): Promise<State> {
  return projectDaemonStateSnapshot(await readDaemonStateSnapshot(session))
}
