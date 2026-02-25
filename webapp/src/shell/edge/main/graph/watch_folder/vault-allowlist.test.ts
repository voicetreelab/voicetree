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
  loadAndMergeVaultPath,
  type LoadVaultPathResult,
} from './vault-allowlist'
import {
  setProjectRootWatchedDirectory,
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
import { loadVaultPathAdditively, resolveLinkedNodesInWatchedFolder } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'
import { createStarterNode } from './create-starter-node'
import { notifyTextToTreeServerOfDirectory } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/notifyTextToTreeServerOfDirectory'
import { loadSettings } from '@/shell/edge/main/settings/settings_IO'

vi.mock('@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk', () => ({
  loadVaultPathAdditively: vi.fn().mockResolvedValue({
    _tag: 'Right',
    right: { graph: { nodes: {} }, delta: [] }
  }),
  resolveLinkedNodesInWatchedFolder: vi.fn().mockResolvedValue([])
}))

// Mock createStarterNode
vi.mock('./create-starter-node', () => ({
  createStarterNode: vi.fn().mockResolvedValue({
    nodes: {
      '/test/starter-node.md': {
        absoluteFilePathIsID: '/test/starter-node.md',
        outgoingEdges: [],
        contentWithoutYamlOrLinks: '# Starter',
        nodeUIMetadata: { color: { _tag: 'None' }, position: { _tag: 'Some', value: { x: 0, y: 0 } }, additionalYAMLProps: new Map(), isContextNode: false }
      }
    }
  })
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
  loadSettings: vi.fn().mockResolvedValue({ disableStarterNodes: false })
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
    fitViewport: vi.fn(),
    syncVaultState: vi.fn()
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
      setProjectRootWatchedDirectory(watchedDir)

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
      setProjectRootWatchedDirectory(watchedDir)

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

  describe('setWritePath should demote old writePath to readPaths', () => {
    it('should add old writePath to readPaths when setting a new writePath', async () => {
      // GIVEN: A watched directory with writePath=A, readPaths=[B]
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writePathA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      const newWritePathC: string = path.join(watchedDir, 'pathC')
      await fs.mkdir(writePathA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })
      await fs.mkdir(newWritePathC, { recursive: true })
      setProjectRootWatchedDirectory(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writePath: writePathA,
        readPaths: [readPathB]
      })

      // WHEN: setWritePath is called with a new path C
      await setWritePath(newWritePathC)

      // THEN: getVaultPaths should include all three paths: C (write), B (read), A (demoted)
      const paths: readonly string[] = await getVaultPaths()
      expect(paths).toContain(newWritePathC)
      expect(paths).toContain(readPathB)
      expect(paths).toContain(writePathA)
    })

    it('should demote old writePath when promoting a readPath to write', async () => {
      // GIVEN: writePath=A, readPaths=[B]
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writePathA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      await fs.mkdir(writePathA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })
      setProjectRootWatchedDirectory(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writePath: writePathA,
        readPaths: [readPathB]
      })

      // WHEN: setWritePath promotes B to write
      await setWritePath(readPathB)

      // THEN: A should be demoted to readPaths, B should not be duplicated
      const paths: readonly string[] = await getVaultPaths()
      expect(paths).toContain(readPathB)  // B is now writePath
      expect(paths).toContain(writePathA) // A demoted to readPaths
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length) // no duplicates
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
    setProjectRootWatchedDirectory(testTmpDir)
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

  it('returns success when load succeeds', async () => {
    // GIVEN: A vault path
    const vaultPath: string = path.join(testTmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })

    // AND: loadVaultPathAdditively returns success with a delta
    const mockGraph: { nodes: { 'test-node': object } } = { nodes: { 'test-node': {} } }
    const mockDelta: { type: string; nodeId: string }[] = [{ type: 'CreateNode', nodeId: 'test-node' }]
    vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
      _tag: 'Right',
      right: { graph: mockGraph, delta: mockDelta }
    })

    // WHEN: loadAndMergeVaultPath is called (impure edge function)
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath)

    // THEN: Should return success
    expect(result.success).toBe(true)
  })

  it('returns error when file limit is exceeded', async () => {
    // GIVEN: A vault path
    const vaultPath: string = path.join(testTmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })

    // AND: loadVaultPathAdditively returns Left(FileLimitExceededError)
    const fileLimitError: FileLimitExceededError = {
      _tag: 'FileLimitExceededError',
      fileCount: 500,
      maxFiles: 600,
      message: 'Directory contains 500 markdown files, which exceeds the limit of 600'
    }
    vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
      _tag: 'Left',
      left: fileLimitError
    })

    // WHEN: loadAndMergeVaultPath is called (impure edge function)
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath)

    // THEN: Should return error
    expect(result.success).toBe(false)
    expect(result.error).toContain('File limit exceeded')
    expect(result.error).toContain('500')
    expect(result.error).toContain('600')
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
      setProjectRootWatchedDirectory(watchedDir)

      const config: VaultConfig = {
        writePath: writePath,
        readPaths: []
      }
      await saveVaultConfigForDirectory(watchedDir, config)

      // AND: loadVaultPathAdditively will return Left(FileLimitExceededError)
      const fileLimitError: FileLimitExceededError = {
        _tag: 'FileLimitExceededError',
        fileCount: 500,
        maxFiles: 600,
        message: 'Directory contains 500 markdown files, which exceeds the limit of 600'
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
      expect(result.error).toContain('600')
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
      setProjectRootWatchedDirectory(watchedDir)

      const config: VaultConfig = {
        writePath: currentWritePath,
        readPaths: []
      }
      await saveVaultConfigForDirectory(watchedDir, config)

      // AND: loadVaultPathAdditively will return Left(FileLimitExceededError)
      const fileLimitError: FileLimitExceededError = {
        _tag: 'FileLimitExceededError',
        fileCount: 450,
        maxFiles: 600,
        message: 'Directory contains 450 markdown files, which exceeds the limit of 600'
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
      expect(result.error).toContain('600')
    })
  })
})

/**
 * Phase 2 Tests: loadAndMergeVaultPath with isWritePath option
 * Updated for impure edge function that handles side effects internally
 */
describe('vault-allowlist: loadAndMergeVaultPath isWritePath behavior', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-isWritePath-test-'))
    await fs.mkdir(mockUserDataPath, { recursive: true })
    setGraph(createEmptyGraph())
    clearWatchFolderState()
    // Set project root for wikilink resolution
    setProjectRootWatchedDirectory(testTmpDir)
    vi.clearAllMocks()
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

  describe('when isWritePath is true', () => {
    it('creates starter node when folder is empty', async () => {
      // GIVEN: An empty vault path
      const vaultPath: string = path.join(testTmpDir, 'empty-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns empty graph (no files found)
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] }
      })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: createStarterNode should have been called (impure edge handles it)
      expect(createStarterNode).toHaveBeenCalledWith(vaultPath)
    })

    it('does not create starter node when folder has files', async () => {
      // GIVEN: A vault path with existing files
      const vaultPath: string = path.join(testTmpDir, 'non-empty-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns graph with existing node
      const existingNodeId: string = path.join(vaultPath, 'existing-file.md')
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: {
          graph: { nodes: { [existingNodeId]: { absoluteFilePathIsID: existingNodeId } } },
          delta: [{ type: 'CreateNode', nodeId: existingNodeId }]
        }
      })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: createStarterNode should NOT have been called (folder not empty)
      expect(createStarterNode).not.toHaveBeenCalled()
    })

    it('does not create starter node when disableStarterNodes is enabled', async () => {
      // GIVEN: An empty vault path
      const vaultPath: string = path.join(testTmpDir, 'empty-vault-disabled')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns empty graph (no files found)
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] }
      })

      // AND: settings explicitly disable starter nodes
      vi.mocked(loadSettings).mockResolvedValueOnce({ disableStarterNodes: true } as import('@/pure/settings/types').VTSettings)

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success without creating a starter node
      expect(result.success).toBe(true)
      expect(createStarterNode).not.toHaveBeenCalled()
    })

    it('notifies backend for write paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'write-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns success
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] }
      })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: notifyTextToTreeServerOfDirectory should have been called (impure edge handles it)
      expect(notifyTextToTreeServerOfDirectory).toHaveBeenCalledWith(vaultPath)
    })

    it('resolves wikilinks after loading', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'vault-with-links')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns a graph with nodes
      const nodeId: string = path.join(vaultPath, 'note.md')
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: {
          graph: { nodes: { [nodeId]: { absoluteFilePathIsID: nodeId } } },
          delta: [{ type: 'CreateNode', nodeId }]
        }
      })

      // WHEN: loadAndMergeVaultPath is called
      await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Wikilink resolution should have been called
      expect(resolveLinkedNodesInWatchedFolder).toHaveBeenCalled()
    })
  })

  describe('when isWritePath is false', () => {
    it('does not create starter node for read paths', async () => {
      // GIVEN: An empty vault path
      const vaultPath: string = path.join(testTmpDir, 'empty-read-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns empty graph
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] }
      })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: false
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: false })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: createStarterNode should NOT have been called (read paths don't get starter nodes)
      expect(createStarterNode).not.toHaveBeenCalled()
    })

    it('does not notify backend for read paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'read-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns success
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] }
      })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: false
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: false })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: notifyTextToTreeServerOfDirectory should NOT have been called
      expect(notifyTextToTreeServerOfDirectory).not.toHaveBeenCalled()
    })

    it('still resolves wikilinks for read paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'read-vault-with-links')
      await fs.mkdir(vaultPath, { recursive: true })

      // AND: loadVaultPathAdditively returns a graph with nodes
      const nodeId: string = path.join(vaultPath, 'note.md')
      vi.mocked(loadVaultPathAdditively).mockResolvedValueOnce({
        _tag: 'Right',
        right: {
          graph: { nodes: { [nodeId]: { absoluteFilePathIsID: nodeId } } },
          delta: [{ type: 'CreateNode', nodeId }]
        }
      })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: false
      await loadAndMergeVaultPath(vaultPath, { isWritePath: false })

      // THEN: Wikilink resolution should still have been called
      expect(resolveLinkedNodesInWatchedFolder).toHaveBeenCalled()
    })
  })
})
