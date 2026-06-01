import { access } from 'node:fs/promises'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import normalizePath from 'normalize-path'
import {
  type GraphNode,
  isImageNode,
  type FSDelete,
  type FSUpdate,
} from '@vt/graph-model'
import { toAbsolutePath } from '@vt/graph-model/folders'
import { handleFSEventWithStateAndUISides } from './handleFSEvent.ts'
import {
  readFileWithRetry,
  createWatchIgnorePredicate,
} from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
import type { FileWatcherLogger } from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
import { shouldIngestAddedFile } from '@vt/graph-db-server/watch-folder/watching/folderLoadGate'
import { consumeBroadcastSuppression } from '@vt/graph-db-server/watch-folder/pending-writes'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getFolderTreeReadModel } from '@vt/graph-db-server/state/folder-tree-read-model-store'

const RECENT_LOADED_DELETE_TTL_MS = 15_000

export type Watcher = {
  readonly ready: Promise<void>
  add(path: string): void
  unwatch(path: string): void
  unmount(): Promise<void>
}

export interface MountWatcherDependencies {
  readonly readFileWithRetry: typeof readFileWithRetry
  readonly handleFSEvent: typeof handleFSEventWithStateAndUISides
  readonly logger: FileWatcherLogger
  /** The loaded graph's `nodes` record, read fresh per 'add' to decide whether
   *  an added file's containing folder is already loaded. */
  readonly getGraphNodes: () => Readonly<Record<string, unknown>>
}

const defaultMountWatcherDependencies: MountWatcherDependencies = {
  readFileWithRetry,
  handleFSEvent: handleFSEventWithStateAndUISides,
  logger: {
    error(message?: unknown, ...optionalParams: unknown[]): void {
      console.error(message, ...optionalParams)
    },
  },
  getGraphNodes: () => getGraph().nodes,
}

function waitForReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      watcher.off('ready', onReady)
      watcher.off('error', onError)
    }
    const onReady = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: unknown): void => {
      cleanup()
      reject(error)
    }

    watcher.once('ready', onReady)
    watcher.once('error', onError)
  })
}

function buildWatcherOptions(watchRoots: readonly string[]) {
  // fsevents on macOS silently drops 'add' events for some project paths
  // (reproduced deterministically: chokidar 3.6.0 + fsevents 2.3.3, dir under
  // ~/Voicetree/voicetree-…/voicetree-…/). Polling is the only reliable
  // backend in dev where this matters most for agent progress nodes.
  const usePolling =
    process.env.HEADLESS_TEST === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development'

  return {
    // Shared single-source-of-truth predicate (see createWatchIgnorePredicate):
    // accepts .md/image files below a watch root, excludes hidden/noise dirs
    // such as `.voicetree/`, and preserves the fsevents-readiness invariant
    // (never ignore a directory or a stats-less path) that prevents
    // `watcher.ready` from hanging on dotted-basename project roots.
    ignored: [createWatchIgnorePredicate(watchRoots)],
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    depth: 99,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
    usePolling,
    interval: usePolling ? 100 : undefined,
    binaryInterval: usePolling ? 300 : undefined,
  }
}

function getBasenameKey(filePath: string): string {
  const components: readonly string[] = normalizePath(filePath)
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..')
  if (components.length === 0) return ''
  return components[components.length - 1].replace(/\.md$/i, '').toLowerCase()
}

function pruneRecentLoadedDeletes(
  recentLoadedDeleteBasenames: Map<string, number>,
  now = Date.now(),
): void {
  for (const [basename, expiresAt] of recentLoadedDeleteBasenames) {
    if (expiresAt <= now) recentLoadedDeleteBasenames.delete(basename)
  }
}

function isGraphNodeLike(value: unknown): value is Pick<GraphNode, 'absoluteFilePathIsID'> {
  const record = value as { readonly absoluteFilePathIsID?: unknown } | null
  return typeof value === 'object' &&
    value !== null &&
    'absoluteFilePathIsID' in value &&
    typeof record?.absoluteFilePathIsID === 'string'
}

function rememberLoadedDelete(
  filePath: string,
  graphNodes: Readonly<Record<string, unknown>>,
  recentLoadedDeleteBasenames: Map<string, number>,
): void {
  const nodeId: string = normalizePath(filePath)
  if (!isGraphNodeLike(graphNodes[nodeId])) return
  const basename: string = getBasenameKey(filePath)
  if (basename === '') return
  pruneRecentLoadedDeletes(recentLoadedDeleteBasenames)
  recentLoadedDeleteBasenames.set(basename, Date.now() + RECENT_LOADED_DELETE_TTL_MS)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function hasMissingLoadedSameBasenameSource(
  addedFilePath: string,
  graphNodes: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const addedBasename: string = getBasenameKey(addedFilePath)
  if (addedBasename === '') return false

  const normalizedAddedPath: string = normalizePath(addedFilePath)
  for (const [nodeId, node] of Object.entries(graphNodes)) {
    const nodePath: string = normalizePath(
      isGraphNodeLike(node) ? node.absoluteFilePathIsID : nodeId,
    )
    if (nodePath === normalizedAddedPath) continue
    if (getBasenameKey(nodePath) !== addedBasename) continue
    if (!(await pathExists(nodePath))) return true
  }

  return false
}

async function shouldIngestAddedFileOrLoadedMove(
  filePath: string,
  mountedRoots: ReadonlySet<string>,
  graphNodes: Readonly<Record<string, unknown>>,
  recentLoadedDeleteBasenames: Map<string, number>,
): Promise<boolean> {
  if (shouldIngestAddedFile(filePath, mountedRoots, graphNodes)) return true

  pruneRecentLoadedDeletes(recentLoadedDeleteBasenames)
  const basename: string = getBasenameKey(filePath)
  if (basename !== '' && recentLoadedDeleteBasenames.has(basename)) return true

  return hasMissingLoadedSameBasenameSource(filePath, graphNodes)
}

export function mountWatcher(
  readPaths: readonly string[],
  watchedDir: string,
  dependencies: MountWatcherDependencies = defaultMountWatcherDependencies,
): Watcher {
  const watcher: FSWatcher = chokidar.watch([...readPaths], buildWatcherOptions(readPaths))
  const ready = waitForReady(watcher)

  // The currently-mounted project paths (watch roots), kept in lockstep with
  // `add`/`unwatch` so the ingestion gate always sees live roots: a folder the
  // user just loaded becomes a root and its files start ingesting; an unloaded
  // folder stops being one.
  const mountedRoots = new Set<string>(readPaths.map((p) => normalizePath(p)))
  const recentLoadedDeleteBasenames = new Map<string, number>()

  watcher.on('add', (filePath: string) => {
    // "New folders unloaded by default": an external file appearing inside a
    // brand-new, not-yet-loaded folder (e.g. a git worktree checkout) must not
    // ingest as a graph node — otherwise the whole nested tree floods the
    // workspace. Skip it and refresh the folder tree so the folder still
    // surfaces in the sidebar as unloaded (one-click loadable).
    void shouldIngestAddedFileOrLoadedMove(
      filePath,
      mountedRoots,
      dependencies.getGraphNodes(),
      recentLoadedDeleteBasenames,
    )
      .then((shouldIngest: boolean) => {
        if (!shouldIngest) {
          getFolderTreeReadModel().invalidate({
            kind: 'pathChanged',
            absolutePath: toAbsolutePath(normalizePath(filePath)),
          })
          return Promise.resolve(undefined)
        }

        const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath)
        const contentPromise = isImageNode(filePath)
          ? Promise.resolve('')
          : dependencies.readFileWithRetry(filePath)

        return contentPromise.then((content: string) => {
          const fsUpdate: FSUpdate = {
            absolutePath: filePath,
            content,
            eventType: 'Added',
          }
          dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo)
        })
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher add failed for ${filePath}:`, error)
      })
  })

  watcher.on('change', (filePath: string) => {
    // A 'Changed' event upserts just like 'Added', so the same gate applies:
    // never pull a file from an unloaded folder into the graph via an edit (an
    // agent creating then editing a `.md` inside an unloaded worktree must stay
    // unloaded). Files in loaded folders keep updating normally.
    if (!shouldIngestAddedFile(filePath, mountedRoots, dependencies.getGraphNodes())) {
      return
    }

    const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath)
    if (isImageNode(filePath)) {
      return
    }

    void dependencies.readFileWithRetry(filePath)
      .then((content: string) => {
        const fsUpdate: FSUpdate = {
          absolutePath: filePath,
          content,
          eventType: 'Changed',
        }
        dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo)
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher change failed for ${filePath}:`, error)
      })
  })

  watcher.on('unlink', (filePath: string) => {
    rememberLoadedDelete(filePath, dependencies.getGraphNodes(), recentLoadedDeleteBasenames)
    const fsDelete: FSDelete = {
      type: 'Delete',
      absolutePath: filePath,
    }
    dependencies.handleFSEvent(fsDelete, watchedDir)
  })

  watcher.on('error', (error: unknown) => {
    dependencies.logger.error('graphd watcher error:', error)
  })

  return {
    ready,
    add(path: string): void {
      mountedRoots.add(normalizePath(path))
      watcher.add(path)
    },
    unwatch(path: string): void {
      mountedRoots.delete(normalizePath(path))
      watcher.unwatch(path)
    },
    async unmount(): Promise<void> {
      await watcher.close()
    },
  }
}
