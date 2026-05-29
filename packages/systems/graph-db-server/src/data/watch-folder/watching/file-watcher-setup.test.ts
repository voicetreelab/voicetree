import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FSWatcher } from 'chokidar'
import type { Stats } from 'node:fs'

import type { FSUpdate } from '@vt/graph-model/graph'
import { setWatcher } from '@vt/graph-db-server/state/watch-folder-store'
import { markPendingWrite } from '../pending-writes.ts'
import { createWatchIgnorePredicate, setupWatcherListeners } from './file-watcher-setup.ts'

// The predicate only consults `stats.isDirectory()`; these are black-box
// inputs standing in for the Stats chokidar would hand the predicate, not
// mocks of an internal collaborator.
const FILE_STATS = { isDirectory: () => false } as unknown as Stats
const DIR_STATS = { isDirectory: () => true } as unknown as Stats

describe('createWatchIgnorePredicate', () => {
  const root = '/Users/x/project'
  const ignored = createWatchIgnorePredicate([root])

  it('ignores a .md file inside .voicetree/ (daemon-internal leak)', () => {
    expect(ignored(`${root}/.voicetree/prompts/leak.md`, FILE_STATS)).toBe(true)
  })

  it('keeps a normal .md file below the root', () => {
    expect(ignored(`${root}/notes/keep.md`, FILE_STATS)).toBe(false)
  })

  it('keeps a .md file directly at the root', () => {
    expect(ignored(`${root}/keep.md`, FILE_STATS)).toBe(false)
  })

  it('ignores .md files nested in dotless noise dirs (node_modules, build)', () => {
    expect(ignored(`${root}/node_modules/pkg/readme.md`, FILE_STATS)).toBe(true)
    expect(ignored(`${root}/build/output/notes.md`, FILE_STATS)).toBe(true)
  })

  it('ignores any non-.md, non-image file via the extension rule', () => {
    expect(ignored(`${root}/notes/.voicetree-auth-token`, FILE_STATS)).toBe(true)
    expect(ignored(`${root}/notes/graph.db`, FILE_STATS)).toBe(true)
  })

  it('keeps image files below the root', () => {
    expect(ignored(`${root}/assets/diagram.png`, FILE_STATS)).toBe(false)
  })

  it('ignores an image file inside .voicetree/', () => {
    expect(ignored(`${root}/.voicetree/assets/diagram.png`, FILE_STATS)).toBe(true)
  })

  it('never ignores a directory, so chokidar still traverses .voicetree/', () => {
    // Returning true for a directory would trip the macOS fsevents readiness
    // gate; the dot-dir exclusion must apply only to leaf files.
    expect(ignored(`${root}/.voicetree`, DIR_STATS)).toBe(false)
    expect(ignored(`${root}/.voicetree/prompts`, DIR_STATS)).toBe(false)
  })

  it('never ignores when chokidar omits stats (fsevents readiness safety)', () => {
    // A `.voicetree/` path with no stats must NOT be ignored — ignoring it
    // here would skip the fsevents subscription and hang `watcher.ready`.
    expect(ignored(`${root}/.voicetree/prompts/leak.md`, undefined)).toBe(false)
    expect(ignored(root, undefined)).toBe(false)
  })

  it('does not treat a hidden ANCESTOR of the watch root as a leak', () => {
    // The root itself lives under a hidden dir; only project-internal
    // segments may trigger exclusion, matching the downward-only scanner.
    const hiddenRoot = '/Users/x/.config/project'
    const predicate = createWatchIgnorePredicate([hiddenRoot])
    expect(predicate(`${hiddenRoot}/notes/keep.md`, FILE_STATS)).toBe(false)
    expect(predicate(`${hiddenRoot}/.voicetree/prompts/leak.md`, FILE_STATS)).toBe(true)
  })

  it('does not ignore files outside every watch root (extension rule still applies)', () => {
    expect(ignored('/somewhere/else/notes.md', FILE_STATS)).toBe(false)
    expect(ignored('/somewhere/else/blob.bin', FILE_STATS)).toBe(true)
  })

  it('relativizes against the deepest matching root (expanded subfolder shadows parent)', () => {
    // A subfolder root expanded under a parent root: a path whose only "dot"
    // segment is the parent root's own basename must not be excluded.
    const parent = '/Users/x/.notes'
    const child = '/Users/x/.notes/sub'
    const predicate = createWatchIgnorePredicate([parent, child])
    expect(predicate(`${child}/keep.md`, FILE_STATS)).toBe(false)
    expect(predicate(`${child}/.voicetree/leak.md`, FILE_STATS)).toBe(true)
  })
})

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
