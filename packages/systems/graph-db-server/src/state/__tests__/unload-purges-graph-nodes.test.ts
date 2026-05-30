/**
 * Black-box invariant test for `unload-purges-graph-nodes`.
 *
 * INV-1: visibility(folder) === 'hidden' ⟹ the graph contains no node under
 * that folder (excluding nodes kept alive by a loaded write/expanded ancestor).
 *
 * Real disk, real graph store, no internal mocks (per CLAUDE.md): a tmp project
 * is driven through the genuine load/unload entry points and we assert on the
 * observable graph + folder-visibility state.
 */

/* vt-allow-direct-daemon-mutation-import: this is the black-box test for the unload transition itself */

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
import { addReadPath, removeReadPath } from '../projectAllowlist'
import { getFolderStateForActiveView } from '../../data/views/folderStateOps'
import { saveSettings, clearSettingsCache } from '@vt/app-config/settings'
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings'

const NUM_FILES = 4

function nodeIdsUnder(folder: string): readonly string[] {
  const normalized = normalizePath(folder)
  return Object.keys(getGraph().nodes).filter(
    (nodeId) => nodeId.startsWith(normalized + '/') || nodeId === normalized,
  )
}

function folderVisibility(projectRoot: string, folder: string): string | undefined {
  const normalized = normalizePath(folder)
  const { folderState } = getFolderStateForActiveView(projectRoot)
  return folderState.find(([p]) => normalizePath(p) === normalized)?.[1]
}

describe('unload purges graph nodes (INV-1)', () => {
  let testTmpDir: string
  let watchedDir: string
  let writeFolderPath: string
  let siblingFolder: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unload-purge-'))
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

    // Project with a write folder A and a sibling folder B of K markdown files.
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

  it('loads K sibling nodes then purges all of them on unload', async () => {
    // GIVEN: the sibling folder is loaded (expanded)
    const added = await addReadPath(siblingFolder)
    expect(added.success).toBe(true)
    expect(nodeIdsUnder(siblingFolder).length).toBe(NUM_FILES)

    // WHEN: the folder is unloaded through the public transition
    const result = await removeReadPath(siblingFolder)

    // THEN: every node under it is gone, the folder is hidden, and the
    // transition reports exactly how many nodes it removed.
    expect(result.success).toBe(true)
    expect(nodeIdsUnder(siblingFolder).length).toBe(0)
    expect(folderVisibility(watchedDir, siblingFolder)).toBe('hidden')
    expect(result.removedNodeCount).toBe(NUM_FILES)
  })

  it('unloading an already-hidden folder is an idempotent no-op', async () => {
    await addReadPath(siblingFolder)
    await removeReadPath(siblingFolder)

    const second = await removeReadPath(siblingFolder)
    expect(second.success).toBe(true)
    expect(second.removedNodeCount).toBe(0)
    expect(nodeIdsUnder(siblingFolder).length).toBe(0)
  })
})
