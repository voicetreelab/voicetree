/**
 * Tests for Section 1: Config Structure Changes
 *
 * These tests verify the new VaultConfig structure:
 * - writePath: string (relative or absolute)
 * - readPaths: string[] (replaces allowlist)
 *
 * TDD: Write tests first, verify they fail, then implement.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// Mock electron app before importing modules that use it
const mockUserDataPath: string = path.join(os.tmpdir(), `test-config-${Date.now()}-${Math.random().toString(36).substring(7)}`)

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
import { resolveWritePath } from './vault-allowlist'
import type { VaultConfig } from '@/pure/settings/types'

describe('Section 1: Config Structure Changes', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-structure-test-'))
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

  describe('1.1 VaultConfig uses writePath and readPaths', () => {
    it('should store VaultConfig with writePath and readPaths fields', async () => {
      // GIVEN: A vault config with the new structure
      const watchedDir: string = path.join(testTmpDir, 'project')
      const vaultConfig: VaultConfig = {
        writePath: 'voicetree',
        readPaths: ['openspec', 'docs']
      }

      // WHEN: Save and load the config
      await saveVaultConfigForDirectory(watchedDir, vaultConfig)
      const loadedConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: The loaded config should have the new structure
      expect(loadedConfig).toBeDefined()
      expect(loadedConfig?.writePath).toBe('voicetree')
      expect(loadedConfig?.readPaths).toEqual(['openspec', 'docs'])
    })

    it('should NOT have allowlist field in VaultConfig', async () => {
      // GIVEN: A vault config with the new structure
      const watchedDir: string = path.join(testTmpDir, 'project')
      const vaultConfig: VaultConfig = {
        writePath: 'voicetree',
        readPaths: ['openspec']
      }

      // WHEN: Save and load the config
      await saveVaultConfigForDirectory(watchedDir, vaultConfig)
      const loadedConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: The config should not have 'allowlist' field
      expect(loadedConfig).toBeDefined()
      // Verify the structure only has the expected keys
      const keys: string[] = Object.keys(loadedConfig ?? {})
      expect(keys).toContain('writePath')
      expect(keys).toContain('readPaths')
      expect(keys).not.toContain('allowlist')
    })
  })

  describe('1.2 writePath resolves correctly (relative or absolute)', () => {
    it('should resolve relative writePath against watchedFolder', () => {
      // GIVEN: A relative write path and watched folder
      const watchedFolder: string = '/Users/bob/project'
      const writePath: string = 'voicetree'

      // WHEN: Resolve the write path
      const resolved: string = resolveWritePath(watchedFolder, writePath)

      // THEN: Should be joined as absolute path
      expect(resolved).toBe('/Users/bob/project/voicetree')
    })

    it('should keep absolute writePath unchanged', () => {
      // GIVEN: An absolute write path and watched folder
      const watchedFolder: string = '/Users/bob/project'
      const writePath: string = '/shared/notes'

      // WHEN: Resolve the write path
      const resolved: string = resolveWritePath(watchedFolder, writePath)

      // THEN: Should remain absolute (unchanged)
      expect(resolved).toBe('/shared/notes')
    })

    it('should handle nested relative paths', () => {
      // GIVEN: A nested relative write path
      const watchedFolder: string = '/Users/bob/project'
      const writePath: string = 'docs/voicetree'

      // WHEN: Resolve the write path
      const resolved: string = resolveWritePath(watchedFolder, writePath)

      // THEN: Should be correctly joined
      expect(resolved).toBe('/Users/bob/project/docs/voicetree')
    })
  })

  describe('1.3 Config read/write round-trip with new structure', () => {
    it('should preserve writePath and readPaths across save/load cycle', async () => {
      // GIVEN: A vault config with the new structure
      const watchedDir: string = path.join(testTmpDir, 'project')
      const originalConfig: VaultConfig = {
        writePath: 'my-notes',
        readPaths: ['openspec', 'docs', 'archive']
      }

      // WHEN: Save the config
      await saveVaultConfigForDirectory(watchedDir, originalConfig)

      // AND: Load it back
      const loadedConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: All fields should be preserved
      expect(loadedConfig).toBeDefined()
      expect(loadedConfig?.writePath).toBe(originalConfig.writePath)
      expect(loadedConfig?.readPaths).toEqual(originalConfig.readPaths)
    })

    it('should persist config across multiple directories', async () => {
      // GIVEN: Two project directories with different configs
      const projectA: string = path.join(testTmpDir, 'projectA')
      const projectB: string = path.join(testTmpDir, 'projectB')

      const configA: VaultConfig = {
        writePath: 'voicetree-a',
        readPaths: ['openspec']
      }
      const configB: VaultConfig = {
        writePath: '/absolute/path/notes',
        readPaths: ['docs', 'archive']
      }

      // WHEN: Save both configs
      await saveVaultConfigForDirectory(projectA, configA)
      await saveVaultConfigForDirectory(projectB, configB)

      // AND: Load them back
      const loadedA: VaultConfig | undefined = await getVaultConfigForDirectory(projectA)
      const loadedB: VaultConfig | undefined = await getVaultConfigForDirectory(projectB)

      // THEN: Each project should have its own config
      expect(loadedA?.writePath).toBe('voicetree-a')
      expect(loadedA?.readPaths).toEqual(['openspec'])
      expect(loadedB?.writePath).toBe('/absolute/path/notes')
      expect(loadedB?.readPaths).toEqual(['docs', 'archive'])
    })

    it('should handle empty readPaths array', async () => {
      // GIVEN: A config with no readPaths
      const watchedDir: string = path.join(testTmpDir, 'project')
      const config: VaultConfig = {
        writePath: 'voicetree',
        readPaths: []
      }

      // WHEN: Save and load
      await saveVaultConfigForDirectory(watchedDir, config)
      const loaded: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir)

      // THEN: Empty array should be preserved
      expect(loaded?.readPaths).toEqual([])
    })
  })
})
