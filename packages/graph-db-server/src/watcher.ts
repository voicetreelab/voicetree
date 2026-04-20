import { Stats } from 'node:fs'
import { extname } from 'node:path'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import {
  handleFSEventWithStateAndUISides,
  isImageNode,
  readFileWithRetry,
  type FSDelete,
  type FSUpdate,
} from '@vt/graph-model'

export type Watcher = { unmount(): Promise<void> }

function buildWatcherOptions() {
  const usePolling =
    process.env.HEADLESS_TEST === '1' || process.env.NODE_ENV === 'test'

  return {
    // KEEP IN SYNC WITH packages/graph-model/src/watch-folder/file-watcher-setup.ts
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
): Watcher {
  const watcher: FSWatcher = chokidar.watch([...readPaths], buildWatcherOptions())

  watcher.on('add', (filePath: string) => {
    const contentPromise = isImageNode(filePath)
      ? Promise.resolve('')
      : readFileWithRetry(filePath)

    void contentPromise
      .then((content: string) => {
        const fsUpdate: FSUpdate = {
          absolutePath: filePath,
          content,
          eventType: 'Added',
        }
        handleFSEventWithStateAndUISides(fsUpdate, watchedDir)
      })
      .catch((error: unknown) => {
        console.error(`graphd watcher add failed for ${filePath}:`, error)
      })
  })

  watcher.on('change', (filePath: string) => {
    if (isImageNode(filePath)) {
      return
    }

    void readFileWithRetry(filePath)
      .then((content: string) => {
        const fsUpdate: FSUpdate = {
          absolutePath: filePath,
          content,
          eventType: 'Changed',
        }
        handleFSEventWithStateAndUISides(fsUpdate, watchedDir)
      })
      .catch((error: unknown) => {
        console.error(`graphd watcher change failed for ${filePath}:`, error)
      })
  })

  watcher.on('unlink', (filePath: string) => {
    const fsDelete: FSDelete = {
      type: 'Delete',
      absolutePath: filePath,
    }
    handleFSEventWithStateAndUISides(fsDelete, watchedDir)
  })

  watcher.on('error', (error: unknown) => {
    console.error('graphd watcher error:', error)
  })

  return {
    async unmount(): Promise<void> {
      await watcher.close()
    },
  }
}
