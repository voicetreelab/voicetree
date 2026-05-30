import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import {
  isImageNode,
  type FSDelete,
  type FSUpdate,
} from '@vt/graph-model'
import { handleFSEventWithStateAndUISides } from './handleFSEvent.ts'
import {
  readFileWithRetry,
  createWatchIgnorePredicate,
} from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
import type { FileWatcherLogger } from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
import { consumeBroadcastSuppression } from '@vt/graph-db-server/watch-folder/pending-writes'

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
}

const defaultMountWatcherDependencies: MountWatcherDependencies = {
  readFileWithRetry,
  handleFSEvent: handleFSEventWithStateAndUISides,
  logger: {
    error(message?: unknown, ...optionalParams: unknown[]): void {
      console.error(message, ...optionalParams)
    },
  },
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

export function mountWatcher(
  readPaths: readonly string[],
  watchedDir: string,
  dependencies: MountWatcherDependencies = defaultMountWatcherDependencies,
): Watcher {
  const watcher: FSWatcher = chokidar.watch([...readPaths], buildWatcherOptions(readPaths))
  const ready = waitForReady(watcher)

  watcher.on('add', (filePath: string) => {
    const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath)
    const contentPromise = isImageNode(filePath)
      ? Promise.resolve('')
      : dependencies.readFileWithRetry(filePath)

    void contentPromise
      .then((content: string) => {
        const fsUpdate: FSUpdate = {
          absolutePath: filePath,
          content,
          eventType: 'Added',
        }
        dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo)
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher add failed for ${filePath}:`, error)
      })
  })

  watcher.on('change', (filePath: string) => {
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
      watcher.add(path)
    },
    unwatch(path: string): void {
      watcher.unwatch(path)
    },
    async unmount(): Promise<void> {
      await watcher.close()
    },
  }
}
