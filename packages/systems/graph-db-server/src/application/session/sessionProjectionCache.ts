import type { State } from '@vt/graph-state'
import { toAbsolutePath } from '@vt/graph-model'
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph'
import type { ProjectDeltaEventInput } from '../core/handleSessionEvents.ts'
import { projectGraphDerivedFolderTree } from '../projection/graphDerivedFolderTree.ts'
import { projectSessionState } from './project.ts'
import type { Session } from './types.ts'
import { readDaemonStateSnapshot } from './buildDaemonState.ts'

type DaemonStateSnapshot = Awaited<ReturnType<typeof readDaemonStateSnapshot>>

type SessionProjectionCache = {
  readonly folderStateSignature: string
  readonly snapshot: DaemonStateSnapshot
}

function folderStateSignature(session: Session): string {
  return [...session.folderState.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, state]) => `${path}:${state}`)
    .join('|')
}

function createSessionProjectionCache(
  snapshot: DaemonStateSnapshot,
): SessionProjectionCache {
  return {
    folderStateSignature: folderStateSignature(snapshot.session),
    snapshot,
  }
}

function shouldRebuildSessionProjectionCache(input: {
  readonly cache: SessionProjectionCache | null
  readonly projectVersion: number
  readonly session: Session
}): boolean {
  if (input.cache === null) return true
  if (input.cache.snapshot.session.id !== input.session.id) return true
  if (input.cache.snapshot.projectVersion !== input.projectVersion) return true
  return input.cache.folderStateSignature !== folderStateSignature(input.session)
}

function projectSessionProjectionCache(
  cache: SessionProjectionCache,
): State {
  return projectSessionState({
    graph: cache.snapshot.graph,
    vault: cache.snapshot.vault,
    folderTree: cache.snapshot.folderTree,
    session: cache.snapshot.session,
  })
}

function advanceSessionProjectionCache(
  cache: SessionProjectionCache,
  event: ProjectDeltaEventInput,
): SessionProjectionCache {
  const graph = applyGraphDeltaToGraph(cache.snapshot.graph, event.delta)
  const folderTree = projectGraphDerivedFolderTree({
    graph,
    projectRoot: cache.snapshot.projectRoot
      ? toAbsolutePath(cache.snapshot.projectRoot)
      : null,
    readPaths: cache.snapshot.readPaths,
    vaultPaths: cache.snapshot.vaultPaths,
    writeFolder: cache.snapshot.writeFolder
      ? toAbsolutePath(cache.snapshot.writeFolder)
      : null,
  })

  return {
    ...cache,
    snapshot: {
      ...cache.snapshot,
      folderTree,
      graph,
    },
  }
}

export const sessionProjectionCache = {
  advance: advanceSessionProjectionCache,
  create: createSessionProjectionCache,
  project: projectSessionProjectionCache,
  shouldRebuild: shouldRebuildSessionProjectionCache,
}
