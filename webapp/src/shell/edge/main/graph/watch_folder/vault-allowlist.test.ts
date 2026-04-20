/**
 * Tests for vault-allowlist.ts
 *
 * TDD: Write tests first, verify they fail, then implement fix.
 */

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
import {
  getVaultPaths,
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
import { getGraph, setGraph } from '@/shell/edge/main/state/graph-store'
import { createEmptyGraph } from '@vt/graph-model/pure/graph/createGraph'
import type { GraphDelta } from '@vt/graph-model/pure/graph'
import type { VaultConfig } from '@vt/graph-model/pure/settings/types'
import { addReadPath, initGraphModel, setWritePath } from '@vt/graph-model'

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
  uiAPI: {
    fitViewport: vi.fn()
  }
}))

let graphDeltas: GraphDelta[] = []
let notifyWriteDirectory: ReturnType<typeof vi.fn>

function resetGraphModel(): void {
  graphDeltas = []
  notifyWriteDirectory = vi.fn()
  initGraphModel(
    { appSupportPath: mockUserDataPath },
    {
      onGraphDelta: (delta: GraphDelta): void => {
        graphDeltas.push(delta)
      },
      notifyWriteDirectory,
      fitViewport: vi.fn(),
      syncVaultState: vi.fn()
    }
  )
}

async function seedMarkdownFiles(dir: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      fs.writeFile(path.join(dir, `note-${index}.md`), `# Note ${index}\n\nContent ${index}`)
    )
  )
}

describe('vault-allowlist: duplicate writePath in dropdown bug', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-allowlist-test-'))
    // Ensure mock userData path exists
    await fs.mkdir(mockUserDataPath, { recursive: true })
    resetGraphModel()
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
    resetGraphModel()
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
    const notePath: string = path.join(vaultPath, 'test-node.md')
    await fs.writeFile(notePath, '# Test Node\n\nHello world.')

    // WHEN: loadAndMergeVaultPath is called (impure edge function)
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath)

    // THEN: Should return success
    expect(result.success).toBe(true)
    expect(getGraph().nodes[notePath]).toBeDefined()
    expect(graphDeltas).toHaveLength(1)
    expect(graphDeltas[0]).toHaveLength(1)
  })

  it('returns error when file limit is exceeded', async () => {
    // GIVEN: A vault path
    const vaultPath: string = path.join(testTmpDir, 'vault')
    await fs.mkdir(vaultPath, { recursive: true })
    await seedMarkdownFiles(vaultPath, 601)

    // WHEN: loadAndMergeVaultPath is called (impure edge function)
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath)

    // THEN: Should return error
    expect(result.success).toBe(false)
    expect(result.error).toContain('File limit exceeded')
    expect(result.error).toContain('601')
    expect(result.error).toContain('600')
  })
})

describe('vault-allowlist: file limit exceeded error handling', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-file-limit-test-'))
    // Ensure mock userData path exists
    await fs.mkdir(mockUserDataPath, { recursive: true })
    resetGraphModel()
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

      await seedMarkdownFiles(newReadPath, 601)

      // WHEN: addReadPath is called
      const result: { success: boolean; error?: string } = await addReadPath(newReadPath)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain('601')
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

      await seedMarkdownFiles(newWritePath, 601)

      // WHEN: setWritePath is called
      const result: { success: boolean; error?: string } = await setWritePath(newWritePath)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain('601')
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
    resetGraphModel()
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

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success
      expect(result.success).toBe(true)

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

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: Only the existing file should be present - no starter node created.
      const createdNodeIds: readonly string[] = Object.keys(getGraph().nodes)
      expect(createdNodeIds).toEqual([existingNodeId])
    })

    it('notifies backend for write paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'write-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: true
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Should return success
      expect(result.success).toBe(true)

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
      await loadAndMergeVaultPath(vaultPath, { isWritePath: true })

      // THEN: Wikilink resolution should connect note.md to target.md.
      expect(getGraph().nodes[noteId]?.outgoingEdges.map(edge => edge.targetId)).toContain(targetId)
    })
  })

  describe('when isWritePath is false', () => {
    it('does not create starter node for read paths', async () => {
      // GIVEN: An empty vault path
      const vaultPath: string = path.join(testTmpDir, 'empty-read-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: false
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: false })

      // THEN: Should return success
      expect(result.success).toBe(true)

      // AND: No starter node should be created for read-only paths.
      expect(Object.keys(getGraph().nodes)).toHaveLength(0)
      expect(graphDeltas).toHaveLength(0)
    })

    it('does not notify backend for read paths', async () => {
      // GIVEN: A vault path
      const vaultPath: string = path.join(testTmpDir, 'read-vault')
      await fs.mkdir(vaultPath, { recursive: true })

      // WHEN: loadAndMergeVaultPath is called with isWritePath: false
      const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: false })

      // THEN: Should return success
      expect(result.success).toBe(true)

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

      // WHEN: loadAndMergeVaultPath is called with isWritePath: false
      await loadAndMergeVaultPath(vaultPath, { isWritePath: false })

      // THEN: Read-only loads should still resolve wikilinks into concrete edges.
      expect(getGraph().nodes[noteId]?.outgoingEdges.map(edge => edge.targetId)).toContain(targetId)
    })
  })
})
