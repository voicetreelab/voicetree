import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { emitReadPathsChanged, clearWatchFolderState } from '../../state/watch-folder-store.ts'
import * as vaultAllowlist from '../../state/vaultAllowlist.ts'
import * as daemonWatcherModule from '../../data/graph/watching/daemonWatcher.ts'
import type { Watcher } from '../../data/graph/watching/daemonWatcher.ts'
import { startDaemonWatcher } from '../lifecycle/daemonWatcherLifecycle.ts'

function makeFakeWatcher(paths: readonly string[]): Watcher & {
  addedPaths: string[]
  unwatchedPaths: string[]
  mountedPaths: readonly string[]
} {
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  resolveReady()

  const addedPaths: string[] = []
  const unwatchedPaths: string[] = []

  return {
    ready,
    mountedPaths: paths,
    addedPaths,
    unwatchedPaths,
    add(path: string): void {
      addedPaths.push(path)
    },
    unwatch(path: string): void {
      unwatchedPaths.push(path)
    },
    async unmount(): Promise<void> {},
  }
}

describe('startDaemonWatcher', () => {
  let fakeWatcher: ReturnType<typeof makeFakeWatcher>
  let getVaultPathsSpy: MockInstance

  beforeEach(() => {
    clearWatchFolderState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearWatchFolderState()
  })

  test('mounts watcher with initial vault paths', async () => {
    const initialPaths = ['/vault', '/vault/public']
    fakeWatcher = makeFakeWatcher(initialPaths)
    getVaultPathsSpy = vi.spyOn(vaultAllowlist, 'getVaultPaths').mockResolvedValue(initialPaths)
    const capturedMountArgs: { paths: readonly string[]; vault: string }[] = []
    vi.spyOn(daemonWatcherModule, 'mountWatcher').mockImplementation((paths, vault) => {
      capturedMountArgs.push({ paths, vault })
      return fakeWatcher
    })

    const controller = await startDaemonWatcher('/vault', { error: vi.fn(), writeStderr: vi.fn() })

    expect(capturedMountArgs).toEqual([{ paths: initialPaths, vault: '/vault' }])

    await controller.stop()
  })

  test('when emitReadPathsChanged fires with a new path, calls watcher.add for the new path only', async () => {
    const initialPaths = ['/vault']
    fakeWatcher = makeFakeWatcher(initialPaths)
    getVaultPathsSpy = vi.spyOn(vaultAllowlist, 'getVaultPaths').mockResolvedValue(initialPaths)
    vi.spyOn(daemonWatcherModule, 'mountWatcher').mockReturnValue(fakeWatcher)

    const controller = await startDaemonWatcher('/vault', { error: vi.fn(), writeStderr: vi.fn() })

    emitReadPathsChanged(['/vault', '/vault/public'])

    expect(fakeWatcher.addedPaths).toEqual(['/vault/public'])
    expect(fakeWatcher.unwatchedPaths).toEqual([])

    await controller.stop()
  })

  test('when emitReadPathsChanged fires with unchanged paths, no add or unwatch is called', async () => {
    // This is the F6 scenario: hiding a folder that was never in the explicit watch list
    // triggers emitReadPathsChanged with the SAME paths. No remount should occur.
    const paths = ['/vault', '/vault/public']
    fakeWatcher = makeFakeWatcher(paths)
    getVaultPathsSpy = vi.spyOn(vaultAllowlist, 'getVaultPaths').mockResolvedValue(paths)
    vi.spyOn(daemonWatcherModule, 'mountWatcher').mockReturnValue(fakeWatcher)

    const controller = await startDaemonWatcher('/vault', { error: vi.fn(), writeStderr: vi.fn() })

    // Simulate hiding a folder that was never explicitly expanded.
    // getVaultPaths() returns [writeFolderPath, expandedPaths] — hidden folders are not included.
    // So emitReadPathsChanged fires with the same set of paths as before.
    emitReadPathsChanged(['/vault', '/vault/public'])

    expect(fakeWatcher.addedPaths).toEqual([])
    expect(fakeWatcher.unwatchedPaths).toEqual([])

    await controller.stop()
  })

  test('when emitReadPathsChanged removes a path, calls watcher.unwatch for that path only', async () => {
    const initialPaths = ['/vault', '/vault/public']
    fakeWatcher = makeFakeWatcher(initialPaths)
    getVaultPathsSpy = vi.spyOn(vaultAllowlist, 'getVaultPaths').mockResolvedValue(initialPaths)
    vi.spyOn(daemonWatcherModule, 'mountWatcher').mockReturnValue(fakeWatcher)

    const controller = await startDaemonWatcher('/vault', { error: vi.fn(), writeStderr: vi.fn() })

    emitReadPathsChanged(['/vault'])

    expect(fakeWatcher.addedPaths).toEqual([])
    expect(fakeWatcher.unwatchedPaths).toEqual(['/vault/public'])

    await controller.stop()
  })

  test('stop unsubscribes from path changes, subsequent emitReadPathsChanged is a no-op', async () => {
    const initialPaths = ['/vault']
    fakeWatcher = makeFakeWatcher(initialPaths)
    getVaultPathsSpy = vi.spyOn(vaultAllowlist, 'getVaultPaths').mockResolvedValue(initialPaths)
    vi.spyOn(daemonWatcherModule, 'mountWatcher').mockReturnValue(fakeWatcher)

    const controller = await startDaemonWatcher('/vault', { error: vi.fn(), writeStderr: vi.fn() })
    await controller.stop()

    emitReadPathsChanged(['/vault', '/vault/public'])

    expect(fakeWatcher.addedPaths).toEqual([])
  })

  test('stop is idempotent', async () => {
    const initialPaths = ['/vault']
    fakeWatcher = makeFakeWatcher(initialPaths)
    vi.spyOn(vaultAllowlist, 'getVaultPaths').mockResolvedValue(initialPaths)
    vi.spyOn(daemonWatcherModule, 'mountWatcher').mockReturnValue(fakeWatcher)
    const unmountSpy = vi.spyOn(fakeWatcher, 'unmount')

    const controller = await startDaemonWatcher('/vault', { error: vi.fn(), writeStderr: vi.fn() })
    await controller.stop()
    await controller.stop()

    expect(unmountSpy).toHaveBeenCalledTimes(1)
  })
})
