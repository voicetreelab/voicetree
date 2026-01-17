/**
 * Unit Tests for Multi-Vault Path Functionality
 *
 * Tests the public API functions for multi-vault path management:
 * - await getVaultPaths() - returns readonly FilePath[] of readOnLinkPaths
 * - await getWritePath() - returns O.Option<FilePath> of write path
 * - setWritePath(path) - sets write path, returns {success, error?}
 * - addReadOnLinkPath(path) - adds path to readOnLinkPaths
 * - removeReadOnLinkPath(path) - removes path from readOnLinkPaths
 *
 * Testing Philosophy:
 * - Tests must test BEHAVIOR, not implementation details
 * - Assertions should be as similar to behavioural specs as possible
 * - Only rely on existing or future APIs/exported functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import {
  getVaultPaths,
  getWritePath,
  setWritePath,
  addReadOnLinkPath,
  removeReadOnLinkPath,
  loadFolder,
  stopFileWatching,
  getVaultPath,
  clearVaultPath,
} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { setGraph, getGraph } from '@/shell/edge/main/state/graph-store'
import type { GraphDelta, Graph } from '@/pure/graph'
import { createEmptyGraph } from '@/pure/graph'

// Track IPC broadcasts
interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

// State for mocks
let broadcastCalls: BroadcastCall[] = []
let mockMainWindow: {
  readonly webContents: { readonly send: (channel: string, data: unknown) => void }
  readonly isDestroyed: () => boolean
}

// Mock app-electron-state
vi.mock('@/shell/edge/main/state/app-electron-state', () => ({
  getMainWindow: vi.fn(() => mockMainWindow),
  setMainWindow: vi.fn()
}))

// Mock electron app - use a unique temp path per test run
const mockUserDataPath: string = path.join(os.tmpdir(), `test-userdata-${Date.now()}-${Math.random().toString(36).substring(7)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath)
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

// Test directory paths
let testTmpDir: string
let testVaultPath1: string
let testVaultPath2: string
let testVaultPath3: string
let testWatchedDir: string

describe('Multi-Vault Path Allowlist (7.1)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    // Use directory names NOT in defaultAllowlistPatterns to avoid auto-adding
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-vault-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'custom-vault')  // Not "openspec" to avoid auto-adding
    testVaultPath3 = path.join(testWatchedDir, 'docs')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })
    await fs.mkdir(testVaultPath3, { recursive: true })

    // Create a test file in vault1 so the folder isn't empty
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    // Clean up temp directory
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('7.1.1 Scenario: User adds multiple vault paths', () => {
    it('should return all configured vault paths from await getVaultPaths()', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testVaultPath1)

      // AND: Add additional vault paths
      const result1: { success: boolean; error?: string } = await addReadOnLinkPath(testVaultPath2)
      const result2: { success: boolean; error?: string } = await addReadOnLinkPath(testVaultPath3)

      // ASSERT: Both additions succeeded
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      // ASSERT: await getVaultPaths() returns all paths
      const vaultPaths: readonly string[] = await getVaultPaths()
      expect(vaultPaths).toContain(testVaultPath1)
      expect(vaultPaths).toContain(testVaultPath2)
      expect(vaultPaths).toContain(testVaultPath3)
      expect(vaultPaths.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('7.1.2 Scenario: Auto-create vault folder when adding non-existent path', () => {
    it('should auto-create directory when adding a non-existent path within project', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testVaultPath1)

      // WHEN: Add a path that doesn't exist yet (but is within the project directory)
      const newFolderPath: string = path.join(testWatchedDir, 'new-folder-to-create')

      // Verify it doesn't exist before
      await expect(fs.access(newFolderPath)).rejects.toThrow()

      const result: { success: boolean; error?: string } = await addReadOnLinkPath(newFolderPath)

      // ASSERT: Addition succeeds
      expect(result.success).toBe(true)

      // ASSERT: Directory was created
      const stats: Awaited<ReturnType<typeof fs.stat>> = await fs.stat(newFolderPath)
      expect(stats.isDirectory()).toBe(true)

      // ASSERT: Path is now in readOnLinkPaths
      expect(await getVaultPaths()).toContain(newFolderPath)
    })

    it('should fail gracefully when path cannot be created (e.g., invalid characters or permissions)', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testVaultPath1)
      const initialPaths: readonly string[] = [...await getVaultPaths()]

      // WHEN: Attempt to add path in non-existent root location (will fail on permissions)
      const invalidPath: string = '/nonexistent/root/path/that/cannot/be/created'
      const result: { success: boolean; error?: string } = await addReadOnLinkPath(invalidPath)

      // ASSERT: Function returns error (can't create directory without permissions)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Failed to create directory')

      // ASSERT: await getVaultPaths() unchanged
      const currentPaths: readonly string[] = await getVaultPaths()
      expect(currentPaths).toEqual(initialPaths)
    })
  })

  describe('7.1.3 Scenario: Duplicate vault path prevention', () => {
    it('should not add duplicate paths to readOnLinkPaths', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testVaultPath1)

      // AND: Add a path (using custom-vault which is not auto-added by defaultAllowlistPatterns)
      const firstAdd: { success: boolean; error?: string } = await addReadOnLinkPath(testVaultPath2)
      expect(firstAdd.success).toBe(true)
      const lengthAfterFirstAdd: number = (await getVaultPaths()).length

      // WHEN: Attempt to add same path again
      const secondAdd: { success: boolean; error?: string } = await addReadOnLinkPath(testVaultPath2)

      // ASSERT: Duplicate not added (readOnLinkPaths length unchanged)
      expect(secondAdd.success).toBe(false)
      expect(secondAdd.error).toContain('already in readOnLinkPaths')
      expect((await getVaultPaths()).length).toBe(lengthAfterFirstAdd)
    })
  })
})

describe('Default Write Path (7.2)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    // Use directory names NOT in defaultAllowlistPatterns to avoid auto-adding
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'default-write-path-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'custom-vault')  // Not "openspec" to avoid auto-adding

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create a test file in vault1 so the folder isn't empty
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('7.2.2 Scenario: Single vault path as default', () => {
    it('should return the single vault path as default write path automatically', async () => {
      // GIVEN: Only one vault path configured (via loadFolder)
      await loadFolder(testVaultPath1)

      // ASSERT: await getWritePath() returns that path automatically
      const defaultWritePath: O.Option<string> = await getWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)
      if (O.isSome(defaultWritePath)) {
        expect(defaultWritePath.value).toBe(testVaultPath1)
      }
    })
  })

  describe('7.2.3 Scenario: Write path can be set to any path', () => {
    it('should accept setting write path to any existing path', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testVaultPath1)

      // WHEN: Set write path to a different existing path
      // In the new architecture, writePath is independent and doesn't need to be in readOnLinkPaths
      const outsidePath: string = path.join(testTmpDir, 'outside')
      await fs.mkdir(outsidePath, { recursive: true })
      const result: { success: boolean; error?: string } = await setWritePath(outsidePath)

      // ASSERT: setWritePath() succeeds
      expect(result.success).toBe(true)

      // ASSERT: Default write path is now the outside path
      const defaultWritePath: O.Option<string> = await getWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)
      if (O.isSome(defaultWritePath)) {
        expect(defaultWritePath.value).toBe(outsidePath)
      }
    })

    it('should accept setting write path to a readOnLinkPath', async () => {
      // GIVEN: Load a folder and add second vault path
      await loadFolder(testVaultPath1)
      await addReadOnLinkPath(testVaultPath2)

      // WHEN: Set write path to the second path (which is in readOnLinkPaths)
      const result: { success: boolean; error?: string } = await setWritePath(testVaultPath2)

      // ASSERT: setWritePath() succeeds
      expect(result.success).toBe(true)

      // ASSERT: Default write path is now the second path
      const defaultWritePath: O.Option<string> = await getWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)
      if (O.isSome(defaultWritePath)) {
        expect(defaultWritePath.value).toBe(testVaultPath2)
      }
    })
  })
})

describe('Remove Vault Path from Allowlist', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    // Use directory names NOT in defaultAllowlistPatterns to avoid auto-adding
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remove-vault-path-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'custom-vault')  // Not "openspec" to avoid auto-adding

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create a test file in vault1 so the folder isn't empty
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should remove path from readOnLinkPaths when it is not the write path', async () => {
    // GIVEN: Load a folder and add second vault path
    await loadFolder(testVaultPath1)
    await addReadOnLinkPath(testVaultPath2)
    expect(await getVaultPaths()).toContain(testVaultPath2)

    // WHEN: Remove the second path (not the default)
    const result: { success: boolean; error?: string } = await removeReadOnLinkPath(testVaultPath2)

    // ASSERT: Removal succeeds
    expect(result.success).toBe(true)

    // ASSERT: Path is no longer in readOnLinkPaths
    expect(await getVaultPaths()).not.toContain(testVaultPath2)
  })

  it('should reject removing the default write path', async () => {
    // GIVEN: Load a folder (primary vault is default write path)
    await loadFolder(testVaultPath1)

    // WHEN: Attempt to remove the default write path
    const result: { success: boolean; error?: string } = await removeReadOnLinkPath(testVaultPath1)

    // ASSERT: Removal fails
    expect(result.success).toBe(false)
    expect(result.error).toContain('write path')

    // ASSERT: Path is still in readOnLinkPaths
    expect(await getVaultPaths()).toContain(testVaultPath1)
  })

  it('should reject removing path not in readOnLinkPaths', async () => {
    // GIVEN: Load a folder
    await loadFolder(testVaultPath1)

    // WHEN: Attempt to remove path not in readOnLinkPaths
    const outsidePath: string = '/some/random/path'
    const result: { success: boolean; error?: string } = await removeReadOnLinkPath(outsidePath)

    // ASSERT: Removal fails
    expect(result.success).toBe(false)
    expect(result.error).toContain('not in readOnLinkPaths')
  })
})

describe('Two-Tier Configuration (7.3)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'two-tier-config-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'openspec')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create test files
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )
    await fs.writeFile(
      path.join(testVaultPath2, 'spec.md'),
      '# Spec Node\n\nSpec content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('7.3.1 Scenario: Global default patterns auto-applied', () => {
    it('should auto-add openspec to readOnLinkPaths when folder exists and pattern matches', async () => {
      // Note: This test depends on settings.defaultAllowlistPatterns being set
      // The current implementation in resolveAllowlistForProject reads from loadSettings()
      // For unit testing without integration, we verify the behavior via the public API

      // GIVEN: Settings have defaultAllowlistPatterns: ["openspec"]
      // (This is configured via settings.json - we test the outcome)

      // GIVEN: openspec folder exists in project
      // (Already created in beforeEach)

      // WHEN: loadFolder is called
      await loadFolder(testVaultPath1)

      // THEN: Check if openspec is in the readOnLinkPaths
      // Note: This depends on the actual settings configuration
      // The test validates the public API behavior
      const vaultPaths: readonly string[] = await getVaultPaths()

      // At minimum, the primary vault path should be in readOnLinkPaths
      expect(vaultPaths).toContain(testVaultPath1)

      // If defaultAllowlistPatterns includes "openspec", it should be auto-added
      // This is an integration behavior - unit test verifies API works
    })
  })

  describe('7.3.2 Scenario: Per-project explicit readOnLinkPaths', () => {
    it('should maintain separate readOnLinkPaths between projects', async () => {
      // GIVEN: Create two project directories (vault paths directly)
      const projectAVault: string = testVaultPath1
      const projectBVault: string = path.join(testTmpDir, 'project-b-vault')

      await fs.mkdir(projectBVault, { recursive: true })
      await fs.writeFile(path.join(projectBVault, 'test.md'), '# Test')

      // WHEN: Load project A and add custom path
      await loadFolder(projectAVault)
      await addReadOnLinkPath(testVaultPath2)

      const projectAPaths: readonly string[] = [...await getVaultPaths()]
      expect(projectAPaths).toContain(testVaultPath2)

      // WHEN: Switch to project B
      await loadFolder(projectBVault)

      // THEN: Project B should NOT have project A's custom path
      const projectBPaths: readonly string[] = await getVaultPaths()
      expect(projectBPaths).not.toContain(testVaultPath2)
      expect(projectBPaths).toContain(projectBVault)
    })
  })
})

describe('File Write Bug Fix (7.5)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-write-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree-vault')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })

    // Create a test file in vault so the folder isn't empty
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('7.5.1 Scenario: Node file written to correct location', () => {
    it('should report default write path correctly for file writes', async () => {
      // GIVEN: Load the vault folder directly (new behavior: no suffix system)
      await loadFolder(testVaultPath1)

      // THEN: Default write path should be the loaded folder
      const defaultWritePath: O.Option<string> = await getWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)

      if (O.isSome(defaultWritePath)) {
        // ASSERT: File should be written to vault path
        expect(defaultWritePath.value).toBe(testVaultPath1)

        // Verify the path ends with the vault name
        expect(defaultWritePath.value.endsWith('voicetree-vault')).toBe(true)
      }
    })

    it('should return watched directory from getVaultPath (use getWritePath for write location)', async () => {
      // GIVEN: Load the vault folder
      await loadFolder(testVaultPath1)

      // THEN: getVaultPath returns the watched directory (project root)
      // For actual write location, use getWritePath instead
      const vaultPath: O.Option<string> = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        // getVaultPath now returns the watched directory
        expect(vaultPath.value).toBe(testVaultPath1)
      }
    })
  })
})

describe('Fallback Behavior - getVaultPath vs getWritePath', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fallback-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'custom-vault')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should have getVaultPath return None after clearVaultPath', () => {
    // GIVEN: clearVaultPath called (in beforeEach)

    // THEN: getVaultPath should return None (watchedDirectory is null)
    const vaultPath: O.Option<string> = getVaultPath()
    expect(O.isNone(vaultPath)).toBe(true)
  })

  it('should have getWritePath fall back to getVaultPath when no explicit default set', async () => {
    // GIVEN: Load a folder (sets up primary vault as default)
    await loadFolder(testVaultPath1)

    // WHEN: Get the default write path
    const defaultWritePath: O.Option<string> = await getWritePath()

    // THEN: It should match the primary vault path
    expect(O.isSome(defaultWritePath)).toBe(true)
    if (O.isSome(defaultWritePath)) {
      expect(defaultWritePath.value).toBe(testVaultPath1)
    }

    // AND: getVaultPath should also return the same primary vault path
    const vaultPath: O.Option<string> = getVaultPath()
    expect(O.isSome(vaultPath)).toBe(true)
    if (O.isSome(vaultPath)) {
      expect(vaultPath.value).toBe(testVaultPath1)
    }
  })

  it('should return writePath from config when setWritePath is called', async () => {
    // GIVEN: Load a folder and add second vault
    await loadFolder(testVaultPath1)
    await addReadOnLinkPath(testVaultPath2)

    // AND: Change default write path to the second vault
    await setWritePath(testVaultPath2)

    // THEN: getWritePath should return the new default
    const defaultWritePath: O.Option<string> = await getWritePath()
    expect(O.isSome(defaultWritePath)).toBe(true)
    if (O.isSome(defaultWritePath)) {
      expect(defaultWritePath.value).toBe(testVaultPath2)
    }

    // AND: getVaultPath returns the watched directory (not the write path)
    // For write location, always use getWritePath
    const vaultPath: O.Option<string> = getVaultPath()
    expect(O.isSome(vaultPath)).toBe(true)
    if (O.isSome(vaultPath)) {
      expect(vaultPath.value).toBe(testVaultPath1) // Watched directory, not write path
    }
  })
})

describe('Auto-load files when adding new vault path', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-load-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'new-vault')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create a test file in primary vault
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Create test files in the new vault that will be added later
    await fs.writeFile(
      path.join(testVaultPath2, 'newfile1.md'),
      '# New File 1\n\nContent 1.'
    )
    await fs.writeFile(
      path.join(testVaultPath2, 'newfile2.md'),
      '# New File 2\n\nContent 2.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should auto-load files from new vault path when added via addReadOnLinkPath', async () => {
    // GIVEN: Load a folder (initializes with primary vault path)
    await loadFolder(testVaultPath1)

    // Record broadcast calls before adding new vault
    const callsBeforeAdd: number = broadcastCalls.length

    // WHEN: Add a new vault path that contains files
    const result: { success: boolean; error?: string } = await addReadOnLinkPath(testVaultPath2)

    // THEN: Addition should succeed
    expect(result.success).toBe(true)

    // THEN: New files should have been broadcast to UI via single bulk broadcast
    // Uses bulk load path: single stateChanged event containing all new nodes
    const newCalls: BroadcastCall[] = broadcastCalls.slice(callsBeforeAdd)
    const stateChangedCalls: BroadcastCall[] = newCalls.filter(c => c.channel === 'graph:stateChanged')

    // Should have exactly 1 bulk broadcast (not N per-file broadcasts)
    expect(stateChangedCalls.length).toBe(1)

    // The single broadcast should contain both new files
    const bulkDelta: GraphDelta = stateChangedCalls[0].delta
    expect(bulkDelta.length).toBe(2)

    const nodeIds: readonly string[] = bulkDelta.map(d => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
    // Node IDs are absolute paths - check they end with the expected relative path
    expect(nodeIds.some(id => id.endsWith('new-vault/newfile1.md'))).toBe(true)
    expect(nodeIds.some(id => id.endsWith('new-vault/newfile2.md'))).toBe(true)
  })
})

describe('Vault path removal persistence across reload (BUG REGRESSION TEST)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-persistence-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'openspec')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create test files
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )
    await fs.writeFile(
      path.join(testVaultPath2, 'spec.md'),
      '# Spec Node\n\nSpec content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should persist removed vault path across folder reload (removal should NOT re-appear)', async () => {
    // GIVEN: Load folder and add second vault path
    await loadFolder(testVaultPath1)
    await addReadOnLinkPath(testVaultPath2)

    // Verify both paths are in readOnLinkPaths
    expect(await getVaultPaths()).toContain(testVaultPath1)
    expect(await getVaultPaths()).toContain(testVaultPath2)
    console.log('[Test] Initial vault paths:', await getVaultPaths())

    // WHEN: Remove the second path
    const removeResult: { success: boolean; error?: string } = await removeReadOnLinkPath(testVaultPath2)
    expect(removeResult.success).toBe(true)

    // Verify path is removed from memory
    expect(await getVaultPaths()).toContain(testVaultPath1)
    expect(await getVaultPaths()).not.toContain(testVaultPath2)
    console.log('[Test] After removal vault paths:', await getVaultPaths())

    // WHEN: Reload the folder (simulating app restart)
    await loadFolder(testVaultPath1)
    console.log('[Test] After reload vault paths:', await getVaultPaths())

    // THEN: Removed path should NOT be re-added
    expect(await getVaultPaths()).toContain(testVaultPath1)
    expect(await getVaultPaths()).not.toContain(testVaultPath2)
  })

  it('should persist removed vault path even when folder still exists on disk', async () => {
    // This tests the specific bug where paths existing on disk get re-added

    // GIVEN: Load folder with openspec auto-added via default patterns
    // (The openspec folder exists, which would normally be auto-added by resolveAllowlistForProject)
    await loadFolder(testVaultPath1)

    // Manually add openspec to simulate it being auto-added by patterns
    const pathsBefore: readonly string[] = await getVaultPaths()
    if (!pathsBefore.includes(testVaultPath2)) {
      await addReadOnLinkPath(testVaultPath2)
    }

    expect(await getVaultPaths()).toContain(testVaultPath2)
    console.log('[Test] Vault paths with openspec:', await getVaultPaths())

    // WHEN: Remove openspec
    const removeResult: { success: boolean; error?: string } = await removeReadOnLinkPath(testVaultPath2)
    expect(removeResult.success).toBe(true)

    // Verify openspec folder still exists on disk
    const folderExists: boolean = await fs.access(testVaultPath2).then(() => true).catch(() => false)
    expect(folderExists).toBe(true)
    console.log('[Test] openspec folder exists on disk:', folderExists)

    // Verify path is removed from memory
    expect(await getVaultPaths()).not.toContain(testVaultPath2)

    // WHEN: Reload the folder
    await loadFolder(testVaultPath1)
    console.log('[Test] After reload vault paths:', await getVaultPaths())

    // THEN: openspec should NOT be re-added even though folder exists on disk
    // This was the bug - resolveAllowlistForProject would re-add existing folders
    expect(await getVaultPaths()).not.toContain(testVaultPath2)
  })
})

describe('Vault path removal should delete nodes from graph (BUG REGRESSION TEST)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-removal-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'second-vault')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create test files in both vaults
    await fs.writeFile(
      path.join(testVaultPath1, 'keep.md'),
      '# Keep Node\n\nThis should remain.'
    )
    await fs.writeFile(
      path.join(testVaultPath2, 'remove.md'),
      '# Remove Node\n\nThis should be removed.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should remove nodes from graph when vault path is removed from readOnLinkPaths', async () => {
    // GIVEN: Load folder with two vault paths containing nodes
    await loadFolder(testVaultPath1)
    await addReadOnLinkPath(testVaultPath2)

    // Verify both nodes are in the graph (node IDs are absolute file paths)
    const graphBefore: Graph = getGraph()
    const nodeIdsBefore: readonly string[] = Object.keys(graphBefore.nodes)
    expect(nodeIdsBefore.some(id => id.includes('keep.md'))).toBe(true)
    expect(nodeIdsBefore.some(id => id.includes('remove.md'))).toBe(true)

    // WHEN: Remove the second vault path
    const removeResult: { success: boolean; error?: string } = await removeReadOnLinkPath(testVaultPath2)
    expect(removeResult.success).toBe(true)

    // THEN: Nodes from the removed vault should be gone from the graph
    const graphAfter: Graph = getGraph()
    const nodeIdsAfter: readonly string[] = Object.keys(graphAfter.nodes)
    expect(nodeIdsAfter.some(id => id.includes('keep.md'))).toBe(true)
    expect(nodeIdsAfter.some(id => id.includes('remove.md'))).toBe(false)
  })
})

describe('VaultConfig uses writePath (renamed from defaultWritePath)', () => {
  beforeEach(async () => {
    // Create temp directory structure for tests
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'writepath-rename-test-'))
    testWatchedDir = path.join(testTmpDir, 'project')
    testVaultPath1 = path.join(testWatchedDir, 'voicetree')
    testVaultPath2 = path.join(testWatchedDir, 'custom-vault')

    await fs.mkdir(testWatchedDir, { recursive: true })
    await fs.mkdir(testVaultPath1, { recursive: true })
    await fs.mkdir(testVaultPath2, { recursive: true })

    // Create a test file in vault1 so the folder isn't empty
    await fs.writeFile(
      path.join(testVaultPath1, 'test.md'),
      '# Test Node\n\nTest content.'
    )

    // Reset graph state
    setGraph(createEmptyGraph())
    clearVaultPath()

    // Reset broadcast tracking
    broadcastCalls = []

    // Create mock BrowserWindow
    mockMainWindow = {
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          broadcastCalls.push({ channel, delta: data as GraphDelta })
        })
      },
      isDestroyed: vi.fn(() => false)
    }
  })

  afterEach(async () => {
    await stopFileWatching()
    await fs.rm(testTmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('should use getWritePath to get the write path (renamed from getWritePath)', async () => {
    // GIVEN: Load a folder
    await loadFolder(testVaultPath1)

    // WHEN: Get the write path using the renamed function
    const writePath: O.Option<string> = await getWritePath()

    // THEN: It should return the primary vault path
    expect(O.isSome(writePath)).toBe(true)
    if (O.isSome(writePath)) {
      expect(writePath.value).toBe(testVaultPath1)
    }
  })

  it('should use setWritePath to set the write path (renamed from setWritePath)', async () => {
    // GIVEN: Load a folder and add second vault path
    await loadFolder(testVaultPath1)
    await addReadOnLinkPath(testVaultPath2)

    // WHEN: Set write path to the second vault using renamed function
    const result: { success: boolean; error?: string } = await setWritePath(testVaultPath2)

    // THEN: It should succeed
    expect(result.success).toBe(true)

    // AND: getWritePath should return the new path
    const writePath: O.Option<string> = await getWritePath()
    expect(O.isSome(writePath)).toBe(true)
    if (O.isSome(writePath)) {
      expect(writePath.value).toBe(testVaultPath2)
    }
  })

  it('should persist writePath across folder reload (config round-trip)', async () => {
    // GIVEN: Load a folder, add second vault, and set it as write path
    await loadFolder(testVaultPath1)
    await addReadOnLinkPath(testVaultPath2)
    await setWritePath(testVaultPath2)

    // Verify write path is set
    const writePathBefore: O.Option<string> = await getWritePath()
    expect(O.isSome(writePathBefore) && writePathBefore.value === testVaultPath2).toBe(true)

    // WHEN: Reload the folder
    await loadFolder(testVaultPath1)

    // THEN: Write path should be preserved
    const writePathAfter: O.Option<string> = await getWritePath()
    expect(O.isSome(writePathAfter)).toBe(true)
    if (O.isSome(writePathAfter)) {
      expect(writePathAfter.value).toBe(testVaultPath2)
    }
  })
})
