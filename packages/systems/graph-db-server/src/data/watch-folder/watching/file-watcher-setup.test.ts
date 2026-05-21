import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FSWatcher } from 'chokidar'

import type { FSUpdate } from '@vt/graph-model/graph'
import { setWatcher } from '@vt/graph-db-server/state/watch-folder-store'
import { markPendingWrite } from '../pending-writes.ts'
import { setupWatcherListeners } from './file-watcher-setup.ts'

type Listener = (filePath: string) => void

function createFakeWatcher(): {
  readonly watcher: FSWatcher
  readonly emit: (event: string, filePath: string) => void
} {
  const listeners = new Map<string, Listener>()
  return {
    watcher: {
      on(event: string, listener: Listener): FSWatcher {
        listeners.set(event, listener)
        return this as FSWatcher
      },
    } as FSWatcher,
    emit(event: string, filePath: string): void {
      listeners.get(event)?.(filePath)
    },
  }
}

describe('file watcher listeners', () => {
  afterEach(() => {
    setWatcher(null)
  })

  it('does not drop pending write change events and carries editor suppression', async () => {
    const filePath = `/tmp/watched-${randomUUID()}.md`
    const handled: Array<{
      update: FSUpdate
      suppressBroadcastTo: readonly string[]
    }> = []
    const fake = createFakeWatcher()
    setWatcher(fake.watcher)
    markPendingWrite(filePath, { suppressBroadcastTo: 'editor-1' })

    setupWatcherListeners('/tmp', {
      readFileWithRetry: async () => '# changed\n',
      handleFSEvent: (update, _watchedDir, suppressBroadcastTo = new Set()) => {
        if ('eventType' in update) {
          handled.push({
            update,
            suppressBroadcastTo: [...suppressBroadcastTo],
          })
        }
      },
      broadcastFolderTree: () => undefined,
      logger: { error: () => undefined },
    })

    fake.emit('change', filePath)

    await expect.poll(() => handled).toEqual([
      {
        update: {
          absolutePath: filePath,
          content: '# changed\n',
          eventType: 'Changed',
        },
        suppressBroadcastTo: ['editor-1'],
      },
    ])
  })
})
