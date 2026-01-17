/**
 * Tests for Section 8: Show All Nodes Toggle
 *
 * These tests verify the show-all toggle per readOnLinkPath:
 * - showAllPaths: string[] in VaultConfig tracks which paths show all nodes
 * - toggleShowAll(path) toggles the flag
 * - State persists across config saves
 *
 * TDD: Write tests first, verify they fail, then implement.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// Mock electron app before importing modules that use it
const mockUserDataPath: string = path.join(os.tmpdir(), `test-show-all-${Date.now()}-${Math.random().toString(36).substring(7)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath)
  }
}))

// Import after mocks are set up
import {
  getVaultConfigForDirectory,
  saveVaultConfigForDirectory,
} from './voicetree-config-io'
import { toggleShowAll, getShowAllPaths } from './vault-allowlist'
import type { VaultConfig } from '@/pure/settings/types'

// Mock the watch-folder-store to avoid needing actual file watching
vi.mock('@/shell/edge/main/state/watch-folder-store', () => ({
  getWatchedDirectory: vi.fn(),
  setWatchedDirectory: vi.fn(),
  getWatcher: vi.fn(() => null),
}))

import { getWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store'

describe('Section 8: Show All Nodes Toggle', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'show-all-toggle-test-'))
    // Ensure mock userData path exists
    await fs.mkdir(mockUserDataPath, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true })
    // Clean up config file
    try {
      await fs.rm(path.join(mockUserDataPath, 'voicetree-config.json'), { force: true })
    } catch {
      // ignore
    }
    vi.clearAllMocks()
  })

  describe('8.1 Toggle state persists per readOnLinkPath', () => {
    it('should store showAllPaths in VaultConfig', async () => {
      // GIVEN: A vault config with showAllPaths
      const watchedDir: string = path.join(testTmpDir, 'project')
      const vaultConfig: VaultConfig = {
        writePath: 'voicetree',
        readOnLinkPaths: ['openspec', 'docs'],
        showAllPaths: ['openspec']
      }

      // WHEN: Save and load the config
      await saveVaultConfigForDirectory(watchedDir, vaultConfig)
      const loadedConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: The showAllPaths should be preserved
      expect(loadedConfig).toBeDefined()
      expect(loadedConfig?.showAllPaths).toEqual(['openspec'])
    })

    it('should default to empty showAllPaths if not present', async () => {
      // GIVEN: A vault config without showAllPaths
      const watchedDir: string = path.join(testTmpDir, 'project')
      const vaultConfig: VaultConfig = {
        writePath: 'voicetree',
        readOnLinkPaths: ['openspec']
      }

      // WHEN: Save and load the config
      await saveVaultConfigForDirectory(watchedDir, vaultConfig)
      const loadedConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: showAllPaths should default to empty array
      expect(loadedConfig).toBeDefined()
      expect(loadedConfig?.showAllPaths ?? []).toEqual([])
    })

    it('should allow multiple paths in showAllPaths', async () => {
      // GIVEN: A vault config with multiple showAllPaths
      const watchedDir: string = path.join(testTmpDir, 'project')
      const vaultConfig: VaultConfig = {
        writePath: 'voicetree',
        readOnLinkPaths: ['openspec', 'docs', 'archive'],
        showAllPaths: ['openspec', 'archive']
      }

      // WHEN: Save and load the config
      await saveVaultConfigForDirectory(watchedDir, vaultConfig)
      const loadedConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: All showAllPaths should be preserved
      expect(loadedConfig?.showAllPaths).toEqual(['openspec', 'archive'])
    })
  })

  describe('8.4 toggleShowAll function', () => {
    it('should add path to showAllPaths when not present', async () => {
      // GIVEN: A project with no showAllPaths
      const watchedDir: string = path.join(testTmpDir, 'project')
      vi.mocked(getWatchedDirectory).mockReturnValue(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writePath: 'voicetree',
        readOnLinkPaths: ['/abs/openspec'],
        showAllPaths: []
      })

      // WHEN: Toggle showAll for a path
      const result: { success: boolean; showAll?: boolean; error?: string } = await toggleShowAll('/abs/openspec')

      // THEN: Path should be added to showAllPaths
      expect(result.success).toBe(true)
      expect(result.showAll).toBe(true)
      const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)
      expect(config?.showAllPaths).toContain('/abs/openspec')
    })

    it('should remove path from showAllPaths when present', async () => {
      // GIVEN: A project with a path in showAllPaths
      const watchedDir: string = path.join(testTmpDir, 'project')
      vi.mocked(getWatchedDirectory).mockReturnValue(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writePath: 'voicetree',
        readOnLinkPaths: ['/abs/openspec'],
        showAllPaths: ['/abs/openspec']
      })

      // WHEN: Toggle showAll for that path
      const result: { success: boolean; showAll?: boolean; error?: string } = await toggleShowAll('/abs/openspec')

      // THEN: Path should be removed from showAllPaths
      expect(result.success).toBe(true)
      expect(result.showAll).toBe(false)
      const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)
      expect(config?.showAllPaths).not.toContain('/abs/openspec')
    })

    it('should fail when no directory is being watched', async () => {
      // GIVEN: No directory is being watched
      vi.mocked(getWatchedDirectory).mockReturnValue(null)

      // WHEN: Try to toggle showAll
      const result: { success: boolean; showAll?: boolean; error?: string } = await toggleShowAll('/some/path')

      // THEN: Should fail with error
      expect(result.success).toBe(false)
      expect(result.error).toBe('No directory is being watched')
    })
  })

  describe('8.5 getShowAllPaths function', () => {
    it('should return current showAllPaths', async () => {
      // GIVEN: A project with showAllPaths configured
      const watchedDir: string = path.join(testTmpDir, 'project')
      vi.mocked(getWatchedDirectory).mockReturnValue(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writePath: 'voicetree',
        readOnLinkPaths: ['/abs/openspec', '/abs/docs'],
        showAllPaths: ['/abs/openspec']
      })

      // WHEN: Get showAllPaths
      const paths: readonly string[] = await getShowAllPaths()

      // THEN: Should return the configured paths
      expect(paths).toEqual(['/abs/openspec'])
    })

    it('should return empty array when no config exists', async () => {
      // GIVEN: A project with no config
      const watchedDir: string = path.join(testTmpDir, 'project')
      vi.mocked(getWatchedDirectory).mockReturnValue(watchedDir)

      // WHEN: Get showAllPaths
      const paths: readonly string[] = await getShowAllPaths()

      // THEN: Should return empty array
      expect(paths).toEqual([])
    })
  })

  // These tests require Section 7 (Lazy Loading) to be implemented
  // They verify the integration between showAll toggle and lazy loading
  describe.skip('8.2 & 8.3 Integration with lazy loading (requires Section 7)', () => {
    it.todo('8.2 Test: Toggling on loads all nodes from that path')
    it.todo('8.3 Test: Toggling off hides unlinked nodes')
  })
})
