/**
 * Tests for vault-allowlist.ts
 *
 * TDD: Write tests first, verify they fail, then implement fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// Mock electron app before importing modules that use it
const mockUserDataPath: string = path.join(os.tmpdir(), `test-vault-allowlist-${Date.now()}-${Math.random().toString(36).substring(7)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath)
  }
}))

// Import after mocks are set up
import {
  getVaultPaths,
  setWritePath,
} from './vault-allowlist'
import {
  setWatchedDirectory,
  clearWatchFolderState,
  setWatcher,
} from '@/shell/edge/main/state/watch-folder-store'
import {
  saveVaultConfigForDirectory,
} from './voicetree-config-io'
import { setGraph } from '@/shell/edge/main/state/graph-store'
import { createEmptyGraph } from '@/pure/graph/createGraph'
import type { VaultConfig } from '@/pure/settings/types'

// Mock graph loading to avoid actual filesystem operations
vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk', () => ({
  loadVaultPathAdditively: vi.fn().mockResolvedValue({
    _tag: 'Right',
    right: { graph: { nodes: {} }, delta: [] }
  })
}))

// Mock UI API and broadcast functions
vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI', () => ({
  applyGraphDeltaToMemState: vi.fn().mockResolvedValue([]),
  broadcastGraphDeltaToUI: vi.fn()
}))

vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/notifyTextToTreeServerOfDirectory', () => ({
  notifyTextToTreeServerOfDirectory: vi.fn()
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
  uiAPI: {
    fitViewport: vi.fn()
  }
}))

describe('vault-allowlist: duplicate writePath in dropdown bug', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-allowlist-test-'))
    // Ensure mock userData path exists
    await fs.mkdir(mockUserDataPath, { recursive: true })
    // Initialize graph state
    setGraph(createEmptyGraph())
    // Clear watch folder state
    clearWatchFolderState()
    // Mock watcher to avoid null issues
    setWatcher({
      add: vi.fn(),
      unwatch: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  })

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true })
    // Clean up config file
    try {
      await fs.rm(path.join(mockUserDataPath, 'voicetree-config.json'), { force: true })
    } catch {
      // ignore
    }
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    vi.clearAllMocks()
  })

  describe('getVaultPaths should not return duplicates', () => {
    it('should NOT return duplicate paths when writePath is also in readPaths', async () => {
      // GIVEN: A watched directory
      const watchedDir: string = path.join(testTmpDir, 'project')
      await fs.mkdir(watchedDir, { recursive: true })
      setWatchedDirectory(watchedDir)

      // AND: A config where writePath is also present in readPaths (buggy state)
      const vaultPath: string = path.join(watchedDir, 'fri')
      await fs.mkdir(vaultPath, { recursive: true })
      const buggyConfig: VaultConfig = {
        writePath: vaultPath,
        readPaths: [vaultPath]  // Same path in both writePath AND readPaths
      }
      await saveVaultConfigForDirectory(watchedDir, buggyConfig)

      // WHEN: getVaultPaths is called
      const paths: readonly string[] = await getVaultPaths()

      // THEN: Should return unique paths only (no duplicates)
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length)
      expect(paths).toEqual(uniquePaths)
    })

    it('should return unique paths after setWritePath to a path already in readPaths', async () => {
      // GIVEN: A watched directory with initial config
      const watchedDir: string = path.join(testTmpDir, 'project')
      await fs.mkdir(watchedDir, { recursive: true })
      setWatchedDirectory(watchedDir)

      // AND: Initial config with separate writePath and readPath
      const writePathA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      await fs.mkdir(writePathA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })

      const initialConfig: VaultConfig = {
        writePath: writePathA,
        readPaths: [readPathB]
      }
      await saveVaultConfigForDirectory(watchedDir, initialConfig)

      // WHEN: setWritePath is called with a path that's already in readPaths
      await setWritePath(readPathB)

      // AND: getVaultPaths is called
      const paths: readonly string[] = await getVaultPaths()

      // THEN: Should return unique paths only - readPathB should NOT appear twice
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length)
      expect(paths).toEqual(uniquePaths)
    })
  })
})
