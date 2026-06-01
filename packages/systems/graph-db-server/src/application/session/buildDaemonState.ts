import type { State } from '@vt/graph-state'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode, Graph } from '@vt/graph-model'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { getReadPaths, getProjectPaths, getWriteFolderPath } from '@vt/graph-db-server/state/projectAllowlist'
import type { ProjectState } from '@vt/graph-db-server/contract'
import { getProject } from '../workflows/state/projectState.ts'
import { projectGraphDerivedFolderTree } from '../projection/graphDerivedFolderTree.ts'
import type { Session } from './types.ts'
import { projectSessionState } from './project.ts'

type DaemonStateSnapshot = {
  readonly folderTree: FolderTreeNode | null
  readonly graph: Graph
  readonly projectRoot: string | null
  readonly graphVersion: number
  readonly readPaths: readonly string[]
  readonly session: Session
  readonly project: ProjectState
  readonly projectPaths: readonly string[]
  readonly projectPathsVersion: number
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

function getProjectPathsVersion(): number {
  return getProject()?.projectPathsVersion ?? 0
}

export async function readDaemonStateSnapshot(session: Session): Promise<DaemonStateSnapshot> {
  const graph = getGraph()
  const projectRoot = getProjectRoot()
  const graphVersion = getProjectVersion()
  const projectPathsVersion = getProjectPathsVersion()
  const writeFolderPath = resolveWriteFolderPath(await getWriteFolderPath())
  const readPaths = [...(await getReadPaths())]
  const projectPaths = await getProjectPaths()

  const folderTree: FolderTreeNode | null = projectGraphDerivedFolderTree({
    graph,
    projectRoot: projectRoot ? toAbsolutePath(projectRoot) : null,
    readPaths,
    projectPaths,
    writeFolderPath: writeFolderPath ? toAbsolutePath(writeFolderPath) : null,
  })

  const project: ProjectState = {
    projectRoot: projectRoot ?? '',
    readPaths,
    writeFolderPath: writeFolderPath ?? projectRoot ?? '',
  }

  return {
    folderTree,
    graph,
    graphVersion,
    projectRoot,
    readPaths,
    session,
    project,
    projectPaths,
    projectPathsVersion,
    writeFolderPath,
  }
}

function projectDaemonStateSnapshot(snapshot: DaemonStateSnapshot): State {
  return projectSessionState({
    graph: snapshot.graph,
    project: snapshot.project,
    folderTree: snapshot.folderTree,
    session: snapshot.session,
  })
}

export async function buildDaemonState(session: Session): Promise<State> {
  return projectDaemonStateSnapshot(await readDaemonStateSnapshot(session))
}
