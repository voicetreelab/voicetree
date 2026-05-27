/* vt-allow-direct-daemon-mutation-import: low-level watch-folder behaviour test */

import {afterEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'

const electronMock = vi.hoisted(() => ({userDataPath: ''}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataPath),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}))

import {initGraphModel} from '@vt/graph-model'
import {createEmptyGraph} from '@vt/graph-model/graph'
import {saveVaultConfigForDirectory} from '@vt/app-config/vault-config'
import {getGraph, setGraph} from '@vt/graph-db-server/state/graph-store'
import {clearWatchFolderState} from '@vt/graph-db-server/state/watch-folder-store'
import {
  addReadPath,
  getVaultPaths,
  getWriteFolder,
  removeReadPath,
  setWriteFolder,
} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {loadFolder, stopFileWatching} from '@vt/graph-db-server/watch-folder/watchFolder'

type ProjectFixture = {
  readonly tmpDir: string
  readonly userDataPath: string
  readonly primaryPath: string
  readonly secondaryPath: string
}

const LOAD_OPTIONS = {
  mountWatcher: false,
  broadcastVaultState: false,
  includeActiveViewExpandedPaths: false,
} as const

let fixture: ProjectFixture | null = null

async function createProjectFixture(prefix: string): Promise<ProjectFixture> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const userDataPath = path.join(tmpDir, 'user-data')
  const projectPath = path.join(tmpDir, 'project')
  const primaryPath = path.join(projectPath, 'voicetree')
  const secondaryPath = path.join(projectPath, 'notes')

  await fs.mkdir(primaryPath, {recursive: true})
  await fs.mkdir(secondaryPath, {recursive: true})
  await fs.mkdir(userDataPath, {recursive: true})
  await fs.writeFile(path.join(primaryPath, 'keep.md'), '# Keep\n\nPrimary content.')
  await fs.writeFile(path.join(secondaryPath, 'remove.md'), '# Remove\n\nSecondary content.')

  return {tmpDir, userDataPath, primaryPath, secondaryPath}
}

async function resetAroundProject(nextFixture: ProjectFixture): Promise<void> {
  electronMock.userDataPath = nextFixture.userDataPath
  initGraphModel({
    fitViewport: vi.fn(),
    notifyWriteDirectory: vi.fn(),
    syncExternalFolderTrees: vi.fn(),
    syncFolderTree: vi.fn(),
    syncStarredFolderTrees: vi.fn(),
    syncVaultState: vi.fn(),
  })
  setGraph(createEmptyGraph())
  clearWatchFolderState()
  await saveVaultConfigForDirectory(nextFixture.userDataPath, nextFixture.primaryPath, {
    writeFolder: nextFixture.primaryPath,
    readPaths: [],
  })
}

async function openPrimaryProject(): Promise<ProjectFixture> {
  const nextFixture = await createProjectFixture('watch-folder-contract')
  fixture = nextFixture
  await resetAroundProject(nextFixture)
  const loadResult = await loadFolder(nextFixture.primaryPath, LOAD_OPTIONS)
  expect(loadResult.success).toBe(true)
  return nextFixture
}

function expectSomeValue<T>(option: O.Option<T>): T {
  expect(O.isSome(option)).toBe(true)
  if (O.isNone(option)) throw new Error('expected Some')
  return option.value
}

function graphHasNodeEndingWith(fileName: string): boolean {
  return Object.keys(getGraph().nodes).some(nodeId => nodeId.endsWith(fileName))
}

describe('watch-folder public contract', () => {
  afterEach(async () => {
    await stopFileWatching().catch(() => {})
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    if (fixture !== null) {
      await fs.rm(fixture.tmpDir, {recursive: true, force: true})
      fixture = null
    }
    vi.clearAllMocks()
  })

  it('opens the configured write path and manages read paths without duplicates', async () => {
    const project = await openPrimaryProject()
    const createdReadPath = path.join(path.dirname(project.primaryPath), 'created-by-add')

    const addResult = await addReadPath(createdReadPath)
    const duplicateResult = await addReadPath(createdReadPath)
    const vaultPaths = await getVaultPaths()

    expect(expectSomeValue(await getWriteFolder())).toBe(project.primaryPath)
    expect(addResult).toEqual({success: true})
    await expect(fs.stat(createdReadPath).then(stats => stats.isDirectory())).resolves.toBe(true)
    expect(duplicateResult.success).toBe(false)
    expect(duplicateResult.error).toContain('already')
    expect(vaultPaths).toContain(project.primaryPath)
    expect(vaultPaths).toContain(createdReadPath)
    expect(vaultPaths).toEqual([...new Set(vaultPaths)])
  })

  it('keeps write path changes observable across a project reload', async () => {
    const project = await openPrimaryProject()

    expect((await addReadPath(project.secondaryPath)).success).toBe(true)
    expect((await setWriteFolder(project.secondaryPath)).success).toBe(true)
    expect(expectSomeValue(await getWriteFolder())).toBe(project.secondaryPath)

    const reloadResult = await loadFolder(project.primaryPath, LOAD_OPTIONS)

    expect(reloadResult.success).toBe(true)
    expect(expectSomeValue(await getWriteFolder())).toBe(project.secondaryPath)
    expect(await getVaultPaths()).toContain(project.primaryPath)
    expect(await getVaultPaths()).toContain(project.secondaryPath)
  })

  it('removes unloaded read-path nodes and does not restore the path on reload', async () => {
    const project = await openPrimaryProject()

    expect((await addReadPath(project.secondaryPath)).success).toBe(true)
    expect(graphHasNodeEndingWith('keep.md')).toBe(true)
    expect(graphHasNodeEndingWith('remove.md')).toBe(true)

    expect((await removeReadPath(project.secondaryPath)).success).toBe(true)
    expect(graphHasNodeEndingWith('keep.md')).toBe(true)
    expect(graphHasNodeEndingWith('remove.md')).toBe(false)

    const reloadResult = await loadFolder(project.primaryPath, LOAD_OPTIONS)

    expect(reloadResult.success).toBe(true)
    expect(await getVaultPaths()).not.toContain(project.secondaryPath)
    expect(graphHasNodeEndingWith('remove.md')).toBe(false)
  })
})
