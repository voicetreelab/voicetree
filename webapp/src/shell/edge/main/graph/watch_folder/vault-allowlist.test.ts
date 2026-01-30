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
  addReadPath,
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

// Mock graph loading - we'll control the return value per test
import { loadVaultPathAdditively } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

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

describe('vault-allowlist: loadAndMergeVaultPath helper', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-load-merge-test-'))
    await fs.mkdir(mockUserDataPath, { recursive: true })
    setGraph(createEmptyGraph())
    clearWatchFolderState()
  })

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true })
    try {
      await fs.rm(path.join(mockUserDataPath, 'voicetree-config.json'), { force: true })
    } catch {
      // ignore
    }
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    vi.clearAllMocks()
  })

  it('returns success and updates graph when load succeeds with delta', async () => {
    // GIVEN: A vault path and an existing graph
    const vaultPath: string = path.join(testTmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })
    const existingGraph: import('@/pure/graph').Graph = createEmptyGraph()

    // AND: loadVaultPathAdditively returns success with a delta
    const mockGraph: { nodes: { 'test-node': object } } = { nodes: { 'test-node': {} } }
    const mockDelta: { type: string; nodeId: string }[] = [{ type: 'CreateNode', nodeId: 'test-node' }]
    vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
      _tag: 'Right',
      right: { graph: mockGraph, delta: mockDelta }
    })

    // WHEN: loadAndMergeVaultPath is called
    const { loadAndMergeVaultPath } = await import('./vault-allowlist')
    const result: { success: boolean; error?: string } = await loadAndMergeVaultPath(vaultPath, existingGraph)

    // THEN: Should return success
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns error when file limit is exceeded', async () => {
    // GIVEN: A vault path and an existing graph
    const vaultPath: string = path.join(testTmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })
    const existingGraph: import('@/pure/graph').Graph = createEmptyGraph()

    // AND: loadVaultPathAdditively returns Left(FileLimitExceededError)
    const fileLimitError: FileLimitExceededError = {
      _tag: 'FileLimitExceededError',
      fileCount: 500,
      maxFiles: 300,
      message: 'Directory contains 500 markdown files, which exceeds the limit of 300'
    }
    vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
      _tag: 'Left',
      left: fileLimitError
    })

    // WHEN: loadAndMergeVaultPath is called
    const { loadAndMergeVaultPath } = await import('./vault-allowlist')
    const result: { success: boolean; error?: string } = await loadAndMergeVaultPath(vaultPath, existingGraph)

    // THEN: Should return error
    expect(result.success).toBe(false)
    expect(result.error).toContain('File limit exceeded')
    expect(result.error).toContain('500')
    expect(result.error).toContain('300')
  })
})

describe('vault-allowlist: file limit exceeded error handling', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-file-limit-test-'))
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

  describe('addReadPath returns error when file limit exceeded', () => {
    it('returns error when file limit is exceeded', async () => {
      // GIVEN: A watched directory with a config
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writePath: string = path.join(watchedDir, 'voicetree')
      const newReadPath: string = path.join(watchedDir, 'too-many-files')
      await fs.mkdir(writePath, { recursive: true })
      await fs.mkdir(newReadPath, { recursive: true })
      setWatchedDirectory(watchedDir)

      const config: VaultConfig = {
        writePath: writePath,
        readPaths: []
      }
      await saveVaultConfigForDirectory(watchedDir, config)

      // AND: loadVaultPathAdditively will return Left(FileLimitExceededError)
      const fileLimitError: FileLimitExceededError = {
        _tag: 'FileLimitExceededError',
        fileCount: 500,
        maxFiles: 300,
        message: 'Directory contains 500 markdown files, which exceeds the limit of 300'
      }
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Left',
        left: fileLimitError
      })

      // WHEN: addReadPath is called
      const result: { success: boolean; error?: string } = await addReadPath(newReadPath)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain('500')
      expect(result.error).toContain('300')
    })
  })

  describe('setWritePath returns error when file limit exceeded', () => {
    it('returns error when file limit is exceeded', async () => {
      // GIVEN: A watched directory with a config
      const watchedDir: string = path.join(testTmpDir, 'project')
      const currentWritePath: string = path.join(watchedDir, 'voicetree')
      const newWritePath: string = path.join(watchedDir, 'too-many-files')
      await fs.mkdir(currentWritePath, { recursive: true })
      await fs.mkdir(newWritePath, { recursive: true })
      setWatchedDirectory(watchedDir)

      const config: VaultConfig = {
        writePath: currentWritePath,
        readPaths: []
      }
      await saveVaultConfigForDirectory(watchedDir, config)

      // AND: loadVaultPathAdditively will return Left(FileLimitExceededError)
      const fileLimitError: FileLimitExceededError = {
        _tag: 'FileLimitExceededError',
        fileCount: 450,
        maxFiles: 300,
        message: 'Directory contains 450 markdown files, which exceeds the limit of 300'
      }
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Left',
        left: fileLimitError
      })

      // WHEN: setWritePath is called
      const result: { success: boolean; error?: string } = await setWritePath(newWritePath)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain('450')
      expect(result.error).toContain('300')
    })
  })
})
