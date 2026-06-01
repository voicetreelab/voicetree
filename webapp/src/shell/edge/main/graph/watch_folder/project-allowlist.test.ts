/* vt-allow-direct-daemon-mutation-import: low-level project-allowlist behaviour test */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'

// Mock electron app before importing modules that use it
const mockUserDataPath: string = path.join(os.tmpdir(), `test-project-allowlist-${Date.now()}-${Math.random().toString(36).substring(7)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath)
  }
}))

// Import after mocks are set up
import { getProjectPaths, loadAndMergeProjectPath, type ProjectLoadOutcome, addReadPath, setWriteFolderPath } from '@vt/graph-db-server/watch-folder/project-allowlist'
import {
  getConfigPath,
  getLastDirectory,
  getProjectConfigForDirectory,
  saveLastDirectory,
  saveProjectConfigForDirectory,
} from '@vt/app-config/project-config'
import { setProjectRoot, clearWatchFolderState, setWatcher } from '@vt/graph-db-server/state/watch-folder-store'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import { setActiveViewFolderState } from '@vt/graph-db-server/watch-folder/folder-visibility-active-view'
import { createEmptyGraph } from '@vt/graph-model/graph'
import type { ProjectConfig } from '@vt/graph-model/settings'
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
  process.env.VOICETREE_HOME_PATH = mockUserDataPath
  initGraphModel({
    notifyWriteDirectory,
    fitViewport: vi.fn(),
    syncProjectState: vi.fn()
  })
}

async function seedMarkdownFiles(dir: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      fs.writeFile(path.join(dir, `note-${index}.md`), `# Note ${index}\n\nContent ${index}`)
    )
  )
}

describe('project-allowlist: duplicate writeFolderPath in dropdown bug', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-allowlist-test-'))
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

  describe('getProjectPaths should not return duplicates', () => {
    it('should NOT return duplicate paths when writeFolderPath is also in readPaths', async () => {
      // GIVEN: A watched directory
      const watchedDir: string = path.join(testTmpDir, 'project')
      await fs.mkdir(watchedDir, { recursive: true })
      setProjectRoot(watchedDir)

      // AND: A config where writeFolderPath is also present in readPaths (buggy state)
      const projectPath: string = path.join(watchedDir, 'fri')
      await fs.mkdir(projectPath, { recursive: true })
      const buggyConfig: ProjectConfig = {
        writeFolderPath: projectPath,
        readPaths: [projectPath]  // Same path in both writeFolderPath AND readPaths
      }
      await saveProjectConfigForDirectory(watchedDir, buggyConfig)

      // WHEN: getProjectPaths is called
      const paths: readonly string[] = await getProjectPaths()

      // THEN: Should return unique paths only (no duplicates)
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length)
      expect(paths).toEqual(uniquePaths)
    })

    it('should return unique paths after setWriteFolderPath to a path already in readPaths', async () => {
      // GIVEN: A watched directory with initial config
      const watchedDir: string = path.join(testTmpDir, 'project')
      await fs.mkdir(watchedDir, { recursive: true })
      setProjectRoot(watchedDir)

      // AND: Initial config with separate writeFolderPath and readPath
      const writeFolderPathA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      await fs.mkdir(writeFolderPathA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })

      const initialConfig: ProjectConfig = {
        writeFolderPath: writeFolderPathA,
        readPaths: [readPathB]
      }
      await saveProjectConfigForDirectory(watchedDir, initialConfig)

      // WHEN: setWriteFolderPath is called with a path that's already in readPaths
      await setWriteFolderPath(readPathB)

      // AND: getProjectPaths is called
      const paths: readonly string[] = await getProjectPaths()

      // THEN: Should return unique paths only - readPathB should NOT appear twice
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length)
      expect(paths).toEqual(uniquePaths)
    })
  })

  describe('setWriteFolderPath should demote old writeFolderPath to readPaths', () => {
    it('should add old writeFolderPath to readPaths when setting a new writeFolderPath', async () => {
      // GIVEN: A watched directory with writeFolderPath=A, readPaths=[B]
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writeFolderPathA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      const newWriteFolderPathC: string = path.join(watchedDir, 'pathC')
      await fs.mkdir(writeFolderPathA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })
      await fs.mkdir(newWriteFolderPathC, { recursive: true })
      setProjectRoot(watchedDir)

      await saveProjectConfigForDirectory(watchedDir, {
        writeFolderPath: writeFolderPathA,
      })
      await setActiveViewFolderState(watchedDir, readPathB, 'expanded')

      // WHEN: setWriteFolderPath is called with a new path C
      await setWriteFolderPath(newWriteFolderPathC)

      // THEN: getProjectPaths should include all three paths: C (write), B (read), A (demoted)
      const paths: readonly string[] = await getProjectPaths()
      expect(paths).toContain(newWriteFolderPathC)
      expect(paths).toContain(readPathB)
      expect(paths).toContain(writeFolderPathA)
    })

    it('should demote old writeFolderPath when promoting a readPath to write', async () => {
      // GIVEN: writeFolderPath=A, readPaths=[B]
      const watchedDir: string = path.join(testTmpDir, 'project')
      const writeFolderPathA: string = path.join(watchedDir, 'pathA')
      const readPathB: string = path.join(watchedDir, 'pathB')
      await fs.mkdir(writeFolderPathA, { recursive: true })
      await fs.mkdir(readPathB, { recursive: true })
      setProjectRoot(watchedDir)

      await saveProjectConfigForDirectory(watchedDir, {
        writeFolderPath: writeFolderPathA,
        readPaths: [readPathB]
      })

      // WHEN: setWriteFolderPath promotes B to write
      await setWriteFolderPath(readPathB)

      // THEN: A should be demoted to readPaths, B should not be duplicated
      const paths: readonly string[] = await getProjectPaths()
      expect(paths).toContain(readPathB)  // B is now writeFolderPath
      expect(paths).toContain(writeFolderPathA) // A demoted to readPaths
      const uniquePaths: string[] = [...new Set(paths)]
      expect(paths.length).toBe(uniquePaths.length) // no duplicates
    })
  })
})

describe('voicetree config IO', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-config-io-'))
    await fs.mkdir(mockUserDataPath, { recursive: true })
    process.env.VOICETREE_HOME_PATH = mockUserDataPath
  })

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true })
    await fs.rm(path.join(mockUserDataPath, 'voicetree-config.json'), { force: true })
    vi.restoreAllMocks()
  })

  it('treats a missing voicetree-config.json as no last directory without logging startup noise', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getLastDirectory()).resolves.toEqual(O.none)

    expect(consoleError).not.toHaveBeenCalled()
    expect(getConfigPath()).toBe(path.join(mockUserDataPath, 'voicetree-config.json'))
  })

  it('observes voicetree-config.json changes written outside this process immediately', async () => {
    const projectPath: string = path.join(testTmpDir, 'project')
    const initialWriteFolderPath: string = path.join(projectPath, 'initial')
    const updatedWriteFolderPath: string = path.join(projectPath, 'updated')

    await saveLastDirectory(projectPath)
    await saveProjectConfigForDirectory(projectPath, { writeFolderPath: initialWriteFolderPath })
    await fs.writeFile(getConfigPath(), JSON.stringify({
      lastDirectory: projectPath,
      projectConfig: {
        [projectPath]: { writeFolderPath: updatedWriteFolderPath },
      },
    }, null, 2), 'utf8')

    await expect(getLastDirectory()).resolves.toMatchObject({ value: projectPath })
    await expect(getProjectConfigForDirectory(projectPath)).resolves.toEqual({
      writeFolderPath: updatedWriteFolderPath,
      readPaths: [],
    })
  })
})

describe('project-allowlist: loadAndMergeProjectPath helper', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-load-merge-test-'))
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
    // GIVEN: A project path
    const projectPath: string = path.join(testTmpDir, 'project')
    await fs.mkdir(projectPath, { recursive: true })
    const notePath: string = path.join(projectPath, 'test-node.md')
    await fs.writeFile(notePath, '# Test Node\n\nHello world.')

    // WHEN: loadAndMergeProjectPath is called (impure edge function)
    const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath)

    // THEN: Should return success
    expect(outcome.kind).toBe('ok')
    expect(getGraph().nodes[notePath]).toBeDefined()
    expect(Object.keys(getGraph().nodes)).toHaveLength(1)
  })

  it('returns fileLimit outcome when file limit is exceeded', async () => {
    // GIVEN: A project path
    const projectPath: string = path.join(testTmpDir, 'project')
    await fs.mkdir(projectPath, { recursive: true })
    await seedMarkdownFiles(projectPath, FILE_COUNT_ABOVE_RAISED_LIMIT)

    // WHEN: loadAndMergeProjectPath is called (impure edge function)
    const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath)

    // THEN: Should return fileLimit with typed details
    expect(outcome.kind).toBe('fileLimit')
    if (outcome.kind === 'fileLimit') {
      expect(outcome.details.fileCount).toBe(FILE_COUNT_ABOVE_RAISED_LIMIT)
      expect(outcome.details.maxFiles).toBeGreaterThan(0)
    }
  })
})

describe('project-allowlist: file limit exceeded error handling', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-file-limit-test-'))
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
      const writeFolderPath: string = path.join(watchedDir, 'voicetree')
      const newReadPath: string = path.join(watchedDir, 'too-many-files')
      await fs.mkdir(writeFolderPath, { recursive: true })
      await fs.mkdir(newReadPath, { recursive: true })
      setProjectRoot(watchedDir)

      const config: ProjectConfig = {
        writeFolderPath: writeFolderPath,
        readPaths: []
      }
      await saveProjectConfigForDirectory(watchedDir, config)

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

  describe('setWriteFolderPath returns error when file limit exceeded', () => {
    it('returns error when file limit is exceeded', async () => {
      // GIVEN: A watched directory with a config
      const watchedDir: string = path.join(testTmpDir, 'project')
      const currentWriteFolderPath: string = path.join(watchedDir, 'voicetree')
      const newWriteFolderPath: string = path.join(watchedDir, 'too-many-files')
      await fs.mkdir(currentWriteFolderPath, { recursive: true })
      await fs.mkdir(newWriteFolderPath, { recursive: true })
      setProjectRoot(watchedDir)

      const config: ProjectConfig = {
        writeFolderPath: currentWriteFolderPath,
        readPaths: []
      }
      await saveProjectConfigForDirectory(watchedDir, config)

      await seedMarkdownFiles(newWriteFolderPath, FILE_COUNT_ABOVE_RAISED_LIMIT)

      // WHEN: setWriteFolderPath is called
      const result: { success: boolean; error?: string } = await setWriteFolderPath(newWriteFolderPath)

      // THEN: Should return error with file limit message
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('File limit exceeded')
      expect(result.error).toContain(String(FILE_COUNT_ABOVE_RAISED_LIMIT))
    })
  })
})

/**
 * Phase 2 Tests: loadAndMergeProjectPath with isWriteFolderPath option
 * Updated for impure edge function that handles side effects internally
 */
describe('project-allowlist: loadAndMergeProjectPath isWriteFolderPath behavior', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-isWriteFolderPath-test-'))
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

  describe('when isWriteFolderPath is true', () => {
    it('creates starter node when folder is empty', async () => {
      // GIVEN: An empty project path
      const projectPath: string = path.join(testTmpDir, 'empty-project')
      await fs.mkdir(projectPath, { recursive: true })

      // WHEN: loadAndMergeProjectPath is called with isWriteFolderPath: true
      const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: true })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: A starter node should have been created in both graph state and on disk.
      const createdNodeIds: readonly string[] = Object.keys(getGraph().nodes)
      expect(createdNodeIds).toHaveLength(1)
      expect(createdNodeIds[0].startsWith(projectPath + path.sep)).toBe(true)
      await expect(fs.access(createdNodeIds[0])).resolves.toBeUndefined()
    })

    it('does not create starter node when folder has files', async () => {
      // GIVEN: A project path with existing files
      const projectPath: string = path.join(testTmpDir, 'non-empty-project')
      await fs.mkdir(projectPath, { recursive: true })
      const existingNodeId: string = path.join(projectPath, 'existing-file.md')
      await fs.writeFile(existingNodeId, '# Existing File\n\nAlready here.')

      // WHEN: loadAndMergeProjectPath is called with isWriteFolderPath: true
      const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: true })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: Only the existing file should be present - no starter node created.
      const createdNodeIds: readonly string[] = Object.keys(getGraph().nodes)
      expect(createdNodeIds).toEqual([existingNodeId])
    })

    it('notifies backend for write paths', async () => {
      // GIVEN: A project path
      const projectPath: string = path.join(testTmpDir, 'write-project')
      await fs.mkdir(projectPath, { recursive: true })

      // WHEN: loadAndMergeProjectPath is called with isWriteFolderPath: true
      const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: true })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: The backend notification callback should have been called.
      expect(notifyWriteDirectory).toHaveBeenCalledWith(projectPath)
    })

    it('resolves wikilinks after loading', async () => {
      // GIVEN: A project path
      const projectPath: string = path.join(testTmpDir, 'project-with-links')
      await fs.mkdir(projectPath, { recursive: true })
      const noteId: string = path.join(projectPath, 'note.md')
      const targetId: string = path.join(projectPath, 'target.md')
      await fs.writeFile(noteId, '# Note\n\n[[target.md]]')
      await fs.writeFile(targetId, '# Target\n\nResolved target.')

      // WHEN: loadAndMergeProjectPath is called
      await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: true })

      // THEN: Wikilink resolution should connect note.md to target.md.
      expect(getGraph().nodes[noteId]?.outgoingEdges.map(edge => edge.targetId)).toContain(targetId)
    })
  })

  describe('when isWriteFolderPath is false', () => {
    it('does not create starter node for read paths', async () => {
      // GIVEN: An empty project path
      const projectPath: string = path.join(testTmpDir, 'empty-read-project')
      await fs.mkdir(projectPath, { recursive: true })

      // WHEN: loadAndMergeProjectPath is called with isWriteFolderPath: false
      const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: false })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: No starter node should be created for read-only paths.
      expect(Object.keys(getGraph().nodes)).toHaveLength(0)
    })

    it('does not notify backend for read paths', async () => {
      // GIVEN: A project path
      const projectPath: string = path.join(testTmpDir, 'read-project')
      await fs.mkdir(projectPath, { recursive: true })

      // WHEN: loadAndMergeProjectPath is called with isWriteFolderPath: false
      const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: false })

      // THEN: Should return success
      expect(outcome.kind).toBe('ok')

      // AND: Read-only paths should not notify the backend about write-directory changes.
      expect(notifyWriteDirectory).not.toHaveBeenCalled()
    })

    it('still resolves wikilinks for read paths', async () => {
      // GIVEN: A project path
      const projectPath: string = path.join(testTmpDir, 'read-project-with-links')
      await fs.mkdir(projectPath, { recursive: true })
      const noteId: string = path.join(projectPath, 'note.md')
      const targetId: string = path.join(projectPath, 'target.md')
      await fs.writeFile(noteId, '# Note\n\n[[target.md]]')
      await fs.writeFile(targetId, '# Target\n\nResolved target.')

      // WHEN: loadAndMergeProjectPath is called with isWriteFolderPath: false
      await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: false })

      // THEN: Read-only loads should still resolve wikilinks into concrete edges.
      expect(getGraph().nodes[noteId]?.outgoingEdges.map(edge => edge.targetId)).toContain(targetId)
    })
  })
})
