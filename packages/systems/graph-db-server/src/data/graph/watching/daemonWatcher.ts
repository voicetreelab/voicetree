import { Stats } from 'node:fs'
import { extname } from 'node:path'
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

export type Watcher = {
  readonly ready: Promise<void>
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
  const usePolling =
    process.env.HEADLESS_TEST === '1' || process.env.NODE_ENV === 'test'

  return {
    // KEEP IN SYNC WITH packages/libraries/graph-model/src/watch-folder/file-watcher-setup.ts
    ignored: [
      (filePath: string, stats?: Stats) => {
        if (stats?.isDirectory()) {
          return false
        }
        if (!stats && !extname(filePath)) {
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
        dependencies.handleFSEvent(fsUpdate, watchedDir)
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher add failed for ${filePath}:`, error)
      })
  })

  watcher.on('change', (filePath: string) => {
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
        dependencies.handleFSEvent(fsUpdate, watchedDir)
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
    async unmount(): Promise<void> {
      await watcher.close()
    },
  }
}
