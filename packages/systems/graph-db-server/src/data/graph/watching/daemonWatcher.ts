import { Stats } from 'node:fs'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import {
  isImageNode,
  type FSDelete,
  type FSUpdate,
} from '@vt/graph-model'
import { handleFSEventWithStateAndUISides } from './handleFSEvent.ts'
import { readFileWithRetry } from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
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

function buildWatcherOptions() {
  // fsevents on macOS silently drops 'add' events for some vault paths
  // (reproduced deterministically: chokidar 3.6.0 + fsevents 2.3.3, dir under
  // ~/Voicetree/voicetree-…/voicetree-…/). Polling is the only reliable
  // backend in dev where this matters most for agent progress nodes.
  const usePolling =
    process.env.HEADLESS_TEST === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development'

  return {
    // KEEP IN SYNC WITH packages/systems/graph-db-server/src/data/watch-folder/watching/file-watcher-setup.ts
    //
    // When chokidar invokes this predicate WITHOUT stats (notably from
    // FsEventsHandler._watchWithFsEvents at chokidar/lib/fsevents-handler.js
    // line 305 — the gate that decides whether to set up the macOS fsevents
    // listener at all), it must NOT use `path.extname()` as a "this is a file"
    // heuristic: `path.extname()` returns a non-empty string for any directory
    // whose basename contains a dot (e.g. `mktemp -d /tmp/vt-vault.XXXX`,
    // user vaults like `My Vault.notes`, …). Treating such a directory as a
    // file and ignoring it causes chokidar to skip the fsevents subscription
    // — which leaves `_readyCount` half-decremented, so `watcher.ready`
    // never resolves and any caller that awaits it (e.g. startDaemonWatcher)
    // hangs forever. The pre-existing `setupWatcher` path in
    // file-watcher-setup.ts has the same shape but did not surface the bug
    // because it never awaits `ready`.
    //
    // The safe default when stats are unavailable is "don't ignore" —
    // chokidar will reinvoke the predicate during the directory scan with
    // stats populated, where the real file/dir filtering happens. Files
    // that slip through are then filtered by extension in the `add` /
    // `change` event handlers below.
    ignored: [
      (filePath: string, stats?: Stats) => {
        if (!stats) {
          return false
        }
        if (stats.isDirectory()) {
          return false
        }
        return !filePath.endsWith('.md') && !isImageNode(filePath)
      },
    ],
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
  const watcher: FSWatcher = chokidar.watch([...readPaths], buildWatcherOptions())
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
