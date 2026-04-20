import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEmptyGraph } from '../pure/graph/createGraph'
import { setGraph } from '../state/graph-store'
import { clearWatchFolderState, getWatcher } from '../state/watch-folder-store'
import { initGraphModel } from '../types'
import { saveVaultConfigForDirectory } from './voicetree-config-io'
import { loadFolder, stopFileWatching } from './watchFolder'

describe('watchFolder daemon bootstrap callback', () => {
  let root: string
  let projectRoot: string
  const ensureDaemonForVault = vi.fn()

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'graph-model-watch-folder-daemon-'))
    projectRoot = join(root, 'project')
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, 'note.md'), '# Note\n', 'utf8')

    initGraphModel(
      { appSupportPath: join(root, 'app-support') },
      {
        enableMcpIntegration: vi.fn().mockResolvedValue(undefined),
        ensureProjectSetup: vi.fn().mockResolvedValue(undefined),
        ensureDaemonForVault,
        onGraphCleared: vi.fn(),
        onWatchingStarted: vi.fn(),
      },
    )

    await saveVaultConfigForDirectory(projectRoot, {
      writePath: projectRoot,
      readPaths: [],
    })

    clearWatchFolderState()
    setGraph(createEmptyGraph())
    ensureDaemonForVault.mockReset()
  })

  afterEach(async () => {
    await stopFileWatching()
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  test('boots the daemon for the watched project root during loadFolder', async () => {
    ensureDaemonForVault.mockResolvedValue(undefined)

    await expect(loadFolder(projectRoot)).resolves.toEqual({ success: true })
    expect(ensureDaemonForVault).toHaveBeenCalledWith(projectRoot)
  })

  test('propagates daemon bootstrap failures', async () => {
    ensureDaemonForVault.mockRejectedValue(new Error('daemon bootstrap failed'))

    await expect(loadFolder(projectRoot)).rejects.toThrow(
      'daemon bootstrap failed',
    )
  })

  test('can load without mounting a local watcher', async () => {
    ensureDaemonForVault.mockResolvedValue(undefined)

    await expect(
      loadFolder(projectRoot, { mountWatcher: false }),
    ).resolves.toEqual({ success: true })
    expect(getWatcher()).toBeNull()
    expect(ensureDaemonForVault).toHaveBeenCalledWith(projectRoot)
  })
})
