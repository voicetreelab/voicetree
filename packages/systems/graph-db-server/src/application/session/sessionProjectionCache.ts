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
  readonly lastSeq: number
  readonly snapshot: DaemonStateSnapshot
}

type SessionProjectionCacheLease = {
  readonly current: () => SessionProjectionCache | null
  readonly replace: (cache: SessionProjectionCache) => void
  readonly clear: () => void
  readonly release: () => void
}

type SessionProjectionCacheRegistry = {
  readonly acquire: (sessionId: string) => SessionProjectionCacheLease
  readonly size: () => number
}

type RegistryEntry = {
  cache: SessionProjectionCache | null
  refCount: number
}

function folderStateSignature(session: Session): string {
  return [...session.folderState.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, state]) => `${path}:${state}`)
    .join('|')
}

function createSessionProjectionCache(
  snapshot: DaemonStateSnapshot,
  lastSeq: number = 0,
): SessionProjectionCache {
  return {
    folderStateSignature: folderStateSignature(snapshot.session),
    lastSeq,
    snapshot,
  }
}

function shouldRebuildSessionProjectionCache(input: {
  readonly cache: SessionProjectionCache | null
  readonly session: Session
  readonly vaultVersion: number
}): boolean {
  if (input.cache === null) return true
  if (input.cache.snapshot.session.id !== input.session.id) return true
  if (input.cache.snapshot.vaultVersion !== input.vaultVersion) return true
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
  if (event.seq <= cache.lastSeq) return cache

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
    lastSeq: event.seq,
    snapshot: {
      ...cache.snapshot,
      folderTree,
      graph,
    },
  }
}

function createSessionProjectionCacheRegistry(): SessionProjectionCacheRegistry {
  const entries = new Map<string, RegistryEntry>()

  return {
    acquire(sessionId: string): SessionProjectionCacheLease {
      const existing = entries.get(sessionId)
      const entry = existing ?? { cache: null, refCount: 0 }
      entry.refCount += 1
      if (!existing) entries.set(sessionId, entry)

      let released = false
      return {
        current: () => entry.cache,
        replace(cache: SessionProjectionCache): void {
          entry.cache = cache
        },
        clear(): void {
          entry.cache = null
        },
        release(): void {
          if (released) return
          released = true
          entry.refCount -= 1
          if (entry.refCount === 0) entries.delete(sessionId)
        },
      }
    },
    size: () => entries.size,
  }
}

export const sessionProjectionCache = {
  advance: advanceSessionProjectionCache,
  create: createSessionProjectionCache,
  createRegistry: createSessionProjectionCacheRegistry,
  project: projectSessionProjectionCache,
  shouldRebuild: shouldRebuildSessionProjectionCache,
}
