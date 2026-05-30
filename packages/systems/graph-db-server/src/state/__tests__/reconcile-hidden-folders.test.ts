/**
 * Black-box test for the reconcile-on-load purge (`reconcileHiddenFolders`).
 *
 * Enforces INV-1 at load time and, crucially, HEALS an existing drift: a graph
 * that still holds nodes under a folder whose visibility is `'hidden'`. Real
 * disk, real graph store, no internal mocks (per CLAUDE.md).
 */

/* vt-allow-direct-daemon-mutation-import: black-box test for the reconcile transition itself */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import normalizePath from 'normalize-path'

import { initGraphModel } from '@vt/graph-model'
import { createEmptyGraph } from '@vt/graph-model/graph'
import { setGraph, getGraph } from '../graph-store'
import {
  setProjectRoot,
  clearWatchFolderState,
  setWatcher,
} from '../watch-folder-store'
import { saveProjectConfigForDirectory } from '@vt/app-config/project-config'
import { addReadPath, reconcileHiddenFolders } from '../projectAllowlist'
import { markActiveViewFolderHidden } from '../../data/watch-folder/folder-visibility-active-view'
import { saveSettings, clearSettingsCache } from '@vt/app-config/settings'
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings'

const NUM_FILES = 4

function nodeIdsUnder(folder: string): readonly string[] {
  const normalized = normalizePath(folder)
  return Object.keys(getGraph().nodes).filter(
    (nodeId) => nodeId.startsWith(normalized + '/') || nodeId === normalized,
  )
}

describe('reconcileHiddenFolders heals drift (INV-1 on load)', () => {
  let testTmpDir: string
  let watchedDir: string
  let writeFolderPath: string
  let siblingFolder: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-hidden-'))
    const voicetreeHomeDir = path.join(testTmpDir, 'voicetree-home')
    await fs.mkdir(voicetreeHomeDir, { recursive: true })
    process.env.VOICETREE_HOME_PATH = voicetreeHomeDir

    initGraphModel({
      syncProjectState: vi.fn(),
      syncFolderTree: vi.fn(),
      syncStarredFolderTrees: vi.fn(),
      syncExternalFolderTrees: vi.fn(),
      fitViewport: vi.fn(),
    })
    setGraph(createEmptyGraph())
    clearWatchFolderState()
    setWatcher({ add: vi.fn(), unwatch: vi.fn() } as never)
    clearSettingsCache()
    await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [] })

    watchedDir = path.join(testTmpDir, 'project')
    writeFolderPath = path.join(watchedDir, 'A')
    siblingFolder = path.join(watchedDir, 'B')
    await fs.mkdir(writeFolderPath, { recursive: true })
    await fs.mkdir(siblingFolder, { recursive: true })
    for (let i = 0; i < NUM_FILES; i++) {
      await fs.writeFile(
        path.join(siblingFolder, `b${i}.md`),
        `# B${i}\n\nbody ${i}\n`,
      )
    }

    setProjectRoot(watchedDir)
    await saveProjectConfigForDirectory(watchedDir, { writeFolderPath })
  })

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    vi.clearAllMocks()
  })

  it('purges nodes of a folder that is hidden in the DB but still loaded', async () => {
    // GIVEN: B's nodes are loaded …
    await addReadPath(siblingFolder)
    expect(nodeIdsUnder(siblingFolder).length).toBe(NUM_FILES)

    // … but the folder is marked hidden WITHOUT a purge — the drifted state
    // (DB-write half of the transition only).
    await markActiveViewFolderHidden(watchedDir, siblingFolder)
    expect(nodeIdsUnder(siblingFolder).length).toBe(NUM_FILES) // drift present

    // WHEN: the reconcile that runs on project load executes
    const result = await reconcileHiddenFolders()

    // THEN: the drift is healed.
    expect(result.removedNodeCount).toBe(NUM_FILES)
    expect(nodeIdsUnder(siblingFolder).length).toBe(0)
  })

  it('keeps nodes of an expanded sub-path of an otherwise-hidden tree', async () => {
    // B/keep is an expanded sub-path; B itself is hidden.
    const keptSub = path.join(siblingFolder, 'keep')
    await fs.mkdir(keptSub, { recursive: true })
    await fs.writeFile(path.join(keptSub, 'kept.md'), '# Kept\n\nstays\n')

    await addReadPath(siblingFolder) // loads b0..b3
    await addReadPath(keptSub) // loads B/keep/kept.md, keeps it expanded
    await markActiveViewFolderHidden(watchedDir, siblingFolder)

    const keptNodeId = normalizePath(path.join(keptSub, 'kept.md'))
    expect(getGraph().nodes[keptNodeId]).toBeDefined()

    const result = await reconcileHiddenFolders()

    // The 4 top-level B files are purged; the expanded sub-path's node survives.
    expect(result.removedNodeCount).toBe(NUM_FILES)
    expect(getGraph().nodes[keptNodeId]).toBeDefined()
  })

  it('is a no-op when no folder is hidden', async () => {
    await addReadPath(siblingFolder)
    const result = await reconcileHiddenFolders()
    expect(result.removedNodeCount).toBe(0)
    expect(nodeIdsUnder(siblingFolder).length).toBe(NUM_FILES)
  })
})
