/* vt-allow-direct-daemon-mutation-import: low-level vault-allowlist behaviour test */
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
import { getVaultPaths, loadAndMergeVaultPath, type VaultLoadOutcome, addReadPath, setWriteFolder } from '@vt/graph-db-server/watch-folder/vault-allowlist'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { setAppSupportPath } from '@vt/graph-db-server/state/app-support-store'
import { setProjectRoot, clearWatchFolderState, setWatcher } from '@vt/graph-db-server/state/watch-folder-store'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import { setActiveViewFolderState } from '@vt/graph-db-server/watch-folder/folder-visibility-active-view'
import { createEmptyGraph } from '@vt/graph-model/graph'
import type { VaultConfig } from '@vt/graph-model/settings'
import { initGraphModel } from '@vt/graph-model'

vi.mock('@/shell/edge/main/runtime/ui-api-proxy', () => ({
  uiAPI: {
    fitViewport: vi.fn()
  }
}))

let notifyWriteDirectory: ReturnType<typeof vi.fn>
const FILE_COUNT_ABOVE_RAISED_LIMIT = 1001

function resetGraphModel(): void {
  notifyWriteDirectory = vi.fn()
  setAppSupportPath(mockUserDataPath)
  initGraphModel({
    notifyWriteDirectory,
    fitViewport: vi.fn(),
    syncVaultState: vi.fn()
  })
}

async function seedMarkdownFiles(dir: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      fs.writeFile(path.join(dir, `note-${index}.md`), `# Note ${index}\n\nContent ${index}`)
    )
  )
}

describe('vault-allowlist: duplicate writeFolder in dropdown bug', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-allowlist-test-'))
    // Ensure mock userData path exists
    await fs.mkdir(mockUserDataPath, { recursive: true })
    resetGraphModel()
    setGraph(createEmptyGraph())
    clearWatchFolderState()
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
    it('should NOT return duplicate paths when writeFolder is also in readPaths', async () => {
      // GIVEN: A watched directory
      const watchedDir: string = path.join(testTmpDir, 'project')
      await fs.mkdir(watchedDir, { recursive: true })
      setProjectRoot(watchedDir)

      // AND: A config where writeFolder is also present in readPaths (buggy state)
      const vaultPath: string = path.join(watchedDir, 'fri')
      await fs.mkdir(vaultPath, { recursive: true })
      const buggyConfig: VaultConfig = {
        writeFolder: vaultPath,
        readPaths: [vaultPath]  // Same path in both writeFolder AND readPaths
      }
      await saveVaultConfigForDirectory(watchedDir, buggyConfig)

      // WHEN: getVaultPaths is called
      const paths: readonly string[] = await getVaultPaths()

      // THEN: Should return unique paths only (no duplicates)
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length)
      expect(paths).toEqual(uniquePaths)
    })

    it('should return unique paths after setWriteFolder to a path already in readPaths', async () => {
      // GIVEN: A watched directory with initial config
      const watchedDir: string = path.join(testTmpDir, 'project')
      await fs.mkdir(watchedDir, { recursive: true })
      setProjectRoot(watchedDir)

      // AND: Initial config with separate writeFolder and readPath
      const writeFolderA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      await fs.mkdir(writeFolderA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })

      const initialConfig: VaultConfig = {
        writeFolder: writeFolderA,
        readPaths: [readPathB]
      }
      await saveVaultConfigForDirectory(watchedDir, initialConfig)

      // WHEN: setWriteFolder is called with a path that's already in readPaths
      await setWriteFolder(readPathB)

      // AND: getVaultPaths is called
      const paths: readonly string[] = await getVaultPaths()

      // THEN: Should return unique paths only - readPathB should NOT appear twice
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length)
      expect(paths).toEqual(uniquePaths)
    })
  })

  describe('setWriteFolder should demote old writeFolder to readPaths', () => {
    it('should add old writeFolder to readPaths when setting a new writeFolder', async () => {
      // GIVEN: A watched directory with writeFolder=A, readPaths=[B]
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writeFolderA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      const newWriteFolderC: string = path.join(watchedDir, 'pathC')
      await fs.mkdir(writeFolderA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })
      await fs.mkdir(newWriteFolderC, { recursive: true })
      setProjectRoot(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writeFolder: writeFolderA,
      })
      await setActiveViewFolderState(watchedDir, readPathB, 'expanded')

      // WHEN: setWriteFolder is called with a new path C
      await setWriteFolder(newWriteFolderC)

      // THEN: getVaultPaths should include all three paths: C (write), B (read), A (demoted)
      const paths: readonly string[] = await getVaultPaths()
      expect(paths).toContain(newWriteFolderC)
      expect(paths).toContain(readPathB)
      expect(paths).toContain(writeFolderA)
    })

    it('should demote old writeFolder when promoting a readPath to write', async () => {
      // GIVEN: writeFolder=A, readPaths=[B]
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writeFolderA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      await fs.mkdir(writeFolderA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })
      setProjectRoot(watchedDir)

      await saveVaultConfigForDirectory(watchedDir, {
        writeFolder: writeFolderA,
        readPaths: [readPathB]
      })

      // WHEN: setWriteFolder promotes B to write
      await setWriteFolder(readPathB)

      // THEN: A should be demoted to readPaths, B should not be duplicated
      const paths: readonly string[] = await getVaultPaths()
      expect(paths).toContain(readPathB)  // B is now writeFolder
      expect(paths).toContain(writeFolderA) // A demoted to readPaths
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
    resetGraphModel()
    setGraph(createEmptyGraph())
    clearWatchFolderState()
    setProjectRoot(testTmpDir)
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
    const notePath: string = path.join(vaultPath, 'test-node.md')
    await fs.writeFile(notePath, '# Test Node\n\nHello world.')

    // WHEN: loadAndMergeVaultPath is called (impure edge function)
    const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath)

    // THEN: Should return success
    expect(outcome.kind).toBe('ok')
    expect(getGraph().nodes[notePath]).toBeDefined()
    expect(Object.keys(getGraph().nodes)).toHaveLength(1)
  })

  it('returns fileLimit outcome when file limit is exceeded', async () => {
    // GIVEN: A vault path
    const vaultPath: string = path.join(testTmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })
    await seedMarkdownFiles(vaultPath, FILE_COUNT_ABOVE_RAISED_LIMIT)

    // WHEN: loadAndMergeVaultPath is called (impure edge function)
    const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath)

    // THEN: Should return fileLimit with typed details
    expect(outcome.kind).toBe('fileLimit')
    if (outcome.kind === 'fileLimit') {
      expect(outcome.details.fileCount).toBe(FILE_COUNT_ABOVE_RAISED_LIMIT)
      expect(outcome.details.maxFiles).toBeGreaterThan(0)
    }
  })
})

describe('vault-allowlist: file limit exceeded error handling', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-file-limit-test-'))
    // Ensure mock userData path exists
    await fs.mkdir(mockUserDataPath, { recursive: true })
    resetGraphModel()
    setGraph(createEmptyGraph())
    clearWatchFolderState()
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
      const writeFolder: string = path.join(watchedDir, 'voicetree')
      const newReadPath: string = path.join(watchedDir, 'too-many-files')
      await fs.mkdir(writeFolder, { recursive: true })
      await fs.mkdir(newReadPath, { recursive: true })
      setProjectRoot(watchedDir)

      const config: VaultConfig = {
        writeFolder: writeFolder,
        readPaths: []
      }
      await saveVaultConfigForDirectory(watchedDir, config)

      await seedMarkdownFiles(newReadPath, FILE_COUNT_ABOVE_RAISED_LIMIT)

      // WHEN: addReadPath is called
      const result: { success: boolean; error?: string } = await addReadPath(newReadPath)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain(String(FILE_COUNT_ABOVE_RAISED_LIMIT))
    })
  })

  describe('setWriteFolder returns error when file limit exceeded', () => {
    it('returns error when file limit is exceeded', async () => {
      // GIVEN: A watched directory with a config
      const watchedDir: string = path.join(testTmpDir, 'project')
      const currentWriteFolder: string = path.join(watchedDir, 'voicetree')
      const newWriteFolder: string = path.join(watchedDir, 'too-many-files')
      await fs.mkdir(currentWriteFolder, { recursive: true })
      await fs.mkdir(newWriteFolder, { recursive: true })
      setProjectRoot(watchedDir)

      const config: VaultConfig = {
        writeFolder: currentWriteFolder,
        readPaths: []
      }
      await saveVaultConfigForDirectory(watchedDir, config)

      await seedMarkdownFiles(newWriteFolder, FILE_COUNT_ABOVE_RAISED_LIMIT)

      // WHEN: setWriteFolder is called
      const result: { success: boolean; error?: string } = await setWriteFolder(newWriteFolder)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain(String(FILE_COUNT_ABOVE_RAISED_LIMIT))
    })
  })
})

/**
 * Phase 2 Tests: loadAndMergeVaultPath with isWriteFolder option
 * Updated for impure edge function that handles side effects internally
 */
describe('vault-allowlist: loadAndMergeVaultPath isWriteFolder behavior', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-isWriteFolder-test-'))
    await fs.mkdir(mockUserDataPath, { recursive: true })
    resetGraphModel()
    setGraph(createEmptyGraph())
    clearWatchFolderState()
    // Set project root for wikilink resolution
    setProjectRoot(testTmpDir)
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

  describe('when isWriteFolder is true', () => {
    it('creates starter node when folder is empty', async () => {
      // GIVEN: An empty vault path
      const vaultPath: string = path.join(testTmpDir, 'empty-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWriteFolder: true
      const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath, { isWriteFolder: true })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: A starter node should have been created in both graph state and on disk.
      const createdNodeIds: readonly string[] = Object.keys(getGraph().nodes)
      expect(createdNodeIds).toHaveLength(1)
      expect(createdNodeIds[0].startsWith(vaultPath + path.sep)).toBe(true)
      await expect(fs.access(createdNodeIds[0])).resolves.toBeUndefined()
    })

    it('does not create starter node when folder has files', async () => {
      // GIVEN: A vault path with existing files
      const vaultPath: string = path.join(testTmpDir, 'non-empty-vault')
      await fs.mkdir(vaultPath, { recursive: true })
      const existingNodeId: string = path.join(vaultPath, 'existing-file.md')
      await fs.writeFile(existingNodeId, '# Existing File\n\nAlready here.')

      // WHEN: loadAndMergeVaultPath is called with isWriteFolder: true
      const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath, { isWriteFolder: true })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: Only the existing file should be present - no starter node created.
      const createdNodeIds: readonly string[] = Object.keys(getGraph().nodes)
      expect(createdNodeIds).toEqual([existingNodeId])
    })

    it('notifies backend for write paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'write-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWriteFolder: true
      const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath, { isWriteFolder: true })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: The backend notification callback should have been called.
      expect(notifyWriteDirectory).toHaveBeenCalledWith(vaultPath)
    })

    it('resolves wikilinks after loading', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'vault-with-links')
      await fs.mkdir(vaultPath, { recursive: true })
      const noteId: string = path.join(vaultPath, 'note.md')
      const targetId: string = path.join(vaultPath, 'target.md')
      await fs.writeFile(noteId, '# Note\n\n[[target.md]]')
      await fs.writeFile(targetId, '# Target\n\nResolved target.')

      // WHEN: loadAndMergeVaultPath is called
      await loadAndMergeVaultPath(vaultPath, { isWriteFolder: true })

      // THEN: Wikilink resolution should connect note.md to target.md.
      expect(getGraph().nodes[noteId]?.outgoingEdges.map(edge => edge.targetId)).toContain(targetId)
    })
  })

  describe('when isWriteFolder is false', () => {
    it('does not create starter node for read paths', async () => {
      // GIVEN: An empty vault path
      const vaultPath: string = path.join(testTmpDir, 'empty-read-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWriteFolder: false
      const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath, { isWriteFolder: false })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: No starter node should be created for read-only paths.
      expect(Object.keys(getGraph().nodes)).toHaveLength(0)
    })

    it('does not notify backend for read paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'read-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWriteFolder: false
      const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath, { isWriteFolder: false })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: Read-only paths should not notify the backend about write-directory changes.
      expect(notifyWriteDirectory).not.toHaveBeenCalled()
    })

    it('still resolves wikilinks for read paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'read-vault-with-links')
      await fs.mkdir(vaultPath, { recursive: true })
      const noteId: string = path.join(vaultPath, 'note.md')
      const targetId: string = path.join(vaultPath, 'target.md')
      await fs.writeFile(noteId, '# Note\n\n[[target.md]]')
      await fs.writeFile(targetId, '# Target\n\nResolved target.')

      // WHEN: loadAndMergeVaultPath is called with isWriteFolder: false
      await loadAndMergeVaultPath(vaultPath, { isWriteFolder: false })

      // THEN: Read-only loads should still resolve wikilinks into concrete edges.
      expect(getGraph().nodes[noteId]?.outgoingEdges.map(edge => edge.targetId)).toContain(targetId)
    })
  })
})
