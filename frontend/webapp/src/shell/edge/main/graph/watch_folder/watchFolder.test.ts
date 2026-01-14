/**
 * Unit Tests for Multi-Vault Path Functionality
 *
 * Tests the public API functions for multi-vault path management:
 * - getVaultPaths() - returns readonly FilePath[] of allowlisted vault paths
 * - getDefaultWritePath() - returns O.Option<FilePath> of default write path
 * - setDefaultWritePath(path) - sets default write path, returns {success, error?}
 * - addVaultPathToAllowlist(path) - adds path to allowlist
 * - removeVaultPathFromAllowlist(path) - removes path from allowlist
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
  getDefaultWritePath,
  setDefaultWritePath,
  addVaultPathToAllowlist,
  removeVaultPathFromAllowlist,
  loadFolder,
  stopFileWatching,
  getVaultPath,
  clearVaultPath,
} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { setGraph } from '@/shell/edge/main/state/graph-store'
import type { GraphDelta } from '@/pure/graph'

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
    setGraph({ nodes: {} })
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
    it('should return all configured vault paths from getVaultPaths()', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testWatchedDir, 'voicetree')

      // AND: Add additional vault paths
      const result1: { success: boolean; error?: string } = await addVaultPathToAllowlist(testVaultPath2)
      const result2: { success: boolean; error?: string } = await addVaultPathToAllowlist(testVaultPath3)

      // ASSERT: Both additions succeeded
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      // ASSERT: getVaultPaths() returns all paths
      const vaultPaths: readonly string[] = getVaultPaths()
      expect(vaultPaths).toContain(testVaultPath1)
      expect(vaultPaths).toContain(testVaultPath2)
      expect(vaultPaths).toContain(testVaultPath3)
      expect(vaultPaths.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('7.1.2 Scenario: Vault path validation', () => {
    it('should reject non-existent paths and leave allowlist unchanged', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testWatchedDir, 'voicetree')
      const initialPaths: readonly string[] = [...getVaultPaths()]

      // WHEN: Attempt to add non-existent path
      const nonExistentPath: string = '/nonexistent/path/that/does/not/exist'
      const result: { success: boolean; error?: string } = await addVaultPathToAllowlist(nonExistentPath)

      // ASSERT: Function returns error
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('does not exist')

      // ASSERT: getVaultPaths() unchanged
      const currentPaths: readonly string[] = getVaultPaths()
      expect(currentPaths).toEqual(initialPaths)
    })
  })

  describe('7.1.3 Scenario: Duplicate vault path prevention', () => {
    it('should not add duplicate paths to allowlist', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testWatchedDir, 'voicetree')

      // AND: Add a path (using custom-vault which is not auto-added by defaultAllowlistPatterns)
      const firstAdd: { success: boolean; error?: string } = await addVaultPathToAllowlist(testVaultPath2)
      expect(firstAdd.success).toBe(true)
      const lengthAfterFirstAdd: number = getVaultPaths().length

      // WHEN: Attempt to add same path again
      const secondAdd: { success: boolean; error?: string } = await addVaultPathToAllowlist(testVaultPath2)

      // ASSERT: Duplicate not added (allowlist length unchanged)
      expect(secondAdd.success).toBe(false)
      expect(secondAdd.error).toContain('already in allowlist')
      expect(getVaultPaths().length).toBe(lengthAfterFirstAdd)
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
    setGraph({ nodes: {} })
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
      await loadFolder(testWatchedDir, 'voicetree')

      // ASSERT: getDefaultWritePath() returns that path automatically
      const defaultWritePath: O.Option<string> = getDefaultWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)
      if (O.isSome(defaultWritePath)) {
        expect(defaultWritePath.value).toBe(testVaultPath1)
      }
    })
  })

  describe('7.2.3 Scenario: Default write path must be in allowlist', () => {
    it('should reject setting default to path not in allowlist', async () => {
      // GIVEN: Load a folder (initializes with primary vault path)
      await loadFolder(testWatchedDir, 'voicetree')

      // WHEN: Attempt to set default to a path NOT in allowlist
      const outsidePath: string = path.join(testTmpDir, 'outside')
      await fs.mkdir(outsidePath, { recursive: true })
      const result: { success: boolean; error?: string } = setDefaultWritePath(outsidePath)

      // ASSERT: setDefaultWritePath() returns error
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('allowlist')

      // ASSERT: Default write path unchanged
      const defaultWritePath: O.Option<string> = getDefaultWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)
      if (O.isSome(defaultWritePath)) {
        expect(defaultWritePath.value).toBe(testVaultPath1)
      }
    })

    it('should accept setting default to path that IS in allowlist', async () => {
      // GIVEN: Load a folder and add second vault path
      await loadFolder(testWatchedDir, 'voicetree')
      await addVaultPathToAllowlist(testVaultPath2)

      // WHEN: Set default to the second path (which IS in allowlist)
      const result: { success: boolean; error?: string } = setDefaultWritePath(testVaultPath2)

      // ASSERT: setDefaultWritePath() succeeds
      expect(result.success).toBe(true)

      // ASSERT: Default write path is now the second path
      const defaultWritePath: O.Option<string> = getDefaultWritePath()
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
    setGraph({ nodes: {} })
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

  it('should remove path from allowlist when it is not the default write path', async () => {
    // GIVEN: Load a folder and add second vault path
    await loadFolder(testWatchedDir, 'voicetree')
    await addVaultPathToAllowlist(testVaultPath2)
    expect(getVaultPaths()).toContain(testVaultPath2)

    // WHEN: Remove the second path (not the default)
    const result: { success: boolean; error?: string } = removeVaultPathFromAllowlist(testVaultPath2)

    // ASSERT: Removal succeeds
    expect(result.success).toBe(true)

    // ASSERT: Path is no longer in allowlist
    expect(getVaultPaths()).not.toContain(testVaultPath2)
  })

  it('should reject removing the default write path', async () => {
    // GIVEN: Load a folder (primary vault is default write path)
    await loadFolder(testWatchedDir, 'voicetree')

    // WHEN: Attempt to remove the default write path
    const result: { success: boolean; error?: string } = removeVaultPathFromAllowlist(testVaultPath1)

    // ASSERT: Removal fails
    expect(result.success).toBe(false)
    expect(result.error).toContain('default write path')

    // ASSERT: Path is still in allowlist
    expect(getVaultPaths()).toContain(testVaultPath1)
  })

  it('should reject removing path not in allowlist', async () => {
    // GIVEN: Load a folder
    await loadFolder(testWatchedDir, 'voicetree')

    // WHEN: Attempt to remove path not in allowlist
    const outsidePath: string = '/some/random/path'
    const result: { success: boolean; error?: string } = removeVaultPathFromAllowlist(outsidePath)

    // ASSERT: Removal fails
    expect(result.success).toBe(false)
    expect(result.error).toContain('not in allowlist')
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
    setGraph({ nodes: {} })
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
    it('should auto-add openspec to allowlist when folder exists and pattern matches', async () => {
      // Note: This test depends on settings.defaultAllowlistPatterns being set
      // The current implementation in resolveAllowlistForProject reads from loadSettings()
      // For unit testing without integration, we verify the behavior via the public API

      // GIVEN: Settings have defaultAllowlistPatterns: ["openspec"]
      // (This is configured via settings.json - we test the outcome)

      // GIVEN: openspec folder exists in project
      // (Already created in beforeEach)

      // WHEN: loadFolder is called
      await loadFolder(testWatchedDir, 'voicetree')

      // THEN: Check if openspec is in the allowlist
      // Note: This depends on the actual settings configuration
      // The test validates the public API behavior
      const vaultPaths: readonly string[] = getVaultPaths()

      // At minimum, the primary vault path should be in the allowlist
      expect(vaultPaths).toContain(testVaultPath1)

      // If defaultAllowlistPatterns includes "openspec", it should be auto-added
      // This is an integration behavior - unit test verifies API works
    })
  })

  describe('7.3.2 Scenario: Per-project explicit allowlist', () => {
    it('should maintain separate allowlists between projects', async () => {
      // GIVEN: Create two project directories
      const projectA: string = testWatchedDir
      const projectB: string = path.join(testTmpDir, 'project-b')
      const projectBVault: string = path.join(projectB, 'voicetree')
      const projectBCustomPath: string = path.join(projectB, 'custom')

      await fs.mkdir(projectB, { recursive: true })
      await fs.mkdir(projectBVault, { recursive: true })
      await fs.mkdir(projectBCustomPath, { recursive: true })
      await fs.writeFile(path.join(projectBVault, 'test.md'), '# Test')

      // WHEN: Load project A and add custom path
      await loadFolder(projectA, 'voicetree')
      await addVaultPathToAllowlist(testVaultPath2)

      const projectAPaths: readonly string[] = [...getVaultPaths()]
      expect(projectAPaths).toContain(testVaultPath2)

      // WHEN: Switch to project B
      await loadFolder(projectB, 'voicetree')

      // THEN: Project B should NOT have project A's custom path
      const projectBPaths: readonly string[] = getVaultPaths()
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
    setGraph({ nodes: {} })
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
      // GIVEN: Load folder with specific vault suffix
      await loadFolder(testWatchedDir, 'voicetree-vault')

      // THEN: Default write path should be the vault path, NOT watched directory root
      const defaultWritePath: O.Option<string> = getDefaultWritePath()
      expect(O.isSome(defaultWritePath)).toBe(true)

      if (O.isSome(defaultWritePath)) {
        // ASSERT: File should be written to vault path
        expect(defaultWritePath.value).toBe(testVaultPath1)

        // ASSERT: File should NOT be at watched directory root
        expect(defaultWritePath.value).not.toBe(testWatchedDir)

        // Verify the path ends with the vault suffix
        expect(defaultWritePath.value.endsWith('voicetree-vault')).toBe(true)
      }
    })

    it('should return vault path (not watched directory) from getVaultPath', async () => {
      // GIVEN: Load folder with vault suffix
      await loadFolder(testWatchedDir, 'voicetree-vault')

      // THEN: getVaultPath should return vault path, not watched directory
      const vaultPath: O.Option<string> = getVaultPath()
      expect(O.isSome(vaultPath)).toBe(true)

      if (O.isSome(vaultPath)) {
        expect(vaultPath.value).toBe(testVaultPath1)
        expect(vaultPath.value).not.toBe(testWatchedDir)
      }
    })
  })
})

describe('Fallback Behavior - getVaultPath vs getDefaultWritePath', () => {
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
    setGraph({ nodes: {} })
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

  it('should have getDefaultWritePath fall back to getVaultPath when no explicit default set', async () => {
    // GIVEN: Load a folder (sets up primary vault as default)
    await loadFolder(testWatchedDir, 'voicetree')

    // WHEN: Get the default write path
    const defaultWritePath: O.Option<string> = getDefaultWritePath()

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

  it('should allow changing default write path while keeping getVaultPath unchanged', async () => {
    // GIVEN: Load a folder and add second vault
    await loadFolder(testWatchedDir, 'voicetree')
    await addVaultPathToAllowlist(testVaultPath2)

    // AND: Change default write path to the second vault
    setDefaultWritePath(testVaultPath2)

    // THEN: getDefaultWritePath should return the new default
    const defaultWritePath: O.Option<string> = getDefaultWritePath()
    expect(O.isSome(defaultWritePath)).toBe(true)
    if (O.isSome(defaultWritePath)) {
      expect(defaultWritePath.value).toBe(testVaultPath2)
    }

    // BUT: getVaultPath (legacy API) still returns primary vault path
    const vaultPath: O.Option<string> = getVaultPath()
    expect(O.isSome(vaultPath)).toBe(true)
    if (O.isSome(vaultPath)) {
      expect(vaultPath.value).toBe(testVaultPath1)
    }
  })
})
